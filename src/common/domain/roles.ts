/**
 * Roles of the study. Covers: RF-TR-02.
 */

export const USER_ROLES = ['dermatologo', 'residente', 'admin', 'evaluador_estadistico'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  dermatologo: 'Dermatólogo',
  residente: 'Residente',
  admin: 'Administrador',
  evaluador_estadistico: 'Evaluador estadístico',
};

/** Roles allowed to emit a reference (gold standard) diagnosis and to be measured by the study. */
export const DIAGNOSING_ROLES: readonly UserRole[] = ['dermatologo', 'residente'];

/** Only `admin` may export the raw study datasets (RF-TR-02). */
export const RAW_EXPORT_ROLES: readonly UserRole[] = ['admin'];

/** Roles that may read indicators and run hypothesis contrasts. */
export const ANALYSIS_ROLES: readonly UserRole[] = [
  'admin',
  'evaluador_estadistico',
  'dermatologo',
];

/** Subject of an informed consent record (RNF-07). */
export const CONSENT_SUBJECTS = ['paciente', 'personal_medico'] as const;
export type ConsentSubject = (typeof CONSENT_SUBJECTS)[number];

export const CONSENT_CURRENT_VERSION = '1.0';
