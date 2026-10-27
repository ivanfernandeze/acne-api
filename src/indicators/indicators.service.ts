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
import { IndicatorObservation } from './indicator-observation.entity';
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
      `SELECT t."caso_id", (t."duracion_segundos"::numeric / 60) AS minutes
         FROM "cronometrajes_revision" t
         JOIN "casos" c ON c."id" = t."caso_id"
        WHERE t."modo_estudio_codigo" = $1
          AND t."valido" = true
          AND t."duracion_segundos" IS NOT NULL
          AND ($2::boolean OR c."es_sintetico" = false)
          AND c."anulado_en" IS NULL
          AND ($3::uuid[] IS NULL OR t."usuario_id" = ANY($3::uuid[]))
        ORDER BY t."caso_id" ASC`,
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
      mode === 'postest' ? 'ai."clase_iga_codigo"' : 'd."clase_iga_codigo"';

    return this.snapshots.manager.query(
      `SELECT c."id"           AS "caseId",
              c."codigo_caso"    AS "caseCode",
              c."clase_iga_referencia" AS "reference",
              ${predictedExpression} AS "predicted",
              CASE WHEN ${predictedExpression} = c."clase_iga_referencia" THEN 1 ELSE 0 END AS "correct"
         FROM "diagnosticos" d
         JOIN "casos" c ON c."id" = d."caso_id"
         LEFT JOIN LATERAL (
              SELECT i."clase_iga_codigo"
                FROM "inferencias_ia" i
               WHERE i."caso_id" = c."id" AND i."estado_codigo" = 'exitoso'
               ORDER BY i."creado_en" DESC
               LIMIT 1
         ) ai ON true
        WHERE d."modo_estudio_codigo" = $1
          AND c."clase_iga_referencia" IS NOT NULL
          AND ${predictedExpression} IS NOT NULL
          AND ($2::boolean OR c."es_sintetico" = false)
          AND c."anulado_en" IS NULL
          AND ($3::uuid[] IS NULL OR d."usuario_id" = ANY($3::uuid[]))
        ORDER BY c."codigo_caso" ASC`,
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
         FROM "jornadas_trabajo" s
        WHERE s."modo_estudio_codigo" = $1
          AND s."finalizada_en" IS NOT NULL
          AND s."tcad" IS NOT NULL
          AND ($2::boolean OR s."es_sintetico" = false)
          AND ($3::uuid[] IS NULL OR s."usuario_id" = ANY($3::uuid[]))
        ORDER BY s."iniciada_en" ASC`,
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
              c."codigo_caso" AS "caseCode",
              (pre."duracion_segundos"::numeric / 60) AS "pretest",
              (post."duracion_segundos"::numeric / 60) AS "postest"
         FROM "casos" c
         JOIN "cronometrajes_revision" pre
           ON pre."caso_id" = c."id" AND pre."modo_estudio_codigo" = 'pretest'
          AND pre."valido" = true AND pre."duracion_segundos" IS NOT NULL
         JOIN "cronometrajes_revision" post
           ON post."caso_id" = c."id" AND post."modo_estudio_codigo" = 'postest'
          AND post."valido" = true AND post."duracion_segundos" IS NOT NULL
        WHERE ($1::boolean OR c."es_sintetico" = false)
          AND c."anulado_en" IS NULL
        ORDER BY c."codigo_caso" ASC`,
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
              c."codigo_caso" AS "caseCode",
              CASE WHEN dpre."clase_iga_codigo" = c."clase_iga_referencia" THEN 1 ELSE 0 END AS "pretest",
              CASE WHEN ai."clase_iga_codigo"  = c."clase_iga_referencia" THEN 1 ELSE 0 END AS "postest"
         FROM "casos" c
         JOIN "diagnosticos" dpre
           ON dpre."caso_id" = c."id" AND dpre."modo_estudio_codigo" = 'pretest'
         JOIN "diagnosticos" dpost
           ON dpost."caso_id" = c."id" AND dpost."modo_estudio_codigo" = 'postest'
         JOIN LATERAL (
              SELECT i."clase_iga_codigo"
                FROM "inferencias_ia" i
               WHERE i."caso_id" = c."id" AND i."estado_codigo" = 'exitoso'
               ORDER BY i."creado_en" DESC
               LIMIT 1
         ) ai ON true
        WHERE c."clase_iga_referencia" IS NOT NULL
          AND ($1::boolean OR c."es_sintetico" = false)
          AND c."anulado_en" IS NULL
        ORDER BY c."codigo_caso" ASC`,
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
      `SELECT s."usuario_id" AS "userId",
              u."nombre_completo" AS "fullName",
              s."modo_estudio_codigo" AS "studyMode",
              s."tcad",
              s."iniciada_en" AS "startedAt"
         FROM "jornadas_trabajo" s
         JOIN "usuarios" u ON u."id" = s."usuario_id"
        WHERE s."finalizada_en" IS NOT NULL
          AND s."tcad" IS NOT NULL
          AND s."modo_estudio_codigo" IN ('pretest','postest')
          -- OE4 mide capacidad de atención DIAGNÓSTICA. El mostrador también abre jornada desde
          -- que registra su propio trabajo, pero su NCR cuenta pacientes admitidos, no casos
          -- diagnosticados: mezclar las dos cifras en un mismo contraste compararía peras con
          -- manzanas y hundiría la media con jornadas que nunca diagnosticaron nada.
          AND u."rol_codigo" = 'dermatologo'
          AND ($1::boolean OR s."es_sintetico" = false)
        ORDER BY s."usuario_id", s."iniciada_en" ASC`,
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
    // Los profesionales sinteticos siguen la MISMA regla que los casos sinteticos: si el tablero
    // excluye los datos de demostracion, no puede seguir dibujando una caja por cada profesional
    // inventado, porque quedarian cuatro cajas vacias junto a las reales.
    const users = await this.snapshots.manager.query<Array<{ id: string; fullName: string }>>(
      `SELECT "id", "nombre_completo" AS "fullName"
         FROM "usuarios"
        WHERE "rol_codigo" = 'dermatologo'
          AND ($1::boolean OR "es_sintetico" = false)
        ORDER BY "nombre_completo" ASC`,
      [options.includeSynthetic ?? false],
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
    // Los ocho descriptivos son ahora columnas y las observaciones son filas; el `cascade` de
    // `observationRows` las inserta en la misma transaccion que la cabecera, que es lo que hace
    // del par (instantanea, observaciones) un log atomico y no dos escrituras que pueden partirse.
    return this.snapshots.save(
      this.snapshots.create({
        indicator: value.indicator,
        studyMode: value.studyMode,
        scope: 'global',
        value: value.value,
        unit: value.unit,
        n: value.observations.length,
        mean: value.descriptive.mean,
        sd: value.descriptive.sd,
        min: value.descriptive.min,
        q1: value.descriptive.q1,
        median: value.descriptive.median,
        q3: value.descriptive.q3,
        max: value.descriptive.max,
        observationRows: value.observations.map((observation, index) => ({
          position: index,
          value: observation,
        })) as IndicatorObservation[],
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
