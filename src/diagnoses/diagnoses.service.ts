import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertCaseActive } from 'src/cases/case-guards';

import { ClinicalCase } from 'src/cases/case.entity';
import { AnamnesisService } from 'src/anamnesis/anamnesis.service';
import {
  anamnesisImageMismatch,
  describeMissingShots,
  type IgaClass,
  type StudyMode,
} from 'src/common/domain';
import { ImagesService } from 'src/images/images.service';
import { InferenceService } from 'src/inference/inference.service';
import { AiInference } from 'src/inference/ai-inference.entity';
import { SessionsService } from 'src/sessions/sessions.service';
import { ReviewTimingService } from 'src/study/review-timing.service';
import { User } from 'src/users/user.entity';

import { Diagnosis } from './diagnosis.entity';
import type { Anexo5RowDto, CorrectDiagnosisDto, DiagnosisDto, SubmitDiagnosisDto } from './dto/diagnosis.dto';
import { peruDate } from 'src/common/peru-date';

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
    private readonly images: ImagesService,
    private readonly anamnesis: AnamnesisService,
    private readonly inferenceService: InferenceService,
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
    await assertCaseActive(this.dataSource.manager, caseId);
    // A diagnosis on an incomplete photographic protocol is the measurement OE2 must not take:
    // the specialist would be grading a face seen from one side only.
    const missing = await this.images.missingRequiredShots(caseId);
    if (missing.length > 0) throw new BadRequestException(describeMissingShots(missing));
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
            where: { caseId, status: 'exitoso' },
            order: { createdAt: 'DESC' },
          })
        : null;

    // A diagnosis signed over a photograph the model reads as clean while the history describes
    // active lesions is a diagnosis over the wrong evidence — unless the specialist looked and
    // says otherwise. The decision stays theirs (RNF-06); what is not allowed is not deciding.
    // The case-level class, not the latest single row: that row may be a view the gate declared
    // not-acne, which carries no class even though the case has a suggestion.
    const analysis = inference !== null ? await this.inferenceService.caseAnalysis(caseId) : null;
    const suggestedClass = analysis?.igaClass ?? inference?.igaClass ?? null;
    if (inference !== null) {
      const mismatch = anamnesisImageMismatch(
        suggestedClass,
        await this.anamnesis.answersForCase(caseId),
      );
      if (mismatch.length > 0) {
        if (dto.mismatchAcknowledged !== true) {
          throw new BadRequestException(
            'La sugerencia de la IA y la anamnesis se contradicen: ' +
              mismatch.join(' ') +
              ' Revise la fotografía o el cuestionario; si mantiene el diagnóstico, marque que ' +
              'revisó la fotografía e indique el motivo.',
          );
        }
        if ((dto.mismatchReason ?? '').trim().length < 10) {
          throw new BadRequestException(
            'Indique por qué mantiene el diagnóstico pese a la incongruencia (mínimo 10 caracteres).',
          );
        }
      }
    }

    // `agreement` is frozen against the consensus label of the lot, which is what makes pretest
    // and postest comparable in RF-OE2-05. With no consensus label there is nothing to compare.
    const agreement: 'correcto' | 'incorrecto' | null =
      clinicalCase.groundTruthIga === null
        ? null
        : dto.igaClass === clinicalCase.groundTruthIga
          ? 'correcto'
          : 'incorrecto';

    // No suggestion (every view not-acne) → nothing to accept or reject: null.
    const aiSuggestionAccepted =
      suggestedClass === null ? null : (dto.aiSuggestionAccepted ?? dto.igaClass === suggestedClass);

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
          definitiveDiagnosis: dto.definitiveDiagnosis?.trim() ?? null,
          icd10Code: dto.icd10Code ?? null,
          patientNotes: dto.patientNotes?.trim() ?? null,
          internalNotes: dto.internalNotes?.trim() ?? null,
          notes: dto.notes ?? null,
        }),
      );

      await manager
        .getRepository(ClinicalCase)
        .update({ id: caseId }, { status: 'diagnosticado' });

      return diagnosis;
    });

    // OE1: stop the chronometer. Outside the transaction so that a missing timing row (a seeded
    // case, say) degrades to "no TR recorded" instead of rolling back a valid diagnosis.
    const timing = await this.reviewTiming.stop(caseId, studyMode);

    // OE4: count the case towards NCR of the professional's open journey, if any.
    const sessionId = await this.sessions.countCompletedCase(userId);
    if (sessionId !== null && clinicalCase.workSessionId === null) {
      await this.cases.update({ id: caseId }, { workSessionId: sessionId });
    }

    return this.toDto(saved, clinicalCase.caseCode, '', timing?.durationSeconds ?? null);
  }

  async findOneOrFail(id: string): Promise<Diagnosis> {
    const diagnosis = await this.repository.findOne({ where: { id } });
    if (diagnosis === null) throw new NotFoundException(`No existe el diagnóstico ${id}.`);
    return diagnosis;
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
      .innerJoin(ClinicalCase, 'c', 'c.id = d.caseId')
      .leftJoin(AiInference, 'ai', 'ai.id = d.aiInferenceId')
      .leftJoin(User, 'u', 'u.id = d.userId')
      .select('d.id', 'diagnosisId')
      .addSelect('d.createdAt', 'createdAt')
      .addSelect('d.igaClass', 'referenceDiagnosis')
      .addSelect('d.studyMode', 'studyMode')
      .addSelect('c.caseCode', 'caseCode')
      .addSelect('c.groundTruthIga', 'groundTruth')
      .addSelect('c.isSynthetic', 'isSynthetic')
      .addSelect('ai.igaClass', 'aiDiagnosis')
      .addSelect('ai.confidence', 'aiConfidence')
      .addSelect('u.fullName', 'professional')
      .orderBy('d.createdAt', 'ASC');

    if (studyMode !== null) query.andWhere('d.studyMode = :studyMode', { studyMode });
    if (!includeSynthetic) query.andWhere('c.isSynthetic = false');
    query.andWhere('c.voidedAt IS NULL');

    const raw = await query.getRawMany<RawAnexo5Row>();

    return raw.map((row, index) => {
      const evaluated = this.evaluateRow(row);
      return {
        diagnosisId: row.diagnosisId,
        number: index + 1,
        date: peruDate(row.createdAt),
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

  /**
   * Corrige la clase IGA de un diagnóstico (solo administrador).
   *
   * Es la corrección de un error de captura, no una reescritura: la clase original queda en
   * `clase_iga_original` (solo la de la primera corrección), con quién, cuándo y por qué. El
   * `acuerdo` se recalcula contra el patrón de referencia vigente. `sugerencia_aceptada` NO se toca:
   * registra lo que decidió el especialista en el momento y la IA no se modifica.
   */
  async correct(id: string, dto: CorrectDiagnosisDto, adminId: string): Promise<Diagnosis> {
    const diagnosis = await this.repository.findOne({ where: { id } });
    if (diagnosis === null) throw new NotFoundException(`No existe el diagnóstico ${id}.`);
    if (diagnosis.igaClass === dto.igaClass) {
      throw new BadRequestException('La clase indicada es la que ya tiene el diagnóstico.');
    }
    const clinicalCase = await this.cases.findOne({ where: { id: diagnosis.caseId } });
    if (clinicalCase === null) throw new NotFoundException(`No existe el caso ${diagnosis.caseId}.`);

    diagnosis.originalIgaClass ??= diagnosis.igaClass;
    diagnosis.igaClass = dto.igaClass;
    // Si el patrón de este caso se fijó a partir del diagnóstico del especialista
    // (`fijar-referencia-especialista`), corregir el diagnóstico corrige también su referencia.
    if (diagnosis.studyMode === 'postest' && (clinicalCase.notes ?? '').includes('[ref:especialista]')) {
      clinicalCase.groundTruthIga = dto.igaClass;
      await this.cases.save(clinicalCase);
    }
    diagnosis.agreement =
      clinicalCase.groundTruthIga === null
        ? null
        : dto.igaClass === clinicalCase.groundTruthIga
          ? 'correcto'
          : 'incorrecto';
    diagnosis.correctedBy = adminId;
    diagnosis.correctedAt = new Date();
    diagnosis.correctionReason = dto.reason.trim();
    return this.repository.save(diagnosis);
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
      definitiveDiagnosis: diagnosis.definitiveDiagnosis,
      icd10Code: diagnosis.icd10Code,
      patientNotes: diagnosis.patientNotes,
      internalNotes: diagnosis.internalNotes,
      notes: diagnosis.notes,
      createdAt: diagnosis.createdAt.toISOString(),
      originalIgaClass: diagnosis.originalIgaClass,
      correctionReason: diagnosis.correctionReason,
      correctedAt: diagnosis.correctedAt?.toISOString() ?? null,
      reviewMinutes: durationSeconds === null ? null : durationSeconds / 60,
    };
  }
}

interface RawAnexo5Row {
  diagnosisId: string;
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
