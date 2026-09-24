/**
 * Los tres roles del estudio y lo que cada uno puede hacer.
 *
 * Cubre: RF-TR-02.
 *
 * REESTRUCTURACIÓN (2026-09-05). El sistema tenía cinco roles y ahora tiene tres. `residente` y
 * `evaluador_estadistico` desaparecen porque describían turnos de una misma persona, no puestos
 * distintos: el residente hacía exactamente lo que hace el dermatólogo y el evaluador estadístico
 * leía lo que ya lee el administrador. Cinco roles para tres puestos reales significaba cinco
 * ramas que mantener en cada guard y cinco columnas que explicar en la defensa.
 *
 *  - `residente`             → `dermatologo`  (diagnostica, ve identidad, ve la sugerencia del modelo)
 *  - `evaluador_estadistico` → `admin`        (lee indicadores, corre contrastes, exporta datasets)
 *
 * El modelo de permisos ya no son listas sueltas de roles regadas por el código, sino un permiso
 * atómico por capacidad y una matriz rol → permisos. La base de datos guarda esa misma matriz en
 * `roles` / `permisos` / `roles_permisos`, de modo que lo que el código autoriza y lo que la base
 * declara son la misma tabla y no dos copias que se separan con el tiempo.
 */

export const USER_ROLES = ['admin', 'dermatologo', 'tecnico'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  admin: 'Administrador',
  dermatologo: 'Dermatólogo',
  tecnico: 'Técnico/a',
};

export const USER_ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  admin:
    'Mantiene el sistema y lee la evidencia del estudio: usuarios, indicadores, contrastes de ' +
    'hipótesis, auditoría y exportación de datasets. No diagnostica.',
  dermatologo:
    'Emite el diagnóstico de referencia, ve la identidad del paciente y —solo en postest— la ' +
    'sugerencia del modelo. Es el sujeto que el estudio mide.',
  tecnico:
    'Recibe al paciente: lo registra, abre el caso, toma la anamnesis y entrega el QR de las ' +
    'fotografías. Nunca diagnostica ni ve la sugerencia del modelo.',
};

