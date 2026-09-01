/**
 * IGA (Investigator's Global Assessment) severity scale for acne vulgaris, plus the secondary
 * GAGS (Global Acne Grading System) scale.
 *
 * Covers: OE2 (RF-OE2-01, RF-OE2-04) — the label space every diagnosis and every model prediction
 * is expressed in. References: Traini (2025), Vasam (2023), Watanabe (2025).
 */

/** The five IGA classes required by section 3 of the thesis specification. */
export const IGA_CLASSES = [
  'sin_lesiones',
  'casi_sin_lesiones',
  'leve',
  'moderado',
  'severo',
] as const;

export type IgaClass = (typeof IGA_CLASSES)[number];

/**
 * Ordinal rank of each IGA class (0 = no lesions .. 4 = severe). IGA is an ordinal scale, so the
 * distance between classes is meaningful when analysing the model's errors.
 */
export const IGA_ORDINAL: Readonly<Record<IgaClass, number>> = {
  sin_lesiones: 0,
  casi_sin_lesiones: 1,
  leve: 2,
  moderado: 3,
  severo: 4,
};

/** Spanish (Peru) labels shown in the clinical UI and in the PDF reports. */
export const IGA_LABELS: Readonly<Record<IgaClass, string>> = {
  sin_lesiones: 'Sin lesiones',
  casi_sin_lesiones: 'Casi sin lesiones',
  leve: 'Leve',
  moderado: 'Moderado',
  severo: 'Severo',
};

export function isIgaClass(value: unknown): value is IgaClass {
  return typeof value === 'string' && (IGA_CLASSES as readonly string[]).includes(value);
}

/** Ordinal distance between two IGA classes; 0 means exact agreement. */
export function igaDistance(a: IgaClass, b: IgaClass): number {
  return Math.abs(IGA_ORDINAL[a] - IGA_ORDINAL[b]);
}

/** Secondary GAGS grading, exposed alongside IGA per section 3 of the specification. */
export const GAGS_GRADES = ['none', 'mild', 'moderate', 'severe', 'very_severe'] as const;
export type GagsGrade = (typeof GAGS_GRADES)[number];

export const GAGS_LABELS: Readonly<Record<GagsGrade, string>> = {
  none: 'Sin acné',
  mild: 'Leve',
  moderate: 'Moderado',
  severe: 'Severo',
  very_severe: 'Muy severo',
};

/** GAGS score range, per the standard instrument. */
export const GAGS_MIN_SCORE = 0;
export const GAGS_MAX_SCORE = 44;

/**
 * Maps a GAGS numeric score (0-44) to its grade band, using the standard cut-offs reported in the
 * literature (Vasam, 2023).
 */
export function gagsGradeFromScore(score: number): GagsGrade {
  if (score <= 0) return 'none';
  if (score <= 18) return 'mild';
  if (score <= 30) return 'moderate';
  if (score <= 38) return 'severe';
  return 'very_severe';
}

/** Fitzpatrick phototype, recorded for the fairness audit described in section 8.2. */
export const FITZPATRICK_TYPES = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const;
export type FitzpatrickType = (typeof FITZPATRICK_TYPES)[number];

export const SEXES = ['femenino', 'masculino', 'otro'] as const;
export type Sex = (typeof SEXES)[number];
