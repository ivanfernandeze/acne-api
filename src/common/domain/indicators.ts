/**
 * The four dependent-variable indicators of the thesis, their formulas and their declared targets.
 *
 * Covers: OE1 (TRM), OE2 (TPD), OE3 (TSP), OE4 (TCAD) — section 1.3 of the specification.
 * Every formula below is the verbatim operational definition from the thesis instruments; the
 * alert thresholds are the goals declared in Anexos 4-7.
 */

export const INDICATORS = ['TRM', 'TPD', 'TSP', 'TCAD'] as const;
export type IndicatorKey = (typeof INDICATORS)[number];

export type ObjectiveKey = 'OG' | 'OE1' | 'OE2' | 'OE3' | 'OE4' | 'IIA';

export interface IndicatorDefinition {
  key: IndicatorKey;
  objective: Extract<ObjectiveKey, 'OE1' | 'OE2' | 'OE3' | 'OE4'>;
  hypothesis: 'HE1' | 'HE2' | 'HE3' | 'HE4';
  name: string;
  formula: string;
  unit: string;
  instrument: string;
  /** `lower` means a smaller value is better (TRM); `higher` means the opposite. */
  direction: 'lower' | 'higher';
  target: string;
}

export const INDICATOR_DEFINITIONS: Readonly<Record<IndicatorKey, IndicatorDefinition>> = {
  TRM: {
    key: 'TRM',
    objective: 'OE1',
    hypothesis: 'HE1',
    name: 'Tasa de revisión médica',
    formula: 'TRM = (Σ TRᵢ) / n',
    unit: 'min/caso',
    instrument: 'Anexo 4 — Ficha de registro de tiempo de revisión médica',
    direction: 'lower',
    target: 'Reducción ≥ 30 % respecto al pretest',
  },
  TPD: {
    key: 'TPD',
    objective: 'OE2',
    hypothesis: 'HE2',
    name: 'Tasa de precisión diagnóstica',
    formula: 'TPD = (DC / DT) × 100',
    unit: '%',
    instrument: 'Anexo 5 — Ficha de registro de precisión del diagnóstico',
    direction: 'higher',
    target: 'TPD ≥ 90 % en postest',
  },
  TSP: {
    key: 'TSP',
    objective: 'OE3',
    hypothesis: 'HE3',
    name: 'Tasa de satisfacción del personal',
    formula: 'TSP = (Σ PO / PT) × 100',
    unit: '%',
    instrument: 'Anexo 6 — Cuestionario Likert de 8 ítems',
    direction: 'higher',
    target: 'TSP ≥ 80 % (Likert promedio ≥ 4/5)',
  },
  TCAD: {
    key: 'TCAD',
    objective: 'OE4',
    hypothesis: 'HE4',
    name: 'Tasa de capacidad de atención',
    formula: 'TCAD = NCR / TJ',
    unit: 'casos/hora',
    instrument: 'Anexo 7 — Ficha de registro de capacidad de atención',
    direction: 'higher',
    target: 'Incremento significativo postest vs pretest',
  },
};

/** Declared numeric goals behind the alert cards (RF-OE1-05, RF-OE2-06, RF-OE3-04). */
export const INDICATOR_TARGETS = {
  /** Minimum relative reduction of TRM, postest vs pretest (RF-OE1-05). */
  TRM_MIN_REDUCTION_PCT: 30,
  /** Minimum diagnostic precision in postest (RF-OE2-06). */
  TPD_MIN_PCT: 90,
  /** Minimum staff satisfaction (RF-OE3-04). */
  TSP_MIN_PCT: 80,
  /** Minimum mean Likert score, out of 5 (RF-OE3-04). */
  LIKERT_MIN_MEAN: 4,
} as const;

/** Descriptive statistics accompanying every indicator value. */
export interface DescriptiveStats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/**
 * Evaluates the declared target of an indicator and returns the alert text when it is not met.
 * Returns `null` when the target holds or cannot yet be evaluated.
 *
 * Covers: RF-OE1-05, RF-OE2-06, RF-OE3-04.
 */
export function evaluateTarget(
  indicator: IndicatorKey,
  input: { pretest: number | null; postest: number | null; meanLikert?: number | null },
): { targetMet: boolean | null; alert: string | null } {
  const { pretest, postest } = input;

  switch (indicator) {
    case 'TRM': {
      if (pretest === null || postest === null || pretest === 0) {
        return { targetMet: null, alert: null };
      }
      const reductionPct = ((pretest - postest) / pretest) * 100;
      const met = reductionPct >= INDICATOR_TARGETS.TRM_MIN_REDUCTION_PCT;
      return {
        targetMet: met,
        alert: met
          ? null
          : `La reducción del tiempo de revisión es de ${reductionPct.toFixed(1)} %, por debajo de la ` +
            `meta declarada de ${INDICATOR_TARGETS.TRM_MIN_REDUCTION_PCT} % (RF-OE1-05).`,
      };
    }
    case 'TPD': {
      if (postest === null) return { targetMet: null, alert: null };
      const met = postest >= INDICATOR_TARGETS.TPD_MIN_PCT;
      return {
        targetMet: met,
        alert: met
          ? null
          : `La precisión diagnóstica en postest es de ${postest.toFixed(1)} %, por debajo de la meta ` +
            `declarada de ${INDICATOR_TARGETS.TPD_MIN_PCT} % (RF-OE2-06).`,
      };
    }
    case 'TSP': {
      if (postest === null) return { targetMet: null, alert: null };
      const meanLikert = input.meanLikert ?? null;
      const tspMet = postest >= INDICATOR_TARGETS.TSP_MIN_PCT;
      const likertMet = meanLikert === null || meanLikert >= INDICATOR_TARGETS.LIKERT_MIN_MEAN;
      const met = tspMet && likertMet;
      if (met) return { targetMet: true, alert: null };
      const reasons: string[] = [];
      if (!tspMet) {
        reasons.push(
          `TSP de ${postest.toFixed(1)} % (meta ≥ ${INDICATOR_TARGETS.TSP_MIN_PCT} %)`,
        );
      }
      if (!likertMet && meanLikert !== null) {
        reasons.push(
          `promedio Likert de ${meanLikert.toFixed(2)}/5 (meta ≥ ${INDICATOR_TARGETS.LIKERT_MIN_MEAN})`,
        );
      }
      return {
        targetMet: false,
        alert: `Satisfacción por debajo de la meta: ${reasons.join(' y ')} (RF-OE3-04).`,
      };
    }
    case 'TCAD': {
      if (pretest === null || postest === null) return { targetMet: null, alert: null };
      // OE4 declares no numeric threshold: the target is a significant increase, decided by the
      // hypothesis contrast (RF-OE4-03). Here we only flag a change in the wrong direction.
      const met = postest > pretest;
      return {
        targetMet: met,
        alert: met
          ? null
          : `La capacidad de atención en postest (${postest.toFixed(2)} casos/h) no supera la del ` +
            `pretest (${pretest.toFixed(2)} casos/h). La significancia la decide el contraste de HE₄.`,
      };
    }
  }
}
