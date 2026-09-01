import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';
import type { IgaClass, StudyMode } from 'src/common/domain';
import { AiInference } from 'src/inference/ai-inference.entity';
import { SessionsService } from 'src/sessions/sessions.service';
import { ReviewTimingService } from 'src/study/review-timing.service';

import { Diagnosis } from './diagnosis.entity';
import type { Anexo5RowDto, DiagnosisDto, SubmitDiagnosisDto } from './dto/diagnosis.dto';

/**
 * The specialist's judgement, and the moment the clinical measurement closes.
 *
 * Covers: OE2 (RF-OE2-01, RF-OE2-02), OE1 (stops the chronometer) and OE4 (counts the case
 * towards NCR of the open journey). All of it happens in one transaction: a diagnosis that got
 * saved without stopping the clock would silently corrupt TRM.
 */
@Injectable()
export class DiagnosesService {
  constructor(
    @InjectRepository(Diagnosis) private readonly repository: Repository<Diagnosis>,
    @InjectRepository(ClinicalCase) private readonly cases: Repository<ClinicalCase>,
    @InjectRepository(AiInference) private readonly inferences: Repository<AiInference>,
    private readonly reviewTiming: ReviewTimingService,
    private readonly sessions: SessionsService,
    private readonly dataSource: DataSource,
  ) {}

  async submit(
    caseId: string,
    dto: SubmitDiagnosisDto,
    userId: string,
    studyMode: StudyMode,
  ): Promise<DiagnosisDto> {
    const clinicalCase = await this.cases.findOne({ where: { id: caseId } });
    if (clinicalCase === null) throw new NotFoundException(`No existe el caso ${caseId}.`);
    // One diagnosis per case AND per condition. The same case is deliberately diagnosed twice —
    // once in pretest and once in postest — because that is what makes it its own control; what
    // must never happen is two diagnoses under the SAME condition, which would make the pairing
    // ambiguous.
    const alreadyDiagnosed = await this.repository.count({ where: { caseId, studyMode } });
    if (alreadyDiagnosed > 0) {
      throw new BadRequestException(
        `El caso ${clinicalCase.caseCode} ya tiene un diagnóstico registrado en modo ${studyMode}. ` +
          'Cada caso aporta una única medición por condición experimental.',
      );
    }

    const inference =
      studyMode === 'postest'
        ? await this.inferences.findOne({
            where: { caseId, status: 'succeeded' },
            order: { createdAt: 'DESC' },
          })
        : null;

    // `agreement` is frozen against the consensus label of the lot, which is what makes pretest
    // and postest comparable in RF-OE2-05. With no consensus label there is nothing to compare.
    const agreement: 'correcto' | 'incorrecto' | null =
      clinicalCase.groundTruthIga === null
        ? null
        : dto.igaClass === clinicalCase.groundTruthIga
          ? 'correcto'
          : 'incorrecto';

    const aiSuggestionAccepted =
      dto.aiSuggestionAccepted ??
      (inference?.igaClass == null ? null : dto.igaClass === inference.igaClass);

    const saved = await this.dataSource.transaction(async (manager) => {
      const diagnosis = await manager.getRepository(Diagnosis).save(
        manager.getRepository(Diagnosis).create({
          caseId,
          userId,
          studyMode,
          igaClass: dto.igaClass,
          gagsScore: dto.gagsScore ?? null,
          agreement,
          aiSuggestionAccepted,
          aiInferenceId: inference?.id ?? null,
          notes: dto.notes ?? null,
        }),
      );

      await manager
        .getRepository(ClinicalCase)
        .update({ id: caseId }, { status: 'diagnosed' });

      return diagnosis;
    });

    // OE1: stop the chronometer. Outside the transaction so that a missing timing row (a seeded
    // case, say) degrades to "no TR recorded" instead of rolling back a valid diagnosis.
    const timing = await this.reviewTiming.stop(caseId, studyMode);

    // OE4: count the case towards NCR of the professional's open journey, if any.
    const sessionId = await this.sessions.countReviewedCase(userId);
    if (sessionId !== null && clinicalCase.workSessionId === null) {
      await this.cases.update({ id: caseId }, { workSessionId: sessionId });
    }

    return this.toDto(saved, clinicalCase.caseCode, '', timing?.durationSeconds ?? null);
  }

