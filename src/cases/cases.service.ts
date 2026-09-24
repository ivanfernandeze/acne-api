import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AnamnesisService } from 'src/anamnesis/anamnesis.service';
import { CaptureService } from 'src/capture/capture.service';
import { SessionsService } from 'src/sessions/sessions.service';
import { EncryptionService } from 'src/common/crypto/encryption.service';
import { matchesSearch } from 'src/common/utils/search-text';
import { nextSequentialCode, withCodeRetry } from 'src/common/utils/sequential-code';
import {
  AI_VIEWER_ROLES,
  DIAGNOSING_ROLES,
  IDENTITY_ROLES,
  anamnesisImageMismatch,
  canTransition,
  describeMissingShots,
  missingRequiredShots,
  type CaseStatus,
  type StudyMode,
  SYSTEM_MEASUREMENT_MODE,
} from 'src/common/domain';
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
   * Decrypts the patient's name into the response. Only for the `identity` roles; the caller
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
    private readonly captureService: CaptureService,
    private readonly sessions: SessionsService,
    private readonly anamnesis: AnamnesisService,
    private readonly encryption: EncryptionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The case is stamped with the CREATOR's current study mode and keeps it for life. That is what
   * lets a single case contribute one pretest measurement and one postest measurement as two
   * separate rows, which is the paired structure the design requires.
   */
  async create(dto: CreateCaseDto, user: AuthenticatedUser): Promise<CaseSummaryDto> {
    const saved = await withCodeRetry(async () => {
      const entity = this.repository.create({
        caseCode: await nextSequentialCode(
          this.repository.manager,
          'casos',
          'codigo_caso',
          `ACN-${new Date().getFullYear()}-`,
        ),
        patientId: dto.patientId,
        assignedUserId: dto.assignedUserId ?? user.id,
        studyMode: SYSTEM_MEASUREMENT_MODE,
        status: 'borrador',
        groundTruthIga: dto.groundTruthIga ?? null,
        isSynthetic: dto.isSynthetic ?? false,
        notes: dto.notes ?? null,
      });
      return this.repository.save(entity);
    });

    /*
     * El mostrador cierra su unidad de trabajo AQUÍ, al dejar el caso listo para revisión.
     *
     * Solo quien no diagnostica: para el especialista la unidad se cierra al firmar el diagnóstico
     * (`diagnoses.service`), y contarle también el alta le sumaría dos veces el mismo caso —una
     * jornada de diez casos aparecería como veinte y TCAD saldría al doble.
     */
    if (!DIAGNOSING_ROLES.includes(user.role)) {
      await this.sessions.countCompletedCase(user.id);
    }

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
           SELECT 1 FROM "diagnosticos" d
            WHERE d."caso_id" = c."id" AND d."modo_estudio_codigo" = :pendingForMode
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
    const term = filters.search?.trim() ?? '';
    if (term === '') return summaries;

    // `matchesSearch` ignora tildes y mayúsculas: quien busca teclea «Chavez» y el paciente está
    // registrado como «Chávez». La comparación literal lo dejaba sin encontrar.
    return summaries.filter(
      (summary) =>
        matchesSearch(summary.caseCode, term) ||
        matchesSearch(summary.patientCode, term) ||
        matchesSearch(summary.patientName, term),
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
    const maySeeIdentity = IDENTITY_ROLES.includes(user.role);
    const clinicalCase = await this.findEntity(id, maySeeIdentity);
    // Visibility depends on the REQUESTER's role and condition, not on the case: the same case is
    // reviewed in both conditions, and what must stay hidden is the suggestion during the pretest
    // pass. The role check matters because a technician sits in `produccion`, where the AI is
    // unblocked, yet has no clinical reason to see a severity prediction (RF-TR-01, RF-TR-02).
    const aiVisible = AI_VIEWER_ROLES.includes(user.role);

    const [images, diagnoses, timing] = await Promise.all([
      this.imagesService.findByCase(id, aiVisible),
      this.diagnosesService.findByCase(id),
      this.reviewTiming.findForCase(id, SYSTEM_MEASUREMENT_MODE),
    ]);

    const inference = aiVisible ? await this.inferenceService.findByCase(id) : null;
    const caseAnalysis =
      aiVisible && inference !== null ? await this.inferenceService.caseAnalysis(id) : null;
    const apiPrefix = `/${this.config.globalPrefix}`;

    // Deterministic and role-independent: which views of the face are still missing.
    const missingShots = missingRequiredShots(
      images.filter((i) => !i.isHeatmap).map((i) => i.shotKey),
    );
    // Derived from what the model saw, so it lives and dies with `inference` (never shown to a
    // role that cannot see the suggestion). Read on demand and never stored, like `pregnancyFlag`.
    // The case-level class when the views are in; the single inference otherwise.
    const suggested =
      caseAnalysis !== null && caseAnalysis.igaClass !== null
        ? caseAnalysis.igaClass
        : inference !== null && inference.status === 'exitoso'
          ? inference.igaClass
          : null;
    const anamnesisMismatch =
      suggested !== null
        ? anamnesisImageMismatch(suggested, await this.anamnesis.answersForCase(id))
        : [];

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
      caseAnalysis,
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
      missingShots,
      anamnesisMismatch,
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
    // Photographs belong to intake. Once t₀ is stamped the measured window has begun, so any phone
    // still holding a QR for this case is cut off: an upload landing mid-review would add work to
    // the interval that OE1 reports as review time (RF-OE1-01).
    await this.captureService.revokeActiveForCase(id);
    // The measurement belongs to the OBSERVER's condition. A case closed in pretest is reopened
    // for its postest pass; that second pass is a new observation, not a correction of the first.
    await this.reviewTiming.start(id, user.id, SYSTEM_MEASUREMENT_MODE);
    await this.repository.update({ id }, { status: 'en_revision' });
    return this.findOne(id, user);
  }

  async close(id: string): Promise<CaseSummaryDto> {
    const clinicalCase = await this.findEntity(id);
    if (!canTransition(clinicalCase.status, 'cerrado')) {
      throw new BadRequestException(
        `No se puede cerrar un caso en estado "${clinicalCase.status}". Debe estar diagnosticado.`,
      );
    }
    await this.repository.update({ id }, { status: 'cerrado', closedAt: new Date() });
    return this.toSummary(await this.findEntity(id));
  }

  /**
   * Devuelve el caso al mostrador porque las imágenes no alcanzan para juzgar.
   *
   * La medición en curso se INVALIDA en vez de detenerse. Entre la devolución y la reposición de
   * las fotos pueden pasar horas o días de espera en el mostrador, y contarlos como tiempo de
   * revisión médica haría de TRM (OE1) una medida de la logística de la clínica y no del trabajo
   * del especialista. La fila invalidada se conserva —no se borra— para que la auditoría vea que
   * hubo un intento y por qué se descartó.
   */
  async requestPhotos(
    id: string,
    reason: string,
    user: AuthenticatedUser,
  ): Promise<CaseDetailDto> {
    const clinicalCase = await this.findEntity(id);
    if (!canTransition(clinicalCase.status, 'solicitar_fotos')) {
      throw new BadRequestException(
        `No se pueden pedir fotos de un caso en estado "${clinicalCase.status}".`,
      );
    }
    const cleaned = reason.trim();
    if (cleaned === '') {
      throw new BadRequestException(
        'Indique qué falta. Devolver un caso sin decirlo obliga al mostrador a adivinar y ' +
          'garantiza una segunda devolución.',
      );
    }

    const timing = await this.reviewTiming.findOpen(id, SYSTEM_MEASUREMENT_MODE);
    if (timing !== null) {
      await this.reviewTiming.invalidate(
        timing.id,
        `Devuelto al mostrador por imágenes insuficientes: ${cleaned}`,
      );
    }

    await this.repository.update(
      { id },
      { status: 'solicitar_fotos', returnReason: cleaned, physicianId: user.id },
    );
    return this.findOne(id, user);
  }

  /**
   * El mostrador repone lo que faltaba y el caso vuelve a la bandeja del especialista.
   *
   * No reabre el cronómetro: eso ocurre cuando el especialista abre la ficha otra vez, que es el
   * instante en que empieza a trabajar de verdad.
   */
  async resubmit(id: string, user: AuthenticatedUser): Promise<CaseDetailDto> {
    const clinicalCase = await this.findEntity(id);
    if (!canTransition(clinicalCase.status, 'en_revision')) {
      throw new BadRequestException(
        `Un caso en estado "${clinicalCase.status}" no está esperando fotos.`,
      );
    }
    // The case came back precisely because photographs were missing; sending it up again with the
    // protocol still incomplete would just bounce it a second time.
    const missing = await this.imagesService.missingRequiredShots(id);
    if (missing.length > 0) throw new BadRequestException(describeMissingShots(missing));
    await this.repository.update({ id }, { status: 'en_revision', returnReason: null });
    return this.findOne(id, user);
  }

  /**
   * Saca el caso del circuito digital: la teleconsulta no alcanza y hay que verlo en persona.
   *
   * Es un estado FINAL y no es un éxito. La medición se cierra normalmente —el especialista sí
   * dedicó ese tiempo a revisar, y TRM debe recogerlo— pero el caso no produce un diagnóstico
   * comparable, de modo que queda fuera de TPD y no cuenta como caso resuelto para TCAD.
   */
  async referInPerson(
    id: string,
    reason: string,
    user: AuthenticatedUser,
  ): Promise<CaseDetailDto> {
    const clinicalCase = await this.findEntity(id);
    if (!canTransition(clinicalCase.status, 'derivar_presencial')) {
      throw new BadRequestException(
        `No se puede derivar un caso en estado "${clinicalCase.status}".`,
      );
    }
    const cleaned = reason.trim();
    if (cleaned === '') {
      throw new BadRequestException('Indique por qué el caso requiere atención presencial.');
    }

    await this.reviewTiming.stop(id, SYSTEM_MEASUREMENT_MODE);
    await this.repository.update(
      { id },
      {
        status: 'derivar_presencial',
        returnReason: cleaned,
        physicianId: user.id,
        closedAt: new Date(),
      },
    );
    return this.findOne(id, user);
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
    if (canTransition(clinicalCase.status, 'procesado_ia')) {
      await this.repository.update({ id }, { status: 'procesado_ia' });
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
      returnReason: clinicalCase.returnReason,
      isSynthetic: clinicalCase.isSynthetic,
      imageCount,
      createdAt: clinicalCase.createdAt.toISOString(),
      closedAt: clinicalCase.closedAt?.toISOString() ?? null,
    };
  }

  private async imageCounts(caseIds: string[]): Promise<Map<string, number>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.repository.manager.query(
      `SELECT "caso_id" AS id, COUNT(*)::int AS count
         FROM "imagenes_caso"
        WHERE "caso_id" = ANY($1) AND "es_mapa_calor" = false
        GROUP BY "caso_id"`,
      [caseIds],
    );
    return new Map((rows as Array<{ id: string; count: number }>).map((r) => [r.id, r.count]));
  }

}
