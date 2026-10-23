import type { SecondOpinion, SecondOpinionLabel } from './ai-engine.client';

/**
 * The advisory second opinion between the engine's answer, its four columns and the DTO.
 *
 * Conditions travel as one display string joined by «; » rather than a child table: they are the
 * external model's free text, shown to the specialist and never counted, grouped or reported. A
 * table would suggest they are data the thesis aggregates, and they are not.
 */

export interface SecondOpinionColumns {
  secondOpinionLabel: SecondOpinionLabel | null;
  secondOpinionConditions: string | null;
  secondOpinionExplanation: string | null;
  secondOpinionVersion: string | null;
}

const SEPARATOR = '; ';

export function toSecondOpinionColumns(
  opinion: SecondOpinion | null | undefined,
): SecondOpinionColumns {
  if (opinion === null || opinion === undefined) {
    return {
      secondOpinionLabel: null,
      secondOpinionConditions: null,
      secondOpinionExplanation: null,
      secondOpinionVersion: null,
    };
  }
  // A «;» inside a name would split it on the way back; the model never writes one, but a name
  // is not worth corrupting the next one over.
  const conditions = opinion.conditions
    .map((condition) => condition.replace(/;/g, ',').trim())
    .filter((condition) => condition !== '')
    .join(SEPARATOR)
    .slice(0, 300);
  return {
    secondOpinionLabel: opinion.label,
    secondOpinionConditions: conditions === '' ? null : conditions,
    secondOpinionExplanation: opinion.explanation.slice(0, 400),
    secondOpinionVersion: opinion.version.slice(0, 120),
  };
}

export function fromSecondOpinionColumns(row: Partial<SecondOpinionColumns>): SecondOpinion | null {
  if (row.secondOpinionLabel === null || row.secondOpinionLabel === undefined) return null;
  return {
    label: row.secondOpinionLabel,
    conditions: (row.secondOpinionConditions ?? '')
      .split(';')
      .map((condition) => condition.trim())
      .filter((condition) => condition !== ''),
    explanation: row.secondOpinionExplanation ?? '',
    version: row.secondOpinionVersion ?? '',
  };
}
