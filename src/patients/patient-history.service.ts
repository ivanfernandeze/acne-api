import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SignedUrlService } from 'src/common/crypto/signed-url.service';
import { IGA_ORDINAL, type CaseStatus, type IgaClass, type StudyMode } from 'src/common/domain';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import type { CaseImageDto } from 'src/images/dto/image.dto';

import type {
  HistoryDiagnosisDto,
  HistoryEntryDto,
  HistoryInferenceDto,
  HistoryTimingDto,
  PatientHistoryDto,
  PatientHistorySummaryDto,
} from './dto/patient-history.dto';
import type { PatientResponseDto } from './dto/patient.dto';

/**
 * Builds the longitudinal record of a patient.
 *
 * Assembled from five small queries and joined in memory rather than as one wide join: a single
 * query across cases × diagnoses × timings × images multiplies rows and the de-duplication is
 * harder to get right than the assembly.
 */
@Injectable()
export class PatientHistoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly signedUrl: SignedUrlService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async build(
    patient: PatientResponseDto,
    user: AuthenticatedUser,
    includeSynthetic: boolean,
  ): Promise<PatientHistoryDto> {
    // The AI block follows the REQUESTER's condition, exactly as the case view does: during the
    // pretest pass the physician must not glimpse the model's opinion, not even in a history
    // screen (RF-TR-01).
    const aiVisible = user.studyMode !== 'pretest';

    const cases = await this.dataSource.query<RawCase[]>(
      `SELECT c."id", c."case_code" AS "caseCode", c."status", c."study_mode" AS "studyMode",
              c."ground_truth_iga" AS "groundTruthIga", c."is_synthetic" AS "isSynthetic",
              c."created_at" AS "createdAt", c."closed_at" AS "closedAt"
         FROM "cases" c
        WHERE c."patient_id" = $1
          AND ($2::boolean OR c."is_synthetic" = false)
        ORDER BY c."created_at" ASC`,
      [patient.id, includeSynthetic],
    );

    if (cases.length === 0) {
      return { patient, summary: this.emptySummary(), timeline: [] };
    }

    const caseIds = cases.map((c) => c.id);

    const [diagnoses, timings, inferences, images] = await Promise.all([
      this.dataSource.query<RawDiagnosis[]>(
        `SELECT d."id", d."case_id" AS "caseId", d."study_mode" AS "studyMode",
                d."iga_class" AS "igaClass", d."gags_score" AS "gagsScore", d."notes",
                d."created_at" AS "createdAt", u."full_name" AS "professional"
           FROM "diagnoses" d
           JOIN "users" u ON u."id" = d."user_id"
          WHERE d."case_id" = ANY($1)
          ORDER BY d."created_at" ASC`,
        [caseIds],
      ),
      this.dataSource.query<RawTiming[]>(
        `SELECT t."case_id" AS "caseId", t."study_mode" AS "studyMode", t."t0",
                t."duration_seconds" AS "durationSeconds", t."valid"
           FROM "review_timings" t
          WHERE t."case_id" = ANY($1)
          ORDER BY t."t0" ASC`,
        [caseIds],
      ),
      aiVisible
        ? this.dataSource.query<RawInference[]>(
            `SELECT DISTINCT ON (i."case_id")
                    i."case_id" AS "caseId", i."iga_class" AS "igaClass", i."confidence",
                    i."model_version" AS "modelVersion", i."model_backend" AS "modelBackend",
                    i."created_at" AS "createdAt"
               FROM "ai_inferences" i
              WHERE i."case_id" = ANY($1) AND i."status" = 'succeeded'
              ORDER BY i."case_id", i."created_at" DESC`,
            [caseIds],
          )
        : Promise.resolve([] as RawInference[]),
      this.dataSource.query<RawImage[]>(
        `SELECT im."id", im."case_id" AS "caseId", im."mime_type" AS "mimeType",
                im."width", im."height", im."size_bytes" AS "sizeBytes", im."sha256",
                im."encrypted", im."is_heatmap" AS "isHeatmap", im."created_at" AS "createdAt"
           FROM "case_images" im
          WHERE im."case_id" = ANY($1)
            AND ($2::boolean OR im."is_heatmap" = false)
          ORDER BY im."created_at" ASC`,
        [caseIds, aiVisible],
      ),
    ]);

    const apiPrefix = `/${this.config.globalPrefix}`;
    const timeline: HistoryEntryDto[] = cases.map((row) => {
      const caseDiagnoses = diagnoses
        .filter((d) => d.caseId === row.id)
        .map(
          (d): HistoryDiagnosisDto => ({
            id: d.id,
            studyMode: d.studyMode,
            igaClass: d.igaClass,
            gagsScore: d.gagsScore,
            notes: d.notes,
            professional: d.professional,
            createdAt: new Date(d.createdAt).toISOString(),
          }),
        );

      const inference = inferences.find((i) => i.caseId === row.id);

      return {
        caseId: row.id,
        caseCode: row.caseCode,
        status: row.status,
        studyMode: row.studyMode,
        groundTruthIga: row.groundTruthIga,
        isSynthetic: row.isSynthetic,
        createdAt: new Date(row.createdAt).toISOString(),
        closedAt: row.closedAt === null ? null : new Date(row.closedAt).toISOString(),
        // The clinically binding severity of the visit is the specialist's latest judgement, not
        // the model's suggestion and not the consensus label used for the study metrics.
        severity: caseDiagnoses.length === 0 ? null : (caseDiagnoses.at(-1)?.igaClass ?? null),
        diagnoses: caseDiagnoses,
        timings: timings
          .filter((t) => t.caseId === row.id)
          .map(
            (t): HistoryTimingDto => ({
              studyMode: t.studyMode,
              t0: new Date(t.t0).toISOString(),
              reviewMinutes: t.durationSeconds === null ? null : t.durationSeconds / 60,
              valid: t.valid,
            }),
          ),
        inference:
          inference === undefined
            ? null
            : ({
                igaClass: inference.igaClass,
                confidence: inference.confidence,
                modelVersion: inference.modelVersion,
                modelBackend: inference.modelBackend,
                createdAt: new Date(inference.createdAt).toISOString(),
              } satisfies HistoryInferenceDto),
        images: images
          .filter((im) => im.caseId === row.id)
          .map(
            (im): CaseImageDto => ({
              id: im.id,
              caseId: im.caseId,
              mimeType: im.mimeType,
              width: im.width,
              height: im.height,
              sizeBytes: Number(im.sizeBytes),
              sha256: im.sha256,
              encrypted: im.encrypted,
              isHeatmap: im.isHeatmap,
              createdAt: new Date(im.createdAt).toISOString(),
              url: this.signedUrl.buildUrl(apiPrefix, im.id, user.id),
            }),
          ),
      };
    });

    return { patient, summary: this.summarise(timeline), timeline };
  }

  private summarise(timeline: HistoryEntryDto[]): PatientHistorySummaryDto {
    const graded = timeline.filter((entry) => entry.severity !== null);
    const first = graded[0]?.severity ?? null;
    const last = graded.at(-1)?.severity ?? null;

    const reviewMinutes = timeline
      .flatMap((entry) => entry.timings)
      .filter((timing) => timing.valid && timing.reviewMinutes !== null)
      .map((timing) => timing.reviewMinutes as number);

    let trend = 'sin_datos';
    let severityDelta: number | null = null;
    if (first !== null && last !== null && graded.length >= 2) {
      // IGA is ordinal and lower is better, so a negative delta is an improvement.
      severityDelta = IGA_ORDINAL[last] - IGA_ORDINAL[first];
      trend = severityDelta < 0 ? 'mejora' : severityDelta > 0 ? 'empeora' : 'estable';
    }

    return {
      totalCases: timeline.length,
      closedCases: timeline.filter((entry) => entry.status === 'closed').length,
      firstVisitAt: timeline[0]?.createdAt ?? null,
      lastVisitAt: timeline.at(-1)?.createdAt ?? null,
      firstSeverity: first,
      lastSeverity: last,
      trend,
      severityDelta,
      totalReviews: timeline.reduce((acc, entry) => acc + entry.timings.length, 0),
      averageReviewMinutes:
        reviewMinutes.length === 0
          ? null
          : Math.round((reviewMinutes.reduce((a, b) => a + b, 0) / reviewMinutes.length) * 100) /
            100,
    };
  }

  private emptySummary(): PatientHistorySummaryDto {
    return {
      totalCases: 0,
      closedCases: 0,
      firstVisitAt: null,
      lastVisitAt: null,
      firstSeverity: null,
      lastSeverity: null,
      trend: 'sin_datos',
      severityDelta: null,
      totalReviews: 0,
      averageReviewMinutes: null,
    };
  }
}

interface RawCase {
  id: string;
  caseCode: string;
  status: CaseStatus;
  studyMode: StudyMode;
  groundTruthIga: IgaClass | null;
  isSynthetic: boolean;
  createdAt: string;
  closedAt: string | null;
}

interface RawDiagnosis {
  id: string;
  caseId: string;
  studyMode: StudyMode;
  igaClass: IgaClass;
  gagsScore: number | null;
  notes: string | null;
  createdAt: string;
  professional: string;
}

interface RawTiming {
  caseId: string;
  studyMode: StudyMode;
  t0: string;
  durationSeconds: number | null;
  valid: boolean;
}

interface RawInference {
  caseId: string;
  igaClass: IgaClass | null;
  confidence: number | null;
  modelVersion: string;
  modelBackend: string;
  createdAt: string;
}

interface RawImage {
  id: string;
  caseId: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: string;
  sha256: string;
  encrypted: boolean;
  isHeatmap: boolean;
  createdAt: string;
}
