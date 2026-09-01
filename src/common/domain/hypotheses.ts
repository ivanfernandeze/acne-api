/**
 * Hypotheses of the thesis and the decision rule for contrasting them.
 *
 * Covers: RF-OE1-04, RF-OE2-05, RF-OE3-05, RF-OE4-03 and RNF-05.
 * Rule mandated by the specification: Shapiro-Wilk on the paired differences, then paired
 * t-Student if the differences are normal, otherwise Wilcoxon signed-rank; alpha = 0,05.
 */
import type { IndicatorKey } from './indicators';

export const HYPOTHESES = ['HE1', 'HE2', 'HE3', 'HE4'] as const;
export type HypothesisKey = (typeof HYPOTHESES)[number];

export const HYPOTHESIS_STATEMENTS: Readonly<Record<HypothesisKey, string>> = {
  HE1: 'La implementación de IA reduce significativamente el tiempo de revisión médica del diagnóstico de acné.',
  HE2: 'La implementación de IA incrementa significativamente la precisión del diagnóstico preliminar de acné.',
  HE3: 'La implementación de IA incrementa significativamente la satisfacción del personal médico.',
  HE4: 'La implementación de IA incrementa significativamente la cantidad de casos de acné revisados por el personal médico.',
};

export const HYPOTHESIS_NULL_STATEMENTS: Readonly<Record<HypothesisKey, string>> = {
  HE1: 'La implementación de IA no reduce significativamente el tiempo de revisión médica.',
  HE2: 'La implementación de IA no incrementa significativamente la precisión del diagnóstico preliminar.',
  HE3: 'La implementación de IA no incrementa significativamente la satisfacción del personal médico.',
  HE4: 'La implementación de IA no incrementa significativamente la cantidad de casos revisados.',
};

export const HYPOTHESIS_INDICATOR: Readonly<Record<HypothesisKey, IndicatorKey>> = {
  HE1: 'TRM',
  HE2: 'TPD',
  HE3: 'TSP',
  HE4: 'TCAD',
};

export const GENERAL_HYPOTHESIS = {
  h1:
    'La aplicación de la inteligencia artificial afecta de manera significativa la agilización del ' +
    'proceso de diagnóstico de acné en un centro especializado en dermatología.',
  h0:
    'La aplicación de la inteligencia artificial no tiene un efecto significativo sobre la ' +
    'agilización del proceso de diagnóstico de acné.',
} as const;

/** Default significance level for every contrast of the study. */
export const DEFAULT_ALPHA = 0.05;

/** `paired` for HE1/HE2/HE4; `one_sample` for HE3 against a declared baseline (RF-OE3-05). */
export type TestDesign = 'paired' | 'one_sample';

export const HYPOTHESIS_DESIGN: Readonly<Record<HypothesisKey, TestDesign>> = {
  HE1: 'paired',
  HE2: 'paired',
  HE3: 'one_sample',
  HE4: 'paired',
};

export type StatisticalTest = 'ttest_rel' | 'wilcoxon' | 'ttest_1samp' | 'wilcoxon_1samp';

export const STATISTICAL_TEST_LABELS: Readonly<Record<StatisticalTest, string>> = {
  ttest_rel: 't de Student para muestras relacionadas',
  wilcoxon: 'Prueba de rangos con signo de Wilcoxon',
  ttest_1samp: 't de Student para una muestra',
  wilcoxon_1samp: 'Wilcoxon para una muestra',
};

/**
 * Directional alternative implied by each hypothesis. HE1 expects the postest value to be LOWER
 * (less review time); the rest expect it to be HIGHER.
 */
export type Alternative = 'two-sided' | 'less' | 'greater';

export const HYPOTHESIS_ALTERNATIVE: Readonly<Record<HypothesisKey, Alternative>> = {
  HE1: 'less',
  HE2: 'greater',
  HE3: 'greater',
  HE4: 'greater',
};

export interface NormalityResult {
  test: 'shapiro-wilk';
  statistic: number;
  pValue: number;
  /** True when p > alpha: normality is NOT rejected and the parametric test applies. */
  normal: boolean;
  /** Shapiro-Wilk needs at least 3 observations; below that the test is skipped. */
  applicable: boolean;
  note?: string;
}

export interface EffectSize {
  kind: 'cohens_dz' | 'rank_biserial';
  value: number;
  magnitude: 'trivial' | 'small' | 'medium' | 'large';
}

/** One matched observation; `pairKey` is a case id (HE1/HE2) or a professional id (HE4). */
export interface PairedObservation {
  pairKey: string;
  label: string;
  pretest: number;
  postest: number;
  difference: number;
}

/** Version of the statistical procedure, persisted with every run for RNF-05. */
export const STATS_FUNCTION_VERSION = 'acne-stats/1.0.0';
