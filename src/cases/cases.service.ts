import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { canTransition, type CaseStatus, type StudyMode } from 'src/common/domain';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { DiagnosesService } from 'src/diagnoses/diagnoses.service';
import { ImagesService } from 'src/images/images.service';
import { InferenceService } from 'src/inference/inference.service';
import { ReviewTimingService } from 'src/study/review-timing.service';

import { ClinicalCase } from './case.entity';
import type {
  CaseDetailDto,
  CaseSummaryDto,
  CreateCaseDto,
  UpdateCaseDto,
} from './dto/case.dto';

export interface CaseFilters {
  /** Filters by the condition in which the case was registered (provenance). */
  studyMode?: StudyMode;
  status?: CaseStatus;
  assignedUserId?: string;
  includeSynthetic?: boolean;
  /**
   * Decrypts the patient's name into the response. Only for `dermatologo`/`residente`; the caller
   * is responsible for the audit entry (RF-TR-03, RNF-02).
   */
  revealIdentity?: boolean;
  /** Free text over case code, patient code and — when revealed — the patient's name. */
  search?: string;
  /**
   * Filters to the cases still awaiting a measurement under this condition — the working tray of
   * a physician doing the pretest pass, or later the postest pass, over the same 30 cases.
   */
  pendingForMode?: StudyMode;
}

