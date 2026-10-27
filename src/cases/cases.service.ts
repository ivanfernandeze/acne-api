import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  CASE_STAGE_OF,
  DIAGNOSING_ROLES,
  IDENTITY_ROLES,
  anamnesisImageMismatch,
  canTransition,
  describeEvidence,
  describeMissingShots,
  missingRequiredShots,
  removalMode,
  type CaseEvidence,
  statusesOfStage,
  type CaseStage,
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
  CaseAssigneeDto,
  CaseDetailDto,
  CaseRemovalDto,
  CaseRemovalResultDto,
  CaseSummaryDto,
  CreateCaseDto,
  UpdateCaseDto,
} from './dto/case.dto';

export interface CaseFilters {
  /** Filters by the condition in which the case was registered (provenance). */
  studyMode?: StudyMode;
  status?: CaseStatus;
  /** What the staff filters by: a stage groups several internal statuses. */
  stage?: CaseStage;
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

const NO_EVIDENCE: CaseEvidence = { diagnoses: 0, reviewTimings: 0, inferences: 0, prescriptions: 0 };

/** Covers: RF-TR-01, RF-TR-03 and the case lifecycle of section 9.2. */
@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

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
    if (filters.stage !== undefined) {
      query.andWhere('c.status IN (:...stageStatuses)', {
        stageStatuses: statusesOfStage(filters.stage),
      });
    }
    if (filters.assignedUserId !== undefined) {
      query.andWhere('c.assignedUserId = :assignedUserId', { assignedUserId: filters.assignedUserId });
    }
    if (filters.includeSynthetic !== true) query.andWhere('c.isSynthetic = false');
    // An annulled case is out of the study and out of every working list.
    query.andWhere('c.voidedAt IS NULL');
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
    const ids = cases.map((c) => c.id);
    const [counts, evidence] = await Promise.all([this.imageCounts(ids), this.evidenceFor(ids)]);

    const summaries = cases.map((c) => ({
      ...this.toSummary(
        c,
        counts.get(c.id) ?? 0,
        filters.revealIdentity === true
          ? this.encryption.decryptOptional(c.patient?.encryptedFullName)
          : null,
      ),
      // The tray offers «Eliminar» or «Anular» per row, so it must know which one applies.
      removal: this.toRemoval(evidence.get(c.id) ?? NO_EVIDENCE),
    }));

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

  /** `findEntity`, refusing a case that was annulled: it no longer admits any change. */
  async findActiveEntity(id: string): Promise<ClinicalCase> {
    const found = await this.findEntity(id);
    if (found.voidedAt !== null) {
      throw new BadRequestException(`El caso ${found.caseCode} está anulado y ya no admite cambios.`);
    }
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
    const removal = this.toRemoval(await this.evidence(id));

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
      removal,
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
    const clinicalCase = await this.findActiveEntity(id);
    // Photographs belong to intake. Once t₀ is stamped the measured window has begun, so any phone
    // still holding a QR for this case is cut off: an upload landing mid-review would add work to
    // the interval that OE1 reports as review time (RF-OE1-01).
    await this.captureService.revokeActiveForCase(id);
    // The measurement belongs to the OBSERVER's condition. A case closed in pretest is reopened
    // for its postest pass; that second pass is a new observation, not a correction of the first.
    await this.reviewTiming.start(id, user.id, SYSTEM_MEASUREMENT_MODE);
    // Only a draft ENTERS review here. Until 25/10/2026 this set `en_revision` unconditionally, and
    // the portal re-opens the case file after every action — including signing the diagnosis — so
    // every diagnosed case fell straight back to «En revisión» (31 of 31 in the study database).
    if (clinicalCase.status === 'borrador') {
      await this.repository.update({ id }, { status: 'en_revision' });
    }
    return this.findOne(id, user);
  }

