/**
 * Nombres legibles de lo que registra la traza de auditoría.
 *
 * Cubre: RNF-02 y RNF-04.
 *
 * Hasta ahora la traza se leía en crudo: `case.list.identity`, `hypothesis_run`, `partial`. Eso es
 * legible para quien escribió el código y opaco para el auditor, que es exactamente la persona para
 * la que existe la pantalla — y el punto de una traza que nadie sabe leer se pierde entero.
 *
 * El código NO desaparece: sigue siendo el identificador por el que se filtra y el que se cita en
 * un hallazgo. Lo que cambia es que la pantalla muestra el nombre y guarda el código a un lado.
 *
 * Las acciones se declaran aquí y NO se derivan de las filas: derivarlas sería describir lo que ya
 * ocurrió, y una acción registrada por primera vez aparecería sin nombre justo cuando alguien la
 * está investigando. `auditActionLabel` cae de vuelta al código cuando falta, de modo que agregar
 * un endpoint sin pasar por aquí degrada a lo que había antes y nunca a una pantalla vacía.
 */

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'anamnesis.prefill': 'Precarga de anamnesis anterior',
  'anamnesis.save': 'Registro de anamnesis',
  'auth.login': 'Inicio de sesión',
  'capture.session.create': 'Emisión de QR de captura',
  'capture.session.revoke': 'Revocación de QR de captura',
  'capture.session.upload': 'Subida de foto desde el móvil',
  'case.close': 'Cierre de caso',
  'case.create': 'Alta de caso',
  'case.list.identity': 'Listado de casos con identidad',
  'case.open': 'Apertura de ficha (inicia cronómetro)',
  'case.read': 'Lectura de caso',
  'case.update': 'Edición de caso',
  'case.delete': 'Eliminación de caso sin evidencia (borrado con sus fotos)',
  'case.void': 'Anulación de caso con evidencia del estudio',
  'dataset.export': 'Exportación de dataset',
  'diagnosis.correct': 'Corrección de diagnóstico por el administrador',
  'diagnosis.submit': 'Envío de diagnóstico',
  'hypothesis.run': 'Contraste de hipótesis',
  'hypothesis.run_all': 'Contraste de las cuatro hipótesis',
  'image.read': 'Lectura de imagen clínica',
  'image.upload': 'Subida de imagen clínica',
  'image.remove': 'Retiro de imagen clínica',
  'image.relabel': 'Cambio de toma de una imagen clínica',
  'indicators.snapshot': 'Congelado de indicadores',
  'inference.request': 'Solicitud de inferencia',
  'analysis.select': 'Elección de la lectura del caso',
  'analysis.unselect': 'Vuelta a la regla automática del caso',
  'medication.create': 'Alta de medicamento',
  'medication.update': 'Edición de medicamento',
  'case.refer': 'Derivación a atención presencial',
  'case.request_photos': 'Devolución al mostrador por fotos',
  'case.resubmit': 'Reposición de fotos y reenvío a revisión',
  'medication.seed': 'Carga del vademécum base',
  'patient.create': 'Alta de paciente',
  'question.create': 'Alta de pregunta',
  'question.remove': 'Eliminación de pregunta',
  'question.update': 'Edición del cuestionario',
  'patient.history.read': 'Lectura de historia del paciente',
  'patient.identity.read': 'Descifrado de identidad del paciente',
  'patient.list.identity': 'Listado de pacientes con identidad',
  'patient.reinstate': 'Reincorporación al estudio',
  'prescription.annul': 'Anulación de receta',
  'prescription.create': 'Emisión de receta',
  'prescription.send': 'Envío de receta al paciente',
  'prescription.download': 'Descarga del PDF de la receta',
  'prescription.fetch': 'Recogida del PDF de la receta por la pasarela',
  'patient.update': 'Edición de paciente',
  'patient.withdraw': 'Retiro del estudio',
  'report.generate': 'Generación de reporte',
  'session.close': 'Cierre de jornada',
  'signature.remove': 'Retiro de la firma',
  'signature.update': 'Registro de la firma',
  'session.open': 'Apertura de jornada',
  'survey.submit': 'Envío del cuestionario',
  'user.consent.accept': 'Aceptación de consentimiento',
  'user.create': 'Alta de usuario',
  'user.password.change': 'Cambio de contraseña',
  'user.password.reset': 'Restablecimiento de contraseña',
  'user.update': 'Edición de usuario',
};

/** Nombre de la entidad tocada. Son los nombres del dominio, no los de las tablas. */
export const AUDIT_ENTITY_LABELS: Readonly<Record<string, string>> = {
  ai_inference: 'Inferencia',
  anamnesis_question: 'Pregunta',
  case: 'Caso',
  case_image: 'Imagen',
  dataset: 'Dataset',
  diagnosis: 'Diagnóstico',
  hypothesis_run: 'Contraste',
  indicator_snapshot: 'Indicador',
  medication: 'Medicamento',
  prescription: 'Receta',
  patient: 'Paciente',
  report: 'Reporte',
  survey_response: 'Encuesta',
  user: 'Usuario',
  work_session: 'Jornada',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType;
}

/**
 * Estado de cobertura de un objetivo (RNF-04).
 *
 * En español desde la reestructuración del 06/09/2026, como el resto de los valores de dominio: se
 * pintaban tal cual en la matriz de cobertura, de modo que el jurado leía `partial` en un documento
 * en español.
 */
export const COVERAGE_STATUSES = ['cubierto', 'parcial', 'pendiente'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const COVERAGE_STATUS_LABELS: Readonly<Record<CoverageStatus, string>> = {
  cubierto: 'Cubierto',
  parcial: 'Parcial',
  pendiente: 'Pendiente',
};
