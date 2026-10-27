/**
 * Primitivas del diseño experimental preprueba-postprueba de un solo grupo (G: O₁ → X → O₂).
 *
 * Cubre: RF-TR-01 (el modo de estudio ES la variable independiente) y el vocabulario compartido del
 * que dependen los cuatro indicadores. Referencia: Hernández (2023), sección 2 de requisitos.md.
 *
 * Los valores almacenados están en español, igual que los nombres de las tablas: la base de datos
 * es un entregable de la tesis y se lee sin traducir. Se exceptúan los identificadores técnicos que
 * cruzan una frontera ajena —los nombres de las pruebas de SciPy, los drivers de almacenamiento—,
 * donde traducir rompería la interoperabilidad sin ganar legibilidad.
 */

/**
 * De dónde viene una medición, que es lo que operacionaliza la variable independiente (IIA).
 *
 *  - `pretest`  IIA = 0 — la evaluación MANUAL de la clínica, hecha sin el sistema. No ocurre aquí
 *               dentro: sucede en la consulta, se anota en papel y el administrador la transcribe.
 *  - `postest`  IIA = 1 — la medición que produce ESTE sistema, con la sugerencia del modelo a la
 *               vista del especialista.
 *
 * REDEFINICIÓN (2026-09-08). Antes el modo era un interruptor por USUARIO: el mismo dermatólogo
 * revisaba los treinta casos «en pretest» —con la IA bloqueada por el servidor— y luego los volvía
 * a revisar «en postest». Ese montaje medía el sistema contra sí mismo con una mano atada, y le
 * pedía al especialista revisar dos veces lo mismo fingiendo la primera vez que no sabía nada.
 *
 * El pretest real es **cómo trabaja hoy la clínica**: sin software. Así que el modo dejó de ser un
 * estado de la persona y pasó a ser una propiedad de la FILA: toda medición registrada por el
 * sistema es postest por construcción, y las de pretest entran transcritas desde el registro
 * manual. Es también lo que el diseño G: O₁ → X → O₂ dice literalmente — X es la introducción del
 * sistema, no un permiso que se enciende y se apaga.
 *
 * Desapareció `produccion`. Existía para el personal que no participaba del experimento; ahora no
 * hay nadie fuera: si la medición está en el sistema, es postest.
 */
export const STUDY_MODES = ['pretest', 'postest'] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

export const STUDY_MODE_LABELS: Readonly<Record<StudyMode, string>> = {
  pretest: 'Pretest — evaluación manual',
  postest: 'Postest — con el sistema',
};

export const STUDY_MODE_ORDER: Readonly<Record<StudyMode, number>> = {
  pretest: 1,
  postest: 2,
};

/**
 * El modo que lleva toda medición nacida dentro del sistema.
 *
 * Se usa en vez de escribir `'postest'` suelto en cada servicio: si el vocabulario cambiara otra
 * vez, hay un solo sitio que tocar, y el nombre dice POR QUÉ vale eso y no otra cosa.
 */
export const SYSTEM_MEASUREMENT_MODE: StudyMode = 'postest';

/**
 * Los dos modos que producen mediciones pareadas para el contraste estadístico.
 *
 * Coincide con `STUDY_MODES` desde que desapareció `produccion`. Se conserva como alias con nombre
 * propio porque los contrastes hablan de «modos experimentales» y perder esa palabra haría más
 * difícil, no más fácil, leer `stats.service.ts`.
 */
export const EXPERIMENTAL_MODES = STUDY_MODES;
export type ExperimentalMode = StudyMode;

export function isExperimentalMode(mode: StudyMode): mode is ExperimentalMode {
  return mode === 'pretest' || mode === 'postest';
}

/** Valor de la variable independiente que implica un modo de estudio. */
export function iiaValue(mode: StudyMode): 0 | 1 {
  return mode === 'postest' ? 1 : 0;
}

/**
 * Si el módulo de IA puede invocarse siquiera bajo este modo. Este único predicado es lo que
 * `StudyModeGuard` hace cumplir; tenerlo aquí significa que la regla tiene exactamente una
 * definición. La tabla `modos_estudio` guarda la misma bandera en `permite_ia`.
 */
export function aiAllowedIn(mode: StudyMode): boolean {
  return mode !== 'pretest';
}

/** Turno de trabajo, registrado por jornada para el TCAD (Anexo 7). */
export const WORK_SHIFTS = ['manana', 'tarde', 'noche'] as const;
export type WorkShift = (typeof WORK_SHIFTS)[number];

export const WORK_SHIFT_LABELS: Readonly<Record<WorkShift, string>> = {
  manana: 'Mañana',
  tarde: 'Tarde',
  noche: 'Noche',
};

export const WORK_SHIFT_ORDER: Readonly<Record<WorkShift, number>> = {
  manana: 1,
  tarde: 2,
  noche: 3,
};

/**
 * Ciclo de vida de un caso clínico, según la sección 9.2 de requisitos.md.
 *
 * Los códigos pasaron de inglés (`draft`, `in_review`…) a español en la reestructuración del
 * 05/09/2026: son valores de dominio clínico que se leen en la base y en los anexos, no
 * identificadores técnicos.
 */
export const CASE_STATUSES = [
  'borrador',
  'en_revision',
  'procesado_ia',
  'solicitar_fotos',
  'derivar_presencial',
  'diagnosticado',
  'cerrado',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  procesado_ia: 'Procesado por IA',
  solicitar_fotos: 'Fotos pendientes',
  derivar_presencial: 'Derivado a presencial',
  diagnosticado: 'Diagnosticado',
  cerrado: 'Cerrado',
};

