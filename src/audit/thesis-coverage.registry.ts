import type { CoverageStatus, ObjectiveKey } from 'src/common/domain';

/**
 * Traceability matrix objective → indicator → modules.
 *
 * Covers: RNF-04 (`GET /audit/thesis-coverage`). This file is the machine-readable twin of
 * `acne-infra/TRACEABILITY.md`; the two MUST be kept in step, and every change to either is part
 * of the same commit.
 */

export type { CoverageStatus };

export interface CoverageEntry {
  objective: ObjectiveKey;
  description: string;
  indicator: string | null;
  formula: string | null;
  target: string | null;
  /** Baseline status assuming a trained model; downgraded at runtime when the engine is a stub. */
  status: CoverageStatus;
  modules: string[];
  requirements: string[];
  notes: string | null;
}

export const COVERAGE_REGISTRY: readonly CoverageEntry[] = [
  {
    objective: 'OG',
    description:
      'Determinar en qué medida la inteligencia artificial incide en la agilización del proceso ' +
      'de diagnóstico de acné en un centro especializado en dermatología.',
    indicator: 'Compuesto OE1–OE4',
    formula: 'Contraste estadístico agregado',
    target: 'Rechazo de H₀ al 95 % de confianza',
    status: 'cubierto',
    modules: ['api:stats', 'api:reports', 'api:audit', 'ai:stats', 'web:admin/estadistica'],
    requirements: ['RNF-04', 'RNF-05'],
    notes: 'Depende de OE2: si el modelo no está operativo, OG no puede darse por cubierto.',
  },
  {
    objective: 'OE1',
    description: 'Determinar en qué medida la IA reduce el tiempo de revisión médica del diagnóstico.',
    indicator: 'TRM — Tasa de revisión médica',
    formula: 'TRM = (Σ TRᵢ) / n [min/caso]',
    target: 'Reducción ≥ 30 % postest vs pretest',
    status: 'cubierto',
    modules: [
      'api:study/review-timing.service',
      'api:indicators/trm',
      'api:stats',
      'web:anexos/anexo-4',
    ],
    requirements: ['RF-OE1-01', 'RF-OE1-02', 'RF-OE1-03', 'RF-OE1-04', 'RF-OE1-05'],
    notes: 't₀ y t₁ los sella el servidor; el cliente no puede alterarlos.',
  },
  {
    objective: 'OE2',
    description: 'Determinar en qué medida la IA mejora la precisión del diagnóstico preliminar.',
    indicator: 'TPD — Tasa de precisión diagnóstica',
    formula: 'TPD = (DC / DT) × 100 [%]',
    target: 'TPD ≥ 90 % en postest',
    status: 'cubierto',
    modules: [
      'api:inference',
      'api:diagnoses',
      'api:indicators/classification',
      'ai:inference',
      'web:anexos/anexo-5',
    ],
    requirements: [
      'RF-OE2-01',
      'RF-OE2-02',
      'RF-OE2-03',
      'RF-OE2-04',
      'RF-OE2-05',
      'RF-OE2-06',
    ],
    notes:
      'cases.ground_truth_iga es el patrón común que hace comparables pretest y postest (RF-OE2-05).',
  },
  {
    objective: 'OE3',
    description: 'Determinar en qué medida la IA mejora la satisfacción del personal médico.',
    indicator: 'TSP — Tasa de satisfacción del personal',
    formula: 'TSP = (Σ PO / PT) × 100 [%]',
    target: 'TSP ≥ 80 % (Likert promedio ≥ 4/5)',
    status: 'cubierto',
    modules: ['api:surveys', 'api:indicators/tsp', 'api:stats', 'web:dermatologo/encuesta'],
    requirements: ['RF-OE3-01', 'RF-OE3-02', 'RF-OE3-03', 'RF-OE3-04', 'RF-OE3-05'],
    notes: 'Los 8 ítems se sirven verbatim desde common/domain/survey.ts.',
  },
  {
    objective: 'OE4',
    description: 'Determinar en qué medida la IA incrementa la capacidad de atención diagnóstica.',
    indicator: 'TCAD — Tasa de capacidad de atención',
    formula: 'TCAD = NCR / TJ [casos/hora]',
    target: 'Incremento significativo postest vs pretest',
    status: 'cubierto',
    modules: ['api:sessions', 'api:indicators/tcad', 'api:stats', 'web:anexos/anexo-7'],
    requirements: ['RF-OE4-01', 'RF-OE4-02', 'RF-OE4-03', 'RF-OE4-04'],
    notes: 'NCR lo cuenta el sistema; TJ lo declara el profesional, como manda el instrumento.',
  },
  {
    objective: 'IIA',
    description: 'Verificación de la variable independiente (implementación de IA).',
    indicator: 'Checklist de operatividad del modelo',
    formula: null,
    target: 'Modelo operativo con pesos entrenados',
    status: 'cubierto',
    modules: ['api:audit', 'ai:audit', 'api:study/study-mode.guard'],
    requirements: ['RF-TR-01', 'RF-TR-04'],
    notes:
      'El bloqueo en pretest se aplica en el servidor (403), no solo ocultando la UI.',
  },
];