/** Orden de presentación en los desplegables del portal. */
export const USER_ROLE_ORDER: Readonly<Record<UserRole, number>> = {
  admin: 1,
  dermatologo: 2,
  tecnico: 3,
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Capacidades atómicas del sistema.
 *
 * Un permiso responde una pregunta concreta —«¿puede firmar un diagnóstico?»— y nunca nombra a un
 * rol. Esa es toda la diferencia con el diseño anterior: antes cada regla se escribía como una
 * lista de roles (`['dermatologo','residente']`), de modo que agregar un rol obligaba a revisar
 * ocho listas y olvidar una ampliaba silenciosamente un permiso.
 */
export const PERMISSIONS = [
  'diagnosticar',
  'ver_identidad_paciente',
  'ver_sugerencia_ia',
  'registrar_ingreso',
  'gestionar_pacientes',
  'registrar_jornada',
  'responder_encuesta',
  'leer_analisis',
  'ejecutar_contrastes',
  'exportar_datos_crudos',
  'gestionar_usuarios',
  'leer_auditoria',
  'prescribir',
  'enviar_receta',
  'gestionar_medicamentos',
  'gestionar_preguntas',
  'firmar_recetas',
  'gestionar_tecnicos',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Readonly<Record<Permission, string>> = {
  diagnosticar: 'Firmar el diagnóstico IGA de un caso (Anexo 5).',
  ver_identidad_paciente: 'Descifrar y ver el nombre y documento del paciente (RF-TR-03).',
  ver_sugerencia_ia: 'Ver la clase, la confianza y la lectura razonada del modelo (RF-TR-01).',
  registrar_ingreso: 'Abrir el caso, tomar la anamnesis y emitir el QR de captura.',
  gestionar_pacientes: 'Registrar y editar la ficha del paciente.',
  registrar_jornada: 'Abrir y cerrar la jornada de trabajo (Anexo 7).',
  responder_encuesta: 'Responder el cuestionario Likert de satisfacción (Anexo 6).',
  leer_analisis: 'Leer los indicadores TRM, TPD, TSP y TCAD.',
  ejecutar_contrastes: 'Ejecutar los contrastes de hipótesis HE₁–HE₄.',
  exportar_datos_crudos: 'Descargar los datasets crudos del estudio (RF-TR-02).',
  gestionar_usuarios: 'Crear, editar y desactivar cuentas del personal.',
  leer_auditoria: 'Leer la traza de auditoría y el checklist de cobertura (RNF-02, RNF-04).',
  prescribir: 'Emitir la receta que cierra la consulta y firmarla.',
  enviar_receta: 'Hacer llegar la receta al paciente por WhatsApp, correo o descarga.',
  gestionar_medicamentos: 'Mantener el vademécum y las indicaciones sugeridas por fármaco.',
  gestionar_preguntas: 'Editar la redacción del cuestionario de ingreso.',
  firmar_recetas: 'Registrar la firma que se estampa en las recetas.',
  gestionar_tecnicos: 'Dar de alta y mantener las cuentas del mostrador.',
};

/**
 * La matriz rol → permisos. Es la ÚNICA declaración de autorización del sistema.
 *
 * `tecnico` no aparece en nada del estudio: la evidencia de la tesis —indicadores, contrastes,
 * anexos, encuesta— la producen y la leen el dermatólogo y el administrador. El técnico opera el
 * mostrador y sale del análisis, que es justamente por qué existe como rol separado.
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  admin: [
    'gestionar_pacientes',
    'registrar_ingreso',
    // El administrador ya ESCRIBE la identidad al dar de alta a un paciente, de modo que negarle
    // leerla no protegía nada: lo único que conseguía era que su bandeja mostrara `PAC-2026-S011`
    // donde las otras dos muestran un nombre, y que la búsqueda por nombre no encontrara a nadie.
    // Lo que sigue cerrado es `GET /patients/:id/identity`, la única ruta que devuelve el
    // DOCUMENTO, reservada a quien diagnostica; y las exportaciones, los anexos y los reportes
    // siguen usando siempre el código y nunca el nombre (RF-TR-03). Cada lectura queda auditada.
    'ver_identidad_paciente',
    'leer_analisis',
    'ejecutar_contrastes',
    'exportar_datos_crudos',
    'gestionar_usuarios',
    'leer_auditoria',
    'gestionar_medicamentos',
    'gestionar_preguntas',
    // Redundante frente a `gestionar_usuarios`, y aun así explícito: es lo que hace que el
    // administrador aparezca en `TECHNICIAN_ADMIN_ROLES` sin que ese grupo tenga que nombrarlo a
    // mano. Un grupo derivado que necesitara excepciones dejaría de ser derivado.
    'gestionar_tecnicos',
  ],
  dermatologo: [
    'diagnosticar',
    'prescribir',
    'enviar_receta',
    'gestionar_medicamentos',
    'gestionar_preguntas',
    'firmar_recetas',
    'ver_identidad_paciente',
    'ver_sugerencia_ia',
    'registrar_ingreso',
    'gestionar_pacientes',
    'registrar_jornada',
    'responder_encuesta',
    /**
     * El especialista da de alta a su propio mostrador.
     *
     * En una clínica pequeña quien decide que hace falta otra persona en admisión es el médico, no
     * el informático: obligarle a pedir la cuenta al administrador para empezar a atender es un
     * trámite que en la práctica se salta compartiendo credenciales, y una credencial compartida
     * rompe la trazabilidad de la que vive RNF-02 —el asiento diría quién tecleó, no quién estaba.
     *
     * El alcance está acotado en el servidor, no en la pantalla: quien tiene este permiso y no
     * `gestionar_usuarios` solo ve y crea cuentas de `tecnico`. No puede fabricarse un
     * administrador ni tocar a otro médico.
     */
    'gestionar_tecnicos',
  ],
  /**
   * El mostrador ve la sugerencia del modelo (decisión del 07/09/2026).
   *
   * Replica el flujo de DermAsist, donde la IA corre al crear el caso y quien lo registra ve el
   * resultado en la misma pantalla. Es una AMENAZA A LA VALIDEZ INTERNA declarada, no un descuido:
   * la medición pretest solo se contamina si el técnico le comenta la sugerencia al especialista, y
   * el protocolo lo prohíbe. Lo que el sistema sí garantiza es que el DERMATÓLOGO en pretest no la
   * ve por ninguna vía —ese gate sigue intacto en `cases.service.ts`— y que cada lectura queda en
   * la traza. Declarado en `acne-infra/TRACEABILITY.md`.
   */
  tecnico: [
    'registrar_ingreso',
    'gestionar_pacientes',
    'ver_identidad_paciente',
    'ver_sugerencia_ia',
    'enviar_receta',
    'registrar_jornada',
    // El técnico OPERA el sistema tanto como el especialista —registra, fotografía, entrega la
    // receta— de modo que su satisfacción es parte de lo que OE3 mide. Excluirlo habría dejado
    // fuera a la mitad de quienes lo usan.
    'responder_encuesta',
  ],
};

