import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  EXPERIMENTAL_MODES,
  INDICATOR_DEFINITIONS,
  STATS_FUNCTION_VERSION,
  evaluateTarget,
  type ExperimentalMode,
  type IgaClass,
  type IndicatorKey,
  type PairedObservation,
} from 'src/common/domain';
import { describe, hashInput, round } from 'src/common/utils/descriptive';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { SurveysService } from 'src/surveys/surveys.service';

import { buildClassificationReport, type ClassifiedPair } from './classification';
import type {
  ClassificationReportDto,
  DashboardDto,
  IndicatorByProfessionalDto,
  IndicatorComparisonDto,
  IndicatorValueDto,
} from './dto/indicator.dto';
import { IndicatorSnapshot } from './indicator-snapshot.entity';

interface ComputeOptions {
  includeSynthetic?: boolean;
  userIds?: string[];
}

/**
 * Computation of the four indicators of the dependent variable.
 *
 * Covers: OE1 (TRM), OE2 (TPD), OE3 (TSP), OE4 (TCAD) — RF-OE1-03, RF-OE2-03, RF-OE2-04,
 * RF-OE3-03, RF-OE4-02 — and RNF-05 (every computation is snapshotted immutably).
 *
 * All queries read the measurement tables (`review_timings`, `diagnoses`, `work_sessions`,
 * `survey_responses`), never `cases.study_mode`: a case is the pairing unit and carries one
 * measurement per condition.
 */
