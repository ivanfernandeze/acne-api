/**
 * Domain layer — the single source of truth of the whole system.
 *
 * `acne-web` never redeclares any of this: the TypeScript types reach it through the generated
 * OpenAPI client, and the runtime constants (labels, Likert wording, indicator definitions) reach
 * it through `GET /meta/catalogs`. See TRACEABILITY.md.
 */
export * from './audit';
export * from './iga';
export * from './assessment';
export * from './study';
export * from './prescription';
export * from './roles';
export * from './anamnesis';
export * from './capture';
export * from './incongruence';
export * from './reading';
export * from './case-analysis';
export * from './indicators';
export * from './hypotheses';
export * from './survey';
export * from './disclaimer';
