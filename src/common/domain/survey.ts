/**
 * Anexo 6 — Likert satisfaction questionnaire, 8 items, scale 1..5.
 *
 * Covers: OE3 (RF-OE3-01 .. RF-OE3-04). The item wording below is VERBATIM from the validated
 * thesis instrument and must never be paraphrased. The frontend renders these strings by reading
 * `GET /meta/catalogs`, so there is exactly one copy of the questionnaire in the whole system.
 */

export interface LikertItem {
  number: number;
  text: string;
}

export const LIKERT_ITEMS: readonly LikertItem[] = [
  { number: 1, text: 'El sistema con IA es fácil de usar para apoyar el diagnóstico de acné.' },
  {
    number: 2,
    text: 'El tiempo que dedico a revisar y validar cada caso se ha reducido con el sistema.',
  },
  { number: 3, text: 'El diagnóstico preliminar generado por la IA es confiable y útil.' },
  { number: 4, text: 'La preclasificación automática de imágenes facilita mi decisión clínica.' },
  { number: 5, text: 'El sistema me permite atender un mayor número de casos por jornada.' },
  { number: 6, text: 'La información que entrega el sistema mejora la precisión del diagnóstico.' },
  {
    number: 7,
    text: 'Recomendaría el uso del sistema con IA a otros profesionales del centro.',
  },
  { number: 8, text: 'En general, estoy satisfecho con el sistema de diagnóstico asistido por IA.' },
] as const;

export const LIKERT_MIN_SCORE = 1;
export const LIKERT_MAX_SCORE = 5;

export const LIKERT_SCALE_LABELS: Readonly<Record<number, string>> = {
  1: 'Muy bajo',
  2: 'Bajo',
  3: 'Normal',
  4: 'Alto',
  5: 'Muy alto',
};

/** PT — maximum attainable score for one respondent (8 items x 5 points = 40). */
export const LIKERT_TOTAL_POINTS = LIKERT_ITEMS.length * LIKERT_MAX_SCORE;

export const LIKERT_ITEM_NUMBERS: readonly number[] = LIKERT_ITEMS.map((i) => i.number);

export function isValidLikertScore(score: number): boolean {
  return Number.isInteger(score) && score >= LIKERT_MIN_SCORE && score <= LIKERT_MAX_SCORE;
}
