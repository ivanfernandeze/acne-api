/**
 * Quitar un caso: borrarlo o anularlo.
 *
 * Desde el 25/10/2026 cualquier rol puede quitar un caso que se abrió por error (un paciente
 * equivocado, un ingreso duplicado, una ficha que quedó a medias). Lo que decide CÓMO se quita es si
 * el caso ya produjo evidencia del estudio:
 *
 *  - **Sin evidencia → se borra.** Un borrador con anamnesis y fotos no mide nada todavía; sus fotos
 *    son datos personales que ya no hacen falta y conservarlas «por si acaso» es lo que la Ley
 *    N.º 29733 pide no hacer.
 *  - **Con evidencia → se anula.** Un diagnóstico, un cronometraje de revisión, una inferencia o una
 *    receta son mediciones de TPD, TRM, TCAD o el registro clínico; borrarlas cambiaría los
 *    indicadores sin dejar rastro. El caso anulado sale de la bandeja, de los indicadores, de los
 *    contrastes y de las exportaciones, y la fila queda con quién, cuándo y por qué.
 *
 * El motivo es obligatorio en los dos casos: la traza de auditoría lo guarda.
 */

export type CaseRemovalMode = 'eliminar' | 'anular';

/** What the case already produced. Any of it makes the removal an annulment. */
export interface CaseEvidence {
  diagnoses: number;
  reviewTimings: number;
  inferences: number;
  prescriptions: number;
}

export const CASE_VOID_REASON_MIN_LENGTH = 10;

export function removalMode(evidence: CaseEvidence): CaseRemovalMode {
  const total =
    evidence.diagnoses + evidence.reviewTimings + evidence.inferences + evidence.prescriptions;
  return total > 0 ? 'anular' : 'eliminar';
}

/** The evidence in words, for the confirmation the person reads before acting. */
export function describeEvidence(evidence: CaseEvidence): string[] {
  const parts: string[] = [];
  if (evidence.diagnoses > 0) parts.push(plural(evidence.diagnoses, 'diagnóstico', 'diagnósticos'));
  if (evidence.reviewTimings > 0) {
    parts.push(plural(evidence.reviewTimings, 'revisión medida', 'revisiones medidas'));
  }
  if (evidence.inferences > 0) {
    parts.push(plural(evidence.inferences, 'análisis de IA', 'análisis de IA'));
  }
  if (evidence.prescriptions > 0) parts.push(plural(evidence.prescriptions, 'receta', 'recetas'));
  return parts;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
