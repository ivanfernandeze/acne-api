/**
 * Experimental design primitives for the single-group pretest-postest design (G: O1 -> X -> O2).
 *
 * Covers: RF-TR-01 (study mode = the independent variable) and the shared vocabulary every
 * indicator depends on. Reference: Hernandez (2023), section 2 of the specification.
 */

/**
 * The independent variable (IIA) is operationalised as this mode:
 *  - `pretest`    IIA = 0 — the AI module is hidden AND not invocable (server-enforced 403).
 *  - `postest`    IIA = 1 — the CNN suggestion is shown before the physician commits a diagnosis.
 *  - `produccion` outside the experiment; contributes no measurement to the study datasets.
 */
export const STUDY_MODES = ['pretest', 'postest', 'produccion'] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

export const STUDY_MODE_LABELS: Readonly<Record<StudyMode, string>> = {
  pretest: 'Pretest (sin IA)',
  postest: 'Postest (con IA)',
  produccion: 'Producción',
};

/** The two modes that produce paired measurements for the statistical contrast. */
export const EXPERIMENTAL_MODES = ['pretest', 'postest'] as const;
export type ExperimentalMode = (typeof EXPERIMENTAL_MODES)[number];

export function isExperimentalMode(mode: StudyMode): mode is ExperimentalMode {
  return mode === 'pretest' || mode === 'postest';
}

/** Value of the independent variable implied by a study mode. */
export function iiaValue(mode: StudyMode): 0 | 1 {
  return mode === 'postest' ? 1 : 0;
}

/**
 * Whether the AI module may be invoked at all under this mode. This single predicate is what
 * `StudyModeGuard` enforces; keeping it here means the rule has exactly one definition.
 */
export function aiAllowedIn(mode: StudyMode): boolean {
  return mode !== 'pretest';
}

/** Work shift, recorded per session for TCAD (Anexo 7). */
export const WORK_SHIFTS = ['manana', 'tarde', 'noche'] as const;
export type WorkShift = (typeof WORK_SHIFTS)[number];

export const WORK_SHIFT_LABELS: Readonly<Record<WorkShift, string>> = {
  manana: 'Mañana',
  tarde: 'Tarde',
  noche: 'Noche',
};

/** Lifecycle of a clinical case, per section 9.2 of the specification. */
export const CASE_STATUSES = ['draft', 'in_review', 'ai_processed', 'diagnosed', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  ai_processed: 'Procesado por IA',
  diagnosed: 'Diagnosticado',
  closed: 'Cerrado',
};

/**
 * Allowed state transitions. Enforced server-side so that timing measurements (OE1) cannot be
 * corrupted by out-of-order updates.
 */
export const CASE_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  draft: ['in_review'],
  in_review: ['ai_processed', 'diagnosed'],
  ai_processed: ['diagnosed'],
  diagnosed: ['closed'],
  closed: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

/** Status of a queued inference job (the `postgres` QueueProvider). */
export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
