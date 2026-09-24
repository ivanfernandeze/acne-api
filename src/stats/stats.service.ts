import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  DEFAULT_ALPHA,
  GENERAL_HYPOTHESIS,
  HYPOTHESES,
  HYPOTHESIS_ALTERNATIVE,
  HYPOTHESIS_DESIGN,
  HYPOTHESIS_INDICATOR,
  HYPOTHESIS_NULL_STATEMENTS,
  HYPOTHESIS_STATEMENTS,
  INDICATOR_DEFINITIONS,
  STATISTICAL_TEST_LABELS,
  type EffectSize,
  type HypothesisKey,
  type NormalityResult,
  type PairedObservation,
} from 'src/common/domain';
import { hashInput, mean, round } from 'src/common/utils/descriptive';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { IndicatorsService } from 'src/indicators/indicators.service';
import { AiEngineClient } from 'src/inference/ai-engine.client';

import type {
  GeneralHypothesisResultDto,
  HypothesisTestRequestDto,
  HypothesisTestResultDto,
} from './dto/stats.dto';
import { HypothesisPair } from './hypothesis-pair.entity';
import { HypothesisRun } from './hypothesis-run.entity';

/**
 * Automated contrast of HE₁–HE₄.
 *
 * Covers: RF-OE1-04, RF-OE2-05, RF-OE3-05, RF-OE4-03 and RNF-05.
 *
 * The decision rule is the one the thesis mandates: Shapiro-Wilk over the paired differences,
 * then paired t-Student when normality is not rejected and Wilcoxon signed-rank when it is, at
 * α = 0,05. The arithmetic itself runs in `acne-ai-engine` with SciPy, which is where the
 * mandated stack puts statistical analysis; this service assembles the sample, records the run
 * and writes the verdict.
 */