/** ¿El rol tiene este permiso? */
export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Los roles que tienen un permiso dado. Lo consumen los `@Roles(...)` de los controladores. */
export function rolesWith(permission: Permission): UserRole[] {
  return USER_ROLES.filter((role) => can(role, permission));
}

/**
 * Grupos derivados, para que un controlador escriba `ROLES_QUE_DIAGNOSTICAN` en vez de repetir la
 * lista. Se construyen POR REFERENCIA desde la matriz: un grupo que discrepara de ella sería peor
 * que no tener grupo.
 */
export const DIAGNOSING_ROLES: readonly UserRole[] = rolesWith('diagnosticar');
export const IDENTITY_ROLES: readonly UserRole[] = rolesWith('ver_identidad_paciente');
export const AI_VIEWER_ROLES: readonly UserRole[] = rolesWith('ver_sugerencia_ia');
export const INTAKE_ROLES: readonly UserRole[] = rolesWith('registrar_ingreso');
export const ANALYSIS_ROLES: readonly UserRole[] = rolesWith('leer_analisis');
export const CONTRAST_ROLES: readonly UserRole[] = rolesWith('ejecutar_contrastes');
export const RAW_EXPORT_ROLES: readonly UserRole[] = rolesWith('exportar_datos_crudos');
export const USER_ADMIN_ROLES: readonly UserRole[] = rolesWith('gestionar_usuarios');
export const AUDIT_ROLES: readonly UserRole[] = rolesWith('leer_auditoria');
export const SURVEY_ROLES: readonly UserRole[] = rolesWith('responder_encuesta');
export const JOURNEY_ROLES: readonly UserRole[] = rolesWith('registrar_jornada');
export const PRESCRIBING_ROLES: readonly UserRole[] = rolesWith('prescribir');
export const DELIVERY_ROLES: readonly UserRole[] = rolesWith('enviar_receta');
export const DRUG_ADMIN_ROLES: readonly UserRole[] = rolesWith('gestionar_medicamentos');
export const QUESTION_ADMIN_ROLES: readonly UserRole[] = rolesWith('gestionar_preguntas');
export const SIGNATURE_ROLES: readonly UserRole[] = rolesWith('firmar_recetas');
export const TECHNICIAN_ADMIN_ROLES: readonly UserRole[] = rolesWith('gestionar_tecnicos');

/**
 * Los roles que participan del estudio en cualquier forma: producen o leen evidencia.
 *
 * Equivale a «todos menos el mostrador». Se deriva de la matriz y no se lista a mano.
 */
export const STUDY_ROLES: readonly UserRole[] = USER_ROLES.filter(
  (role) => can(role, 'leer_analisis') || can(role, 'diagnosticar'),
);

/** Todo el que trabaja sobre casos, mostrador incluido. */
export const CASE_ACCESS_ROLES: readonly UserRole[] = [...USER_ROLES];

/**
 * La matriz completa, servida al portal por `GET /meta/catalogs`.
 *
 * El frontend necesita responder preguntas que la lista plana de roles no contesta —qué menú
 * mostrar, si ofrecer el botón de diagnóstico— y sin esto las cablearía, que es exactamente la
 * duplicación de conocimiento de dominio que la regla de contrato existe para impedir.
 */
export const USER_ROLE_GROUPS: Readonly<Record<string, readonly UserRole[]>> = {
  diagnosing: DIAGNOSING_ROLES,
  identity: IDENTITY_ROLES,
  aiViewer: AI_VIEWER_ROLES,
  prescribing: PRESCRIBING_ROLES,
  delivery: DELIVERY_ROLES,
  intake: INTAKE_ROLES,
  analysis: ANALYSIS_ROLES,
  contrast: CONTRAST_ROLES,
  rawExport: RAW_EXPORT_ROLES,
  userAdmin: USER_ADMIN_ROLES,
  technicianAdmin: TECHNICIAN_ADMIN_ROLES,
  audit: AUDIT_ROLES,
  survey: SURVEY_ROLES,
  journey: JOURNEY_ROLES,
  study: STUDY_ROLES,
};

/** Sujeto de un consentimiento informado (RNF-07). */
export const CONSENT_SUBJECTS = ['paciente', 'personal_medico'] as const;
export type ConsentSubject = (typeof CONSENT_SUBJECTS)[number];

export const CONSENT_CURRENT_VERSION = '1.0';