  async close(id: string): Promise<CaseSummaryDto> {
    const clinicalCase = await this.findActiveEntity(id);
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
    const clinicalCase = await this.findActiveEntity(id);
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
    const clinicalCase = await this.findActiveEntity(id);
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
    const clinicalCase = await this.findActiveEntity(id);
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

  /**
   * Corrige el caso: paciente, profesional asignado, notas y —para quien puede— el patrón de
   * consenso. Lo que el ingreso produjo (fotos, anamnesis) se corrige desde «Continuar ingreso».
   *
   * Cambiar de paciente se rechaza una vez que hay diagnóstico o receta: los dos se emitieron para
   * el paciente anterior, y moverlos en silencio pondría la firma del especialista sobre otra
   * persona. Lo que queda es anular el caso y abrir uno nuevo.
   */
  async update(id: string, dto: UpdateCaseDto): Promise<CaseSummaryDto> {
    const clinicalCase = await this.findActiveEntity(id);
    const manager = this.repository.manager;

    if (dto.patientId !== undefined && dto.patientId !== clinicalCase.patientId) {
      const [patient] = await manager.query<Array<{ retirado_en: Date | null }>>(
        `SELECT "retirado_en" FROM "pacientes" WHERE "id" = $1`,
        [dto.patientId],
      );
      if (patient === undefined) throw new NotFoundException(`No existe el paciente ${dto.patientId}.`);
      if (patient.retirado_en !== null) {
        throw new BadRequestException(
          'Ese paciente retiró su consentimiento: no se le pueden asignar casos nuevos (RNF-07).',
        );
      }
      const evidence = await this.evidence(id);
      if (evidence.diagnoses > 0 || evidence.prescriptions > 0) {
        throw new BadRequestException(
          'El caso ya tiene diagnóstico o receta para el paciente actual; no se puede cambiar de ' +
            'paciente. Anúlelo y abra un caso nuevo para el paciente correcto.',
        );
      }
      clinicalCase.patientId = dto.patientId;
      clinicalCase.patient = undefined;
    }
    if (dto.assignedUserId !== undefined && dto.assignedUserId !== clinicalCase.assignedUserId) {
      const [assignee] = await manager.query<Array<{ activo: boolean }>>(
        `SELECT "activo" FROM "usuarios" WHERE "id" = $1`,
        [dto.assignedUserId],
      );
      if (assignee === undefined || !assignee.activo) {
        throw new BadRequestException('El profesional elegido no existe o está desactivado.');
      }
      clinicalCase.assignedUserId = dto.assignedUserId;
      clinicalCase.assignedUser = undefined;
    }
    if (dto.groundTruthIga !== undefined) clinicalCase.groundTruthIga = dto.groundTruthIga;
    if (dto.notes !== undefined) clinicalCase.notes = dto.notes.trim() === '' ? null : dto.notes;
    await this.repository.save(clinicalCase);
    return this.toSummary(await this.findEntity(id));
  }

  /** Who a case can be assigned to: every active account, by name. */
  async assignees(): Promise<CaseAssigneeDto[]> {
    return this.repository.manager.query<CaseAssigneeDto[]>(
      `SELECT "id", "nombre_completo" AS "fullName", "rol_codigo" AS "role"
         FROM "usuarios"
        WHERE "activo" = true
        ORDER BY "nombre_completo" ASC`,
    );
  }

  /** What the case already produced for the study. Any of it turns a removal into an annulment. */
  async evidence(id: string): Promise<CaseEvidence> {
    return (await this.evidenceFor([id])).get(id) ?? NO_EVIDENCE;
  }

  /** `evidence` for many cases in one query: the tray needs it for every row. */
  private async evidenceFor(ids: string[]): Promise<Map<string, CaseEvidence>> {
    if (ids.length === 0) return new Map();
    const rows = await this.repository.manager.query<
      Array<{
        id: string;
        diagnoses: number;
        timings: number;
        inferences: number;
        prescriptions: number;
      }>
    >(
      `SELECT x."id",
              (SELECT COUNT(*)::int FROM "diagnosticos" WHERE "caso_id" = x."id") AS "diagnoses",
              (SELECT COUNT(*)::int FROM "cronometrajes_revision" WHERE "caso_id" = x."id") AS "timings",
              (SELECT COUNT(*)::int FROM "inferencias_ia" WHERE "caso_id" = x."id") AS "inferences",
              (SELECT COUNT(*)::int FROM "recetas" WHERE "caso_id" = x."id") AS "prescriptions"
         FROM unnest($1::uuid[]) AS x("id")`,
      [ids],
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          diagnoses: row.diagnoses,
          reviewTimings: row.timings,
          inferences: row.inferences,
          prescriptions: row.prescriptions,
        },
      ]),
    );
  }

  /**
   * Quita el caso: lo BORRA si aún no produjo evidencia del estudio y lo ANULA si ya la produjo (ver
   * `common/domain/case-removal.ts`).
   *
   * Borrar se lleva todo lo que cuelga del caso (fotos, anamnesis, sesiones de captura) por las
   * claves foráneas en cascada, y después los bytes cifrados del almacenamiento: la fila primero,
   * como en `ImagesService.remove`, porque un objeto huérfano es basura y una fila sin bytes es una
   * imagen rota. Anular no toca nada de eso: corta los QR vivos, descuenta el caso de la jornada en
   * la que contó para TCAD y sella quién, cuándo y por qué.
   */
  async remove(id: string, reason: string, user: AuthenticatedUser): Promise<CaseRemovalResultDto> {
    const clinicalCase = await this.findActiveEntity(id);
    const evidence = await this.evidence(id);
    const removal = this.toRemoval(evidence);

    if (removal.mode === 'eliminar') {
      const keys = (await this.imagesService.findByCase(id, true)).map((image) => image.storageKey);
      await this.repository.delete({ id });
      await this.imagesService.purgeStoredBytes(keys);
      return { ...removal, caseCode: clinicalCase.caseCode };
    }

    await this.captureService.revokeActiveForCase(id);
    if (clinicalCase.workSessionId !== null) {
      await this.sessions.uncountCase(clinicalCase.workSessionId);
    }
    await this.repository.update(
      { id },
      { voidedAt: new Date(), voidedById: user.id, voidReason: reason.trim() },
    );
    this.logger.log(`Caso ${clinicalCase.caseCode} anulado: ${removal.evidence.join(', ')}.`);
    return { ...removal, caseCode: clinicalCase.caseCode };
  }

  private toRemoval(evidence: CaseEvidence): CaseRemovalDto {
    return { mode: removalMode(evidence), evidence: describeEvidence(evidence) };
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
      stage: CASE_STAGE_OF[clinicalCase.status],
      groundTruthIga: clinicalCase.groundTruthIga,
      returnReason: clinicalCase.returnReason,
      isSynthetic: clinicalCase.isSynthetic,
      imageCount,
      createdAt: clinicalCase.createdAt.toISOString(),
      closedAt: clinicalCase.closedAt?.toISOString() ?? null,
      notes: clinicalCase.notes,
      voidedAt: clinicalCase.voidedAt?.toISOString() ?? null,
      voidReason: clinicalCase.voidReason,
      removal: null,
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