export const CASE_STATUS_ORDER: Readonly<Record<CaseStatus, number>> = {
  borrador: 1,
  en_revision: 2,
  procesado_ia: 3,
  solicitar_fotos: 4,
  derivar_presencial: 5,
  diagnosticado: 6,
  cerrado: 7,
};

/** Estados terminales: de aquí no sale ninguna transición. */
/**
 * Estados terminales: de aquí no sale ninguna transición.
 *
 * `derivar_presencial` es terminal y NO es un éxito: el caso abandona el circuito digital porque la
 * teleconsulta no alcanzó. Consumió tiempo del profesional pero no produjo un diagnóstico
 * comparable, de modo que no cuenta como caso revisado para TCAD (OE4).
 */
export const FINAL_CASE_STATUSES: readonly CaseStatus[] = ['cerrado', 'derivar_presencial'];

/**
 * Las etapas que ve el personal: tres, no siete.
 *
 * Decisión del equipo (25/10/2026): en la bandeja y en la ficha un caso está en **Borrador** (el
 * ingreso no terminó), **En revisión** (esperando al especialista) o **Revisado** (el especialista
 * firmó el diagnóstico). Los estados internos se conservan —las transiciones, los anexos y la
 * auditoría los necesitan, y «Solicitar fotos» o «Derivar a presencial» siguen siendo acciones con
 * su propio aviso en la ficha—, pero se muestran agrupados:
 *
 *  - «Fotos pendientes» es un caso que vuelve al mostrador y todavía espera revisión → En revisión.
 *  - «Procesado por IA» es un caso analizado y sin firmar → En revisión.
 *  - «Derivado a presencial» y «Cerrado» son casos que el especialista ya resolvió → Revisado.
 */
export const CASE_STAGES = ['borrador', 'en_revision', 'revisado'] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const CASE_STAGE_LABELS: Readonly<Record<CaseStage, string>> = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  revisado: 'Revisado',
};

export const CASE_STAGE_OF: Readonly<Record<CaseStatus, CaseStage>> = {
  borrador: 'borrador',
  en_revision: 'en_revision',
  procesado_ia: 'en_revision',
  solicitar_fotos: 'en_revision',
  diagnosticado: 'revisado',
  derivar_presencial: 'revisado',
  cerrado: 'revisado',
};

export function isCaseStage(value: unknown): value is CaseStage {
  return typeof value === 'string' && (CASE_STAGES as readonly string[]).includes(value);
}

/** The internal statuses a stage groups, for filtering the tray by what people see. */
export function statusesOfStage(stage: CaseStage): CaseStatus[] {
  return CASE_STATUSES.filter((status) => CASE_STAGE_OF[status] === stage);
}

/** Estados desde los que el caso sigue esperando trabajo del mostrador, no del especialista. */
export const INTAKE_PENDING_STATUSES: readonly CaseStatus[] = ['borrador', 'solicitar_fotos'];

/**
 * Transiciones permitidas. Se hacen cumplir en el servidor para que las mediciones de tiempo (OE1)
 * no puedan corromperse con actualizaciones fuera de orden. La tabla `transiciones_estado_caso`
 * guarda este mismo grafo, una fila por arista.
 */
export const CASE_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  borrador: ['en_revision'],
  en_revision: ['procesado_ia', 'diagnosticado', 'solicitar_fotos', 'derivar_presencial'],
  procesado_ia: ['diagnosticado', 'solicitar_fotos', 'derivar_presencial'],
  // Vuelve al mostrador y regresa por la misma puerta por la que salió.
  solicitar_fotos: ['en_revision'],
  diagnosticado: ['cerrado', 'derivar_presencial'],
  derivar_presencial: [],
  cerrado: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && (CASE_STATUSES as readonly string[]).includes(value);
}

/**
 * Estado de un proceso asíncrono: lo comparten el trabajo encolado y la inferencia que produce.
 *
 * Eran dos listas idénticas (`JOB_STATUSES` y el union literal de `AiInference.status`) que había
 * que mantener sincronizadas a mano. Ahora es un solo catálogo y una sola tabla, `estados_proceso`.
 */
export const PROCESS_STATUSES = ['pendiente', 'ejecutando', 'exitoso', 'fallido'] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const PROCESS_STATUS_LABELS: Readonly<Record<ProcessStatus, string>> = {
  pendiente: 'Pendiente',
  ejecutando: 'Ejecutando',
  exitoso: 'Exitoso',
  fallido: 'Fallido',
};

export const PROCESS_STATUS_ORDER: Readonly<Record<ProcessStatus, number>> = {
  pendiente: 1,
  ejecutando: 2,
  exitoso: 3,
  fallido: 4,
};

/**
 * Alias histórico. La cola y la inferencia comparten catálogo desde la reestructuración; se
 * conserva el nombre para no reescribir la firma del `QueueProvider`.
 */
export type JobStatus = ProcessStatus;
export const JOB_STATUSES = PROCESS_STATUSES;

/** Acuerdo de un diagnóstico contra el patrón de referencia (Anexo 5). */
export const AGREEMENT_VALUES = ['correcto', 'incorrecto'] as const;
export type Agreement = (typeof AGREEMENT_VALUES)[number];