  async findByCase(caseId: string): Promise<Diagnosis[]> {
    return this.repository.find({
      where: { caseId },
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Rows of the digital Anexo 5: N.º, fecha, diagnóstico IA, diagnóstico de referencia, resultado.
   *
   * Covers: RF-OE2-02. `standard` states explicitly what "resultado" was measured against:
   *  - `ground_truth`  the consensus label of the lot — the comparable standard of RF-OE2-05;
   *  - `especialista`  the specialist's judgement, the literal reading of RF-OE2-01, used when
   *                    the case carries no consensus label;
   *  - `sin_patron`    neither is available, so no verdict can be issued.
   * Making the standard explicit per row is what keeps the two conditions honestly comparable.
   */
  async anexo5Rows(studyMode: StudyMode | null, includeSynthetic: boolean): Promise<Anexo5RowDto[]> {
    const query = this.repository
      .createQueryBuilder('d')
      .innerJoin(ClinicalCase, 'c', 'c.id = d.case_id')
      .leftJoin(AiInference, 'ai', 'ai.id = d.ai_inference_id')
      .leftJoin('users', 'u', 'u.id = d.user_id')
      .select('d.created_at', 'createdAt')
      .addSelect('d.iga_class', 'referenceDiagnosis')
      .addSelect('d.study_mode', 'studyMode')
      .addSelect('c.case_code', 'caseCode')
      .addSelect('c.ground_truth_iga', 'groundTruth')
      .addSelect('c.is_synthetic', 'isSynthetic')
      .addSelect('ai.iga_class', 'aiDiagnosis')
      .addSelect('ai.confidence', 'aiConfidence')
      .addSelect('u.full_name', 'professional')
      .orderBy('d.created_at', 'ASC');

    if (studyMode !== null) query.andWhere('d.study_mode = :studyMode', { studyMode });
    if (!includeSynthetic) query.andWhere('c.is_synthetic = false');

    const raw = await query.getRawMany<RawAnexo5Row>();

    return raw.map((row, index) => {
      const evaluated = this.evaluateRow(row);
      return {
        number: index + 1,
        date: new Date(row.createdAt).toISOString().slice(0, 10),
        caseCode: row.caseCode,
        studyMode: row.studyMode,
        aiDiagnosis: row.aiDiagnosis,
        aiConfidence: row.aiConfidence,
        referenceDiagnosis: row.referenceDiagnosis,
        groundTruth: row.groundTruth,
        result: evaluated.result,
        standard: evaluated.standard,
        professional: row.professional ?? '—',
        isSynthetic: row.isSynthetic,
      };
    });
  }

  private evaluateRow(row: RawAnexo5Row): {
    result: 'correcto' | 'incorrecto' | null;
    standard: 'ground_truth' | 'especialista' | 'sin_patron';
  } {
    // In pretest there is no AI prediction, so what is judged is the physician's manual diagnosis.
    const candidate = row.studyMode === 'postest' ? row.aiDiagnosis : row.referenceDiagnosis;
    if (candidate === null) return { result: null, standard: 'sin_patron' };

    if (row.groundTruth !== null) {
      return {
        result: candidate === row.groundTruth ? 'correcto' : 'incorrecto',
        standard: 'ground_truth',
      };
    }
    if (row.studyMode === 'postest') {
      return {
        result: candidate === row.referenceDiagnosis ? 'correcto' : 'incorrecto',
        standard: 'especialista',
      };
    }
    return { result: null, standard: 'sin_patron' };
  }

  toDto(
    diagnosis: Diagnosis,
    caseCode: string,
    userFullName: string,
    durationSeconds: number | null,
  ): DiagnosisDto {
    return {
      id: diagnosis.id,
      caseId: diagnosis.caseId,
      caseCode,
      userId: diagnosis.userId,
      userFullName: diagnosis.user?.fullName ?? userFullName,
      studyMode: diagnosis.studyMode,
      igaClass: diagnosis.igaClass,
      gagsScore: diagnosis.gagsScore,
      agreement: diagnosis.agreement,
      aiSuggestionAccepted: diagnosis.aiSuggestionAccepted,
      aiInferenceId: diagnosis.aiInferenceId,
      notes: diagnosis.notes,
      createdAt: diagnosis.createdAt.toISOString(),
      reviewMinutes: durationSeconds === null ? null : durationSeconds / 60,
    };
  }
}

interface RawAnexo5Row {
  createdAt: string;
  referenceDiagnosis: IgaClass;
  studyMode: StudyMode;
  caseCode: string;
  groundTruth: IgaClass | null;
  isSynthetic: boolean;
  aiDiagnosis: IgaClass | null;
  aiConfidence: number | null;
  professional: string | null;
}