@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(HypothesisRun) private readonly runs: Repository<HypothesisRun>,
    private readonly indicators: IndicatorsService,
    private readonly aiEngine: AiEngineClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(
    dto: HypothesisTestRequestDto,
    executedBy: string | null,
  ): Promise<HypothesisTestResultDto> {
    const alpha = dto.alpha ?? this.config.study.alpha ?? DEFAULT_ALPHA;
    const design = HYPOTHESIS_DESIGN[dto.hypothesis];
    const alternative = HYPOTHESIS_ALTERNATIVE[dto.hypothesis];
    const indicator = HYPOTHESIS_INDICATOR[dto.hypothesis];
    const includeSynthetic = dto.includeSynthetic ?? false;
    const options = { includeSynthetic, userIds: dto.userIds };

    let pairs: PairedObservation[];
    let pretestValues: number[];
    let postestValues: number[];
    let baseline: number | undefined;

    if (design === 'one_sample') {
      // HE₃: the questionnaire is applied only in postest, so it is contrasted against a declared
      // baseline or the neutral theoretical value (RF-OE3-05).
      const sample = await this.indicators.tspSample(options);
      baseline = dto.baseline ?? sample.baseline;
      postestValues = sample.values;
      pretestValues = sample.values.map(() => baseline as number);
      pairs = sample.values.map((value, index) => ({
        pairKey: `respondent-${index + 1}`,
        label: `Encuestado ${index + 1}`,
        pretest: baseline as number,
        postest: value,
        difference: round(value - (baseline as number), 4),
      }));
    } else {
      pairs = await this.collectPairs(dto.hypothesis, options);
      pretestValues = pairs.map((p) => p.pretest);
      postestValues = pairs.map((p) => p.postest);
    }

    if (pairs.length < 3) {
      throw new BadRequestException(
        `No hay suficientes mediciones pareadas para contrastar ${dto.hypothesis}: se encontraron ` +
          `${pairs.length} y se requieren al menos 3. Verifique que existan mediciones en ambas ` +
          'condiciones sobre las mismas unidades de análisis.',
      );
    }

    const response = await this.aiEngine.pairedTest({
      design,
      alpha,
      alternative,
      pretest: pretestValues,
      postest: design === 'paired' ? postestValues : postestValues,
      baseline,
      seed: 42,
    });

    const normality: NormalityResult = {
      test: 'shapiro-wilk',
      statistic: response.normality.statistic,
      pValue: response.normality.p_value,
      normal: response.normality.normal,
      applicable: response.normality.applicable,
      ...(response.normality.note === null ? {} : { note: response.normality.note }),
    };

    const rejectsNull = response.p_value < alpha;
    const pretestMean = round(mean(pretestValues), 4);
    const postestMean = round(mean(postestValues), 4);
    const meanDifference = round(postestMean - pretestMean, 4);

    const saved = await this.runs.save(
      this.runs.create({
        hypothesis: dto.hypothesis,
        indicator,
        design,
        alpha,
        alternative,
        nPairs: pairs.length,
        pretestMean,
        postestMean,
        meanDifference,
        normalityTest: normality.test,
        normalityStatistic: normality.applicable ? normality.statistic : null,
        normalityPValue: normality.applicable ? normality.pValue : null,
        normalityNormal: normality.normal,
        normalityApplicable: normality.applicable,
        normalityNote: normality.note ?? null,
        testApplied: response.test_applied,
        statistic: response.statistic,
        pValue: response.p_value,
        effectKind: response.effect_size?.kind ?? null,
        effectValue: response.effect_size?.value ?? null,
        effectMagnitude: response.effect_size?.magnitude ?? null,
        rejectsNull,
        conclusion: this.buildConclusion(dto.hypothesis, {
          rejectsNull,
          alpha,
          pValue: response.p_value,
          pretestMean,
          postestMean,
          nPairs: pairs.length,
          testApplied: response.test_applied,
          normality,
          baseline,
        }),
        // Se guardan por valor: si el caso cambia manana, el contraste ya publicado debe seguir
        // siendo reproducible exactamente como se corrio.
        pairRows: pairs.map((pair) => ({
          pairKey: pair.pairKey,
          label: pair.label,
          pretest: pair.pretest,
          postest: pair.postest,
          difference: pair.difference,
        })) as HypothesisPair[],
        seed: 42,
        functionVersion: response.function_version,
        inputHash: hashInput({ hypothesis: dto.hypothesis, alpha, alternative, pairs }),
        includesSynthetic: includeSynthetic,
        executedBy,
      }),
    );

    return this.toDto(saved);
  }

  /** Runs the four specific contrasts and derives the verdict on the general hypothesis H₁ (OG). */
  async runAll(
    dto: Omit<HypothesisTestRequestDto, 'hypothesis'>,
    executedBy: string | null,
  ): Promise<GeneralHypothesisResultDto> {
    const results: HypothesisTestResultDto[] = [];
    const failures: string[] = [];

    for (const hypothesis of HYPOTHESES) {
      try {
        results.push(await this.run({ ...dto, hypothesis }, executedBy));
      } catch (error: unknown) {
        failures.push(
          `${hypothesis}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const rejected = results.filter((r) => r.rejectsNull).length;
    // OG asks whether AI affects the agility of the process. Rejecting H₀ in at least one
    // dimension establishes an effect on the multidimensional dependent variable; the report
    // states how many of the four dimensions carried it, so the claim is never overstated.
    const rejectsNull = rejected > 0;

    let conclusion =
      results.length === 0
        ? 'No se pudo ejecutar ningún contraste: no hay mediciones pareadas suficientes.'
        : rejectsNull
          ? `Se rechaza H₀ en ${rejected} de ${results.length} hipótesis específicas contrastadas ` +
            `(${results
              .filter((r) => r.rejectsNull)
              .map((r) => r.hypothesis)
              .join(', ')}). Existe evidencia de que la aplicación de la inteligencia artificial ` +
            'afecta significativamente la agilización del proceso de diagnóstico de acné.'
          : `No se rechaza H₀ en ninguna de las ${results.length} hipótesis específicas ` +
            'contrastadas. Con los datos disponibles no hay evidencia suficiente de un efecto ' +
            'significativo sobre la agilización del proceso de diagnóstico de acné.';

    if (failures.length > 0) {
      conclusion += ` Contrastes no ejecutados: ${failures.join(' · ')}.`;
    }

    return {
      results,
      rejectedCount: rejected,
      totalCount: results.length,
      rejectsNull,
      h1: GENERAL_HYPOTHESIS.h1,
      h0: GENERAL_HYPOTHESIS.h0,
      conclusion,
    };
  }

  async history(hypothesis?: HypothesisKey, limit = 50): Promise<HypothesisTestResultDto[]> {
    const runs = await this.runs.find({
      where: hypothesis === undefined ? {} : { hypothesis },
      order: { executedAt: 'DESC' },
      take: Math.min(limit, 200),
      // Los pares dejaron de ser una columna jsonb y son filas de `pares_hipotesis`. Sin pedir la
      // relacion, TypeORM devuelve la cabecera y `pairs` sale vacio en el DTO: el contraste se
      // veria correcto pero sin los datos que lo hacen reejecutable, que es justo lo que RNF-05
      // exige poder mostrar a un evaluador externo.
      relations: { pairRows: true },
    });
    return runs.map((run) => this.toDto(run));
  }

  private async collectPairs(
    hypothesis: HypothesisKey,
    options: { includeSynthetic: boolean; userIds?: string[] },
  ): Promise<PairedObservation[]> {
    switch (hypothesis) {
      case 'HE1':
        return this.indicators.pairedTrm(options);
      case 'HE2':
        return this.indicators.pairedTpd(options);
      case 'HE4':
        return this.indicators.pairedTcad(options);
      case 'HE3':
        return [];
    }
  }

  private buildConclusion(
    hypothesis: HypothesisKey,
    context: {
      rejectsNull: boolean;
      alpha: number;
      pValue: number;
      pretestMean: number;
      postestMean: number;
      nPairs: number;
      testApplied: string;
      normality: NormalityResult;
      baseline: number | undefined;
    },
  ): string {
    const definition = INDICATOR_DEFINITIONS[HYPOTHESIS_INDICATOR[hypothesis]];
    const testLabel = STATISTICAL_TEST_LABELS[context.testApplied as keyof typeof STATISTICAL_TEST_LABELS];
    const p = context.pValue < 0.001 ? 'p < 0,001' : `p = ${context.pValue.toFixed(4).replace('.', ',')}`;

    const normalityText = context.normality.applicable
      ? `Shapiro-Wilk sobre las diferencias arrojó W = ${context.normality.statistic
          .toFixed(4)
          .replace('.', ',')} (p = ${context.normality.pValue.toFixed(4).replace('.', ',')}), por lo que ` +
        `${context.normality.normal ? 'no se rechaza' : 'se rechaza'} la normalidad y se aplicó la ${testLabel}.`
      : `La muestra es demasiado pequeña para Shapiro-Wilk, por lo que se aplicó la ${testLabel} de forma conservadora.`;

    const comparison =
      context.baseline === undefined
        ? `${definition.name} pasó de ${context.pretestMean.toFixed(2).replace('.', ',')} ` +
          `a ${context.postestMean.toFixed(2).replace('.', ',')} ${definition.unit} ` +
          `(n = ${context.nPairs} pares).`
        : `${definition.name} alcanzó ${context.postestMean.toFixed(2).replace('.', ',')} ${definition.unit} ` +
          `frente a la línea base declarada de ${context.baseline.toFixed(2).replace('.', ',')} ${definition.unit} ` +
          `(n = ${context.nPairs} encuestados).`;

    const verdict = context.rejectsNull
      ? `Con ${p} < α = ${context.alpha.toString().replace('.', ',')}, se RECHAZA H₀ y se acepta ${hypothesis}: ` +
        HYPOTHESIS_STATEMENTS[hypothesis]
      : `Con ${p} ≥ α = ${context.alpha.toString().replace('.', ',')}, NO se rechaza H₀: ` +
        HYPOTHESIS_NULL_STATEMENTS[hypothesis];

    return `${comparison} ${normalityText} ${verdict}`;
  }

  private toDto(run: HypothesisRun): HypothesisTestResultDto {
    return {
      id: run.id,
      hypothesis: run.hypothesis,
      statement: HYPOTHESIS_STATEMENTS[run.hypothesis],
      nullStatement: HYPOTHESIS_NULL_STATEMENTS[run.hypothesis],
      indicator: run.indicator,
      design: run.design,
      alpha: run.alpha,
      alternative: run.alternative,
      nPairs: run.nPairs,
      pretestMean: run.pretestMean,
      postestMean: run.postestMean,
      meanDifference: run.meanDifference,
      normality: toNormality(run),
      testApplied: run.testApplied,
      testLabel: STATISTICAL_TEST_LABELS[run.testApplied],
      statistic: run.statistic,
      pValue: run.pValue,
      effectSize: toEffectSize(run),
      rejectsNull: run.rejectsNull,
      conclusion: run.conclusion,
      pairs: (run.pairRows ?? []).map((pair) => ({
        pairKey: pair.pairKey,
        label: pair.label,
        pretest: pair.pretest,
        postest: pair.postest,
        difference: pair.difference,
      })),
      seed: run.seed,
      functionVersion: run.functionVersion,
      inputHash: run.inputHash,
      includesSynthetic: run.includesSynthetic,
      executedAt: run.executedAt.toISOString(),
    };
  }
}

/**
 * Rebuilds the normality block the DTO carries from the columns it was split into.
 *
 * The statistic and the p-value are null when Shapiro-Wilk did not apply (fewer than three
 * observations). The DTO's shape predates the split and requires numbers, so the non-applicable
 * case reports zeros next to `applicable: false` — the flag is what a reader must trust, and a
 * fabricated statistic would be worse than an obviously inert one.
 */
function toNormality(run: HypothesisRun): NormalityResult {
  return {
    test: 'shapiro-wilk',
    statistic: run.normalityStatistic ?? 0,
    pValue: run.normalityPValue ?? 0,
    normal: run.normalityNormal,
    applicable: run.normalityApplicable,
    ...(run.normalityNote === null ? {} : { note: run.normalityNote }),
  };
}

/** Rebuilds the effect size, which is absent whenever the test reported none. */
function toEffectSize(run: HypothesisRun): EffectSize | null {
  if (run.effectKind === null || run.effectValue === null || run.effectMagnitude === null) {
    return null;
  }
  return { kind: run.effectKind, value: run.effectValue, magnitude: run.effectMagnitude };
}