/** Covers: RF-TR-01, RF-TR-03 and the case lifecycle of section 9.2. */
@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(ClinicalCase) private readonly repository: Repository<ClinicalCase>,
    private readonly imagesService: ImagesService,
    private readonly inferenceService: InferenceService,
    private readonly reviewTiming: ReviewTimingService,
    private readonly diagnosesService: DiagnosesService,
    private readonly encryption: EncryptionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The case is stamped with the CREATOR's current study mode and keeps it for life. That is what
   * lets a single case contribute one pretest measurement and one postest measurement as two
   * separate rows, which is the paired structure the design requires.
   */
  async create(dto: CreateCaseDto, user: AuthenticatedUser): Promise<CaseSummaryDto> {
    const caseCode = await this.nextCaseCode();
    const entity = this.repository.create({
      caseCode,
      patientId: dto.patientId,
      assignedUserId: dto.assignedUserId ?? user.id,
      studyMode: user.studyMode,
      status: 'draft',
      groundTruthIga: dto.groundTruthIga ?? null,
      isSynthetic: dto.isSynthetic ?? false,
      notes: dto.notes ?? null,
    });
    const saved = await this.repository.save(entity);
    return this.toSummary(await this.findEntity(saved.id));
  }

  async findAll(filters: CaseFilters): Promise<CaseSummaryDto[]> {
    const query = this.repository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.patient', 'patient')
      .leftJoinAndSelect('c.assignedUser', 'assignedUser')
      .orderBy('c.createdAt', 'DESC');

    if (filters.studyMode !== undefined) {
      query.andWhere('c.studyMode = :studyMode', { studyMode: filters.studyMode });
    }
    if (filters.status !== undefined) query.andWhere('c.status = :status', { status: filters.status });
    if (filters.assignedUserId !== undefined) {
      query.andWhere('c.assignedUserId = :assignedUserId', { assignedUserId: filters.assignedUserId });
    }
    if (filters.includeSynthetic !== true) query.andWhere('c.isSynthetic = false');
    if (filters.pendingForMode !== undefined) {
      query.andWhere(
        `NOT EXISTS (
           SELECT 1 FROM "diagnoses" d
            WHERE d."case_id" = c."id" AND d."study_mode" = :pendingForMode
         )`,
        { pendingForMode: filters.pendingForMode },
      );
    }

    if (filters.revealIdentity === true) query.addSelect('patient.encryptedFullName');

    const cases = await query.getMany();
    const counts = await this.imageCounts(cases.map((c) => c.id));

    const summaries = cases.map((c) =>
      this.toSummary(
        c,
        counts.get(c.id) ?? 0,
        filters.revealIdentity === true
          ? this.encryption.decryptOptional(c.patient?.encryptedFullName)
          : null,
      ),
    );

    // Filtering happens after decryption because the name is ciphertext in the database and no
    // SQL predicate can reach it. Acceptable for a census of 30 cases; a production registry
    // would need a blind index.
    const term = filters.search?.trim().toLowerCase() ?? '';
    if (term === '') return summaries;

    return summaries.filter(
      (summary) =>
        summary.caseCode.toLowerCase().includes(term) ||
        summary.patientCode.toLowerCase().includes(term) ||
        (summary.patientName ?? '').toLowerCase().includes(term),
    );
  }

  async findEntity(id: string, revealIdentity = false): Promise<ClinicalCase> {
    const query = this.repository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.patient', 'patient')
      .leftJoinAndSelect('c.assignedUser', 'assignedUser')
      .where('c.id = :id', { id });
    if (revealIdentity) query.addSelect('patient.encryptedFullName');

    const found = await query.getOne();
    if (found === null) throw new NotFoundException(`No existe el caso ${id}.`);
    return found;
  }

  /**
   * Full case view.
   *
   * The AI block is withheld when the requester operates in `pretest`. That mirrors, at the
   * presentation layer, the 403 that `StudyModeGuard` enforces at the inference routes: the
   * physician must not even glimpse the suggestion while O₁ is being measured (RF-TR-01).
   */
  async findOne(id: string, user: AuthenticatedUser): Promise<CaseDetailDto> {
    const maySeeIdentity = user.role === 'dermatologo' || user.role === 'residente';
    const clinicalCase = await this.findEntity(id, maySeeIdentity);
    // Visibility depends on the REQUESTER's condition, not on the case: the same case is reviewed
    // in both conditions, and what must stay hidden is the suggestion during the pretest pass.
    const aiVisible = user.studyMode !== 'pretest';

    const [images, diagnoses, timing] = await Promise.all([
      this.imagesService.findByCase(id, aiVisible),
      this.diagnosesService.findByCase(id),
      this.reviewTiming.findForCase(id, user.studyMode),
    ]);

    const inference = aiVisible ? await this.inferenceService.findByCase(id) : null;
    const apiPrefix = `/${this.config.globalPrefix}`;

    return {
      ...this.toSummary(
        clinicalCase,
        images.filter((i) => !i.isHeatmap).length,
        maySeeIdentity
          ? this.encryption.decryptOptional(clinicalCase.patient?.encryptedFullName)
          : null,
      ),
      images: images.map((image) => this.imagesService.toDto(image, apiPrefix, user.id)),
      inference: inference === null ? null : this.inferenceService.toDto(inference),
      diagnoses: diagnoses.map((d) =>
        this.diagnosesService.toDto(d, clinicalCase.caseCode, d.user?.fullName ?? '', null),
      ),
      timing:
        timing === null
          ? null
          : {
              id: timing.id,
              t0: timing.t0.toISOString(),
              t1: timing.t1?.toISOString() ?? null,
              durationSeconds: timing.durationSeconds,
              durationMinutes: timing.durationSeconds === null ? null : timing.durationSeconds / 60,
              valid: timing.valid,
            },
      aiVisible,
    };
  }

  /**
   * Opens the case file and stamps t₀ (RF-OE1-01).
   *
   * Deliberately a POST and not a side effect of the GET: browsers prefetch, retry and revalidate
   * GETs, and any of those would restart or spuriously create a chronometer entry. The portal
   * calls this exactly once, when the physician actually enters the review screen.
   */
  async open(id: string, user: AuthenticatedUser): Promise<CaseDetailDto> {
    await this.findEntity(id);
    // The measurement belongs to the OBSERVER's condition. A case closed in pretest is reopened
    // for its postest pass; that second pass is a new observation, not a correction of the first.
    await this.reviewTiming.start(id, user.id, user.studyMode);
    await this.repository.update({ id }, { status: 'in_review' });
    return this.findOne(id, user);
  }

  async close(id: string, user: AuthenticatedUser): Promise<CaseSummaryDto> {
    const clinicalCase = await this.findEntity(id);
    if (!canTransition(clinicalCase.status, 'closed')) {
      throw new BadRequestException(
        `No se puede cerrar un caso en estado "${clinicalCase.status}". Debe estar diagnosticado.`,
      );
    }
    await this.repository.update({ id }, { status: 'closed', closedAt: new Date() });
    return this.toSummary(await this.findEntity(id));
  }

  async update(id: string, dto: UpdateCaseDto): Promise<CaseSummaryDto> {
    const clinicalCase = await this.findEntity(id);
    if (dto.groundTruthIga !== undefined) clinicalCase.groundTruthIga = dto.groundTruthIga;
    if (dto.assignedUserId !== undefined) clinicalCase.assignedUserId = dto.assignedUserId;
    if (dto.notes !== undefined) clinicalCase.notes = dto.notes;
    await this.repository.save(clinicalCase);
    return this.toSummary(await this.findEntity(id));
  }

  /** Marks the case as processed by the AI once an inference lands. */
  async markAiProcessed(id: string): Promise<void> {
    const clinicalCase = await this.findEntity(id);
    if (canTransition(clinicalCase.status, 'ai_processed')) {
      await this.repository.update({ id }, { status: 'ai_processed' });
    }
  }

  toSummary(
    clinicalCase: ClinicalCase,
    imageCount = 0,
    patientName: string | null = null,
  ): CaseSummaryDto {
    return {
      id: clinicalCase.id,
      caseCode: clinicalCase.caseCode,
      patientId: clinicalCase.patientId,
      patientCode: clinicalCase.patient?.patientCode ?? '',
      patientName,
      assignedUserId: clinicalCase.assignedUserId,
      assignedUserName: clinicalCase.assignedUser?.fullName ?? null,
      studyMode: clinicalCase.studyMode,
      status: clinicalCase.status,
      groundTruthIga: clinicalCase.groundTruthIga,
      isSynthetic: clinicalCase.isSynthetic,
      imageCount,
      createdAt: clinicalCase.createdAt.toISOString(),
      closedAt: clinicalCase.closedAt?.toISOString() ?? null,
    };
  }

  private async imageCounts(caseIds: string[]): Promise<Map<string, number>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.repository.manager.query(
      `SELECT "case_id" AS id, COUNT(*)::int AS count
         FROM "case_images"
        WHERE "case_id" = ANY($1) AND "is_heatmap" = false
        GROUP BY "case_id"`,
      [caseIds],
    );
    return new Map((rows as Array<{ id: string; count: number }>).map((r) => [r.id, r.count]));
  }

  /** Sequential anonymised code scoped to the current year: `ACN-2026-0001` (RF-TR-03). */
  private async nextCaseCode(): Promise<string> {
    const prefix = `ACN-${new Date().getFullYear()}-`;
    const last = await this.repository
      .createQueryBuilder('c')
      .select('c.caseCode', 'code')
      .where('c.caseCode LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('c.caseCode', 'DESC')
      .limit(1)
      .getRawOne<{ code: string }>();

    const lastSequence = last === undefined ? 0 : Number(last.code.slice(prefix.length));
    const next = (Number.isFinite(lastSequence) ? lastSequence : 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }
}