@Injectable()
export class IndicatorsService {
  constructor(
    @InjectRepository(IndicatorSnapshot)
    private readonly snapshots: Repository<IndicatorSnapshot>,
    private readonly surveysService: SurveysService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------------------
  // OE1 — TRM = (Σ TRᵢ) / n, in minutes per case
  // ---------------------------------------------------------------------------

  async trm(mode: ExperimentalMode, options: ComputeOptions = {}): Promise<IndicatorValueDto> {
    const rows = await this.snapshots.manager.query<Array<{ case_id: string; minutes: string }>>(
      `SELECT t."case_id", (t."duration_seconds"::numeric / 60) AS minutes
         FROM "review_timings" t
         JOIN "cases" c ON c."id" = t."case_id"
        WHERE t."study_mode" = $1
          AND t."valid" = true
          AND t."duration_seconds" IS NOT NULL
          AND ($2::boolean OR c."is_synthetic" = false)
          AND ($3::uuid[] IS NULL OR t."user_id" = ANY($3::uuid[]))
        ORDER BY t."case_id" ASC`,
      [mode, options.includeSynthetic ?? false, options.userIds ?? null],
    );

    const observations = rows.map((row) => round(Number(row.minutes), 4));
    return this.buildValue('TRM', mode, this.average(observations), observations, rows);
  }

  // ---------------------------------------------------------------------------
  // OE2 — TPD = (DC / DT) × 100
  // ---------------------------------------------------------------------------

  /**
   * Correctness of each measurement, as 1 (correcto) or 0 (incorrecto).
   *
   * What is judged depends on the condition, exactly as the design prescribes:
   *  - pretest  the physician's manual diagnosis (there is no AI to judge);
   *  - postest  the CNN's preliminary diagnosis, which is what OE2 is about.
   *
   * Both are judged against `cases.ground_truth_iga`, the consensus label of the retrospective
   * lot. That common standard is what makes the two conditions comparable (RF-OE2-05); rows with
   * no consensus label are excluded rather than judged against a moving reference.
   */
  private async correctnessRows(
    mode: ExperimentalMode,
    options: ComputeOptions,
  ): Promise<Array<{ caseId: string; caseCode: string; correct: number; reference: IgaClass; predicted: IgaClass }>> {
    const predictedExpression =
      mode === 'postest' ? 'ai."iga_class"' : 'd."iga_class"';

    return this.snapshots.manager.query(
      `SELECT c."id"           AS "caseId",
              c."case_code"    AS "caseCode",
              c."ground_truth_iga" AS "reference",
              ${predictedExpression} AS "predicted",
              CASE WHEN ${predictedExpression} = c."ground_truth_iga" THEN 1 ELSE 0 END AS "correct"
         FROM "diagnoses" d
         JOIN "cases" c ON c."id" = d."case_id"
         LEFT JOIN LATERAL (
              SELECT i."iga_class"
                FROM "ai_inferences" i
               WHERE i."case_id" = c."id" AND i."status" = 'succeeded'
               ORDER BY i."created_at" DESC
               LIMIT 1
         ) ai ON true
        WHERE d."study_mode" = $1
          AND c."ground_truth_iga" IS NOT NULL
          AND ${predictedExpression} IS NOT NULL
          AND ($2::boolean OR c."is_synthetic" = false)
          AND ($3::uuid[] IS NULL OR d."user_id" = ANY($3::uuid[]))
        ORDER BY c."case_code" ASC`,
      [mode, options.includeSynthetic ?? false, options.userIds ?? null],
    );
  }

  async tpd(mode: ExperimentalMode, options: ComputeOptions = {}): Promise<IndicatorValueDto> {
    const rows = await this.correctnessRows(mode, options);
    const observations = rows.map((row) => Number(row.correct));
    const correct = observations.reduce((acc: number, v) => acc + v, 0);
    const value = observations.length === 0 ? 0 : round((correct / observations.length) * 100, 2);
    return this.buildValue('TPD', mode, value, observations, rows);
  }

  /** RF-OE2-04: full classification report for the condition. */
  async classificationReport(
    mode: ExperimentalMode,
    options: ComputeOptions = {},
  ): Promise<ClassificationReportDto> {
    const rows = await this.correctnessRows(mode, options);
    const pairs: ClassifiedPair[] = rows.map((row) => ({
      reference: row.reference,
      predicted: row.predicted,
    }));
    return buildClassificationReport(
      pairs,
      mode,
      pairs.length === 0 ? 'sin_patron' : 'ground_truth',
    );
  }

  // ---------------------------------------------------------------------------
  // OE3 — TSP = (Σ PO / PT) × 100
  // ---------------------------------------------------------------------------

  async tsp(options: ComputeOptions = {}): Promise<IndicatorValueDto> {
    const rows = await this.surveysService.tspValues(options.includeSynthetic ?? false);
    const observations = rows.map((row) => round(row.tspPct, 4));
    return this.buildValue('TSP', 'postest', this.average(observations), observations, rows);
  }

  // ---------------------------------------------------------------------------
  // OE4 — TCAD = NCR / TJ, in cases per hour
  // ---------------------------------------------------------------------------

  async tcad(mode: ExperimentalMode, options: ComputeOptions = {}): Promise<IndicatorValueDto> {
    const rows = await this.snapshots.manager.query<Array<{ id: string; tcad: string }>>(
      `SELECT s."id", s."tcad"
         FROM "work_sessions" s
        WHERE s."study_mode" = $1
          AND s."ended_at" IS NOT NULL
          AND s."tcad" IS NOT NULL
          AND ($2::boolean OR s."is_synthetic" = false)
          AND ($3::uuid[] IS NULL OR s."user_id" = ANY($3::uuid[]))
        ORDER BY s."started_at" ASC`,
      [mode, options.includeSynthetic ?? false, options.userIds ?? null],
    );

    const observations = rows.map((row) => round(Number(row.tcad), 4));
    return this.buildValue('TCAD', mode, this.average(observations), observations, rows);
  }

  // ---------------------------------------------------------------------------
  // Comparisons and dashboard
  // ---------------------------------------------------------------------------

  async compare(indicator: IndicatorKey, options: ComputeOptions = {}): Promise<IndicatorComparisonDto> {
    const definition = INDICATOR_DEFINITIONS[indicator];

    let pretest: IndicatorValueDto | null = null;
    let postest: IndicatorValueDto | null = null;

    if (indicator === 'TSP') {
      // RF-OE3-05: the questionnaire is applied only in postest, so there is no pretest sample.
      // The contrast is against a declared baseline, handled by the statistics module.
      postest = await this.tsp(options);
    } else {
      [pretest, postest] = await Promise.all([
        this.computeFor(indicator, 'pretest', options),
        this.computeFor(indicator, 'postest', options),
      ]);
    }

    const pretestValue = pretest === null || pretest.observations.length === 0 ? null : pretest.value;
    const postestValue = postest === null || postest.observations.length === 0 ? null : postest.value;

    const meanLikert =
      indicator === 'TSP'
        ? (await this.surveysService.summary(options.includeSynthetic ?? false)).meanLikert
        : null;

    const evaluation = evaluateTarget(indicator, {
      pretest: pretestValue,
      postest: postestValue,
      meanLikert,
    });

    const absoluteChange =
      pretestValue === null || postestValue === null ? null : round(postestValue - pretestValue, 4);
    const relativeChangePct =
      pretestValue === null || postestValue === null || pretestValue === 0
        ? null
        : round(((postestValue - pretestValue) / pretestValue) * 100, 2);

    return {
      indicator,
      definition,
      pretest,
      postest,
      absoluteChange,
      relativeChangePct,
      targetMet: evaluation.targetMet,
      alert: evaluation.alert,
    };
  }

  async dashboard(options: ComputeOptions = {}): Promise<DashboardDto> {
    const indicators = await Promise.all(
      (['TRM', 'TPD', 'TSP', 'TCAD'] as const).map((key) => this.compare(key, options)),
    );
    return {
      indicators,
      includesSynthetic: options.includeSynthetic ?? false,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Paired samples consumed by the hypothesis contrasts
  // ---------------------------------------------------------------------------

  /** HE1: one pair per case — the same case reviewed without and with AI. */
  async pairedTrm(options: ComputeOptions = {}): Promise<PairedObservation[]> {
    const rows = await this.snapshots.manager.query<
      Array<{ caseCode: string; caseId: string; pretest: string; postest: string }>
    >(
      `SELECT c."id" AS "caseId",
              c."case_code" AS "caseCode",
              (pre."duration_seconds"::numeric / 60) AS "pretest",
              (post."duration_seconds"::numeric / 60) AS "postest"
         FROM "cases" c
         JOIN "review_timings" pre
           ON pre."case_id" = c."id" AND pre."study_mode" = 'pretest'
          AND pre."valid" = true AND pre."duration_seconds" IS NOT NULL
         JOIN "review_timings" post
           ON post."case_id" = c."id" AND post."study_mode" = 'postest'
          AND post."valid" = true AND post."duration_seconds" IS NOT NULL
        WHERE ($1::boolean OR c."is_synthetic" = false)
        ORDER BY c."case_code" ASC`,
      [options.includeSynthetic ?? false],
    );

    return rows.map((row) => this.toPair(row.caseId, row.caseCode, Number(row.pretest), Number(row.postest)));
  }

  /**
   * HE2: one pair per case, each side being 1 (correcto) or 0 (incorrecto) against the consensus
   * label — the manual diagnosis in pretest, the CNN's prediction in postest.
   *
   * Paired binary data is never normally distributed, so Shapiro-Wilk will reject normality and
   * the mandated rule lands on Wilcoxon signed-rank, which for 0/1 differences is the
   * non-parametric analogue of McNemar's test. The decision rule of the thesis is followed
   * literally and the resulting test is the statistically appropriate one.
   */
  async pairedTpd(options: ComputeOptions = {}): Promise<PairedObservation[]> {
    const rows = await this.snapshots.manager.query<
      Array<{ caseId: string; caseCode: string; pretest: number; postest: number }>
    >(
      `SELECT c."id" AS "caseId",
              c."case_code" AS "caseCode",
              CASE WHEN dpre."iga_class" = c."ground_truth_iga" THEN 1 ELSE 0 END AS "pretest",
              CASE WHEN ai."iga_class"  = c."ground_truth_iga" THEN 1 ELSE 0 END AS "postest"
         FROM "cases" c
         JOIN "diagnoses" dpre
           ON dpre."case_id" = c."id" AND dpre."study_mode" = 'pretest'
         JOIN "diagnoses" dpost
           ON dpost."case_id" = c."id" AND dpost."study_mode" = 'postest'
         JOIN LATERAL (
              SELECT i."iga_class"
                FROM "ai_inferences" i
               WHERE i."case_id" = c."id" AND i."status" = 'succeeded'
               ORDER BY i."created_at" DESC
               LIMIT 1
         ) ai ON true
        WHERE c."ground_truth_iga" IS NOT NULL
          AND ($1::boolean OR c."is_synthetic" = false)
        ORDER BY c."case_code" ASC`,
      [options.includeSynthetic ?? false],
    );

    return rows.map((row) => this.toPair(row.caseId, row.caseCode, Number(row.pretest), Number(row.postest)));
  }

  /**
   * HE4: journeys matched per professional.
   *
   * Journeys are paired in chronological order within each professional (the k-th pretest journey
   * with their k-th postest journey) and the surplus is dropped. Pairing by professional and
   * position is what keeps the comparison within-subject, as the repeated-measures design
   * requires; pooling journeys across professionals would confound the effect with who worked.
   */
  async pairedTcad(options: ComputeOptions = {}): Promise<PairedObservation[]> {
    const rows = await this.snapshots.manager.query<
      Array<{ userId: string; fullName: string; studyMode: ExperimentalMode; tcad: string; startedAt: string }>
    >(
      `SELECT s."user_id" AS "userId",
              u."full_name" AS "fullName",
              s."study_mode" AS "studyMode",
              s."tcad",
              s."started_at" AS "startedAt"
         FROM "work_sessions" s
         JOIN "users" u ON u."id" = s."user_id"
        WHERE s."ended_at" IS NOT NULL
          AND s."tcad" IS NOT NULL
          AND s."study_mode" IN ('pretest','postest')
          AND ($1::boolean OR s."is_synthetic" = false)
        ORDER BY s."user_id", s."started_at" ASC`,
      [options.includeSynthetic ?? false],
    );

    const byUser = new Map<string, { fullName: string; pretest: number[]; postest: number[] }>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { fullName: row.fullName, pretest: [], postest: [] };
      entry[row.studyMode].push(Number(row.tcad));
      byUser.set(row.userId, entry);
    }

    const pairs: PairedObservation[] = [];
    for (const [userId, entry] of byUser) {
      const count = Math.min(entry.pretest.length, entry.postest.length);
      for (let i = 0; i < count; i++) {
        const pre = entry.pretest[i];
        const post = entry.postest[i];
        if (pre === undefined || post === undefined) continue;
        pairs.push(this.toPair(`${userId}:${i}`, `${entry.fullName} — jornada ${i + 1}`, pre, post));
      }
    }
    return pairs;
  }

  /** HE3: per-respondent TSP values, contrasted against the declared baseline (RF-OE3-05). */
  async tspSample(options: ComputeOptions = {}): Promise<{ values: number[]; baseline: number }> {
    const rows = await this.surveysService.tspValues(options.includeSynthetic ?? false);
    return {
      values: rows.map((row) => round(row.tspPct, 4)),
      baseline: this.config.study.tspBaselinePercent,
    };
  }

  /** RF-OE4-04: per-professional breakdown for the comparative boxplots. */
  async byProfessional(
    indicator: IndicatorKey,
    options: ComputeOptions = {},
  ): Promise<IndicatorByProfessionalDto[]> {
    const users = await this.snapshots.manager.query<Array<{ id: string; fullName: string }>>(
      `SELECT "id", "full_name" AS "fullName"
         FROM "users"
        WHERE "role" IN ('dermatologo','residente')
        ORDER BY "full_name" ASC`,
    );

    const result: IndicatorByProfessionalDto[] = [];
    for (const user of users) {
      const scoped: ComputeOptions = { ...options, userIds: [user.id] };
      const [pretest, postest] = await Promise.all([
        this.computeFor(indicator, 'pretest', scoped),
        this.computeFor(indicator, 'postest', scoped),
      ]);
      result.push({
        userId: user.id,
        fullName: user.fullName,
        pretest: pretest.observations,
        postest: postest.observations,
        pretestStats: pretest.observations.length === 0 ? null : pretest.descriptive,
        postestStats: postest.observations.length === 0 ? null : postest.descriptive,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async computeFor(
    indicator: IndicatorKey,
    mode: ExperimentalMode,
    options: ComputeOptions,
  ): Promise<IndicatorValueDto> {
    switch (indicator) {
      case 'TRM':
        return this.trm(mode, options);
      case 'TPD':
        return this.tpd(mode, options);
      case 'TSP':
        return this.tsp(options);
      case 'TCAD':
        return this.tcad(mode, options);
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return round(values.reduce((acc, v) => acc + v, 0) / values.length, 4);
  }

  private toPair(key: string, label: string, pretest: number, postest: number): PairedObservation {
    return {
      pairKey: key,
      label,
      pretest: round(pretest, 4),
      postest: round(postest, 4),
      difference: round(postest - pretest, 4),
    };
  }

  private async buildValue(
    indicator: IndicatorKey,
    mode: ExperimentalMode,
    value: number,
    observations: number[],
    rawInput: unknown,
  ): Promise<IndicatorValueDto> {
    const definition = INDICATOR_DEFINITIONS[indicator];
    return {
      indicator,
      studyMode: mode,
      value,
      unit: definition.unit,
      observations,
      descriptive: describe(observations),
      inputHash: hashInput(rawInput),
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Persists an immutable snapshot of a computation (RNF-05). Called when an indicator value is
   * used as evidence — a report or a hypothesis contrast — rather than on every dashboard refresh,
   * which would flood the log with duplicates of the same number.
   */
  async snapshot(
    value: IndicatorValueDto,
    computedBy: string | null,
    includesSynthetic: boolean,
  ): Promise<IndicatorSnapshot> {
    return this.snapshots.save(
      this.snapshots.create({
        indicator: value.indicator,
        studyMode: value.studyMode,
        scope: 'global',
        value: value.value,
        unit: value.unit,
        n: value.observations.length,
        observations: value.observations,
        descriptive: value.descriptive as unknown as Record<string, number>,
        inputHash: value.inputHash,
        functionVersion: STATS_FUNCTION_VERSION,
        includesSynthetic,
        computedBy,
      }),
    );
  }

  async snapshotAll(computedBy: string | null, includeSynthetic: boolean): Promise<number> {
    let count = 0;
    for (const indicator of ['TRM', 'TPD', 'TSP', 'TCAD'] as const) {
      for (const mode of EXPERIMENTAL_MODES) {
        if (indicator === 'TSP' && mode === 'pretest') continue;
        const value = await this.computeFor(indicator, mode, { includeSynthetic });
        if (value.observations.length === 0) continue;
        await this.snapshot(value, computedBy, includeSynthetic);
        count++;
      }
    }
    return count;
  }
}
