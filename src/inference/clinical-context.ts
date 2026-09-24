import type { AnamnesisAnswer } from 'src/common/domain';

import type { ClinicalContextPayload } from './ai-engine.client';

/**
 * Turns a stored anamnesis into the context that travels with the photograph.
 *
 * WHAT IS DELIBERATELY LEFT OUT: everything that identifies the patient. RF-TR-03 reserves the name
 * and the document for the treating dermatologist, and neither is needed to read a photograph — so
 * neither leaves the database, least of all towards a backend that may forward it to a third party.
 * Age is sent instead of the birth date for the same reason: acne is graded differently at 14 and
 * at 34, and a year of birth narrows a person down far more than an age does.
 *
 * The wording is the catalogue's, verbatim. Paraphrasing the questions here would put a second,
 * unversioned interpretation between the clinical record and the model — and the answers are filed
 * under keys whose meaning only the catalogue knows.
 *
 * WHICH catalogue: the one in `preguntas_anamnesis`, passed in by the caller. It used to be the
 * `ANAMNESIS_QUESTIONS` constant, which stopped being the source of truth when the questionnaire
 * became administrable — a question created from the portal was answered, stored, and then dropped
 * here on its way to the model, silently, because its key was not in the constant.
 */

/**
 * One question, as much of it as this file needs.
 *
 * `number` is what orders the questionnaire; `text` is what the model reads. Nothing else about a
 * question changes what travels with the photograph.
 */
export interface CatalogueQuestion {
  key: string;
  number: number;
  text: string;
}

export interface PatientContextRow {
  sex: string | null;
  birthDate: string | null;
  phototype: string | null;
}

/** Age in completed years, or `null` when the birth date is unknown or in the future. */
export function ageFromBirthDate(birthDate: string | null, today = new Date()): number | null {
  if (birthDate === null || birthDate === '') return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;

  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < born.getUTCDate())) age--;

  return age < 0 || age > 120 ? null : age;
}

/** Renders one answer as the text a clinician would read. */
export function formatAnswer(answer: AnamnesisAnswer): string {
  const { value, detail } = answer;

  let rendered: string;
  if (value === null || value === undefined || value === '') rendered = '';
  else if (typeof value === 'boolean') rendered = value ? 'Sí' : 'No';
  else if (Array.isArray(value)) rendered = value.join(', ');
  else rendered = String(value);

  const note = typeof detail === 'string' ? detail.trim() : '';
  if (note === '') return rendered;
  // A "Sí" with no follow-up is half an answer: which chronic disease, which drug, which allergy.
  return rendered === '' ? note : `${rendered} (${note})`;
}

/**
 * Builds the payload, or `null` when there is nothing clinically useful to send.
 *
 * An unanswered question is omitted rather than sent as "sin responder": a list of blanks invites
 * the model to reason about absences that are merely an unfinished intake.
 */
export function buildClinicalContext(
  patient: PatientContextRow | null,
  answers: Record<string, AnamnesisAnswer> | null,
  catalogue: readonly CatalogueQuestion[],
): ClinicalContextPayload | null {
  const items: Array<{ question: string; answer: string }> = [];

  if (answers !== null) {
    // Catalogue order, not object-key order: the questionnaire is written to be read top to bottom,
    // and JSON key order is whatever the last write happened to produce.
    const ordered = [...catalogue].sort((a, b) => a.number - b.number);
    for (const question of ordered) {
      const answer = answers[question.key];
      if (answer === undefined) continue;
      const rendered = formatAnswer(answer);
      if (rendered === '') continue;
      items.push({
        question: question.text,
        answer: rendered.slice(0, 600),
      });
    }
  }

  const age = ageFromBirthDate(patient?.birthDate ?? null);
  const sex = patient?.sex ?? null;
  const phototype = patient?.phototype ?? null;

  if (items.length === 0 && age === null && sex === null && phototype === null) return null;

  return { age, sex, phototype, answers: items };
}
