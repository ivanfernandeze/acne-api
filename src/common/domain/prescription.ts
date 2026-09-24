/**
 * Receta, medicamentos y entrega al paciente.
 *
 * El proceso que DermAsist opera y que el prototipo no tenía: hasta ahora la consulta terminaba
 * cuando el especialista firmaba una clase IGA, que es lo que la tesis mide, y el paciente se iba
 * sin tratamiento. Estos catálogos cierran ese hueco.
 *
 * NO participan de ningún indicador. TRM se detiene al enviar el diagnóstico, TPD compara clases
 * IGA y TCAD cuenta casos revisados: nada de esto cambia porque después se emita una receta. Está
 * aquí porque el proceso clínico lo exige, no porque la medición lo pida, y esa distinción importa
 * al defender qué parte del sistema produce evidencia.
 */

export const PRESCRIPTION_STATUSES = ['generada', 'enviada', 'anulada'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export const PRESCRIPTION_STATUS_LABELS: Readonly<Record<PrescriptionStatus, string>> = {
  generada: 'Generada',
  enviada: 'Enviada al paciente',
  anulada: 'Anulada',
};

export const PRESCRIPTION_STATUS_ORDER: Readonly<Record<PrescriptionStatus, number>> = {
  generada: 1,
  enviada: 2,
  anulada: 3,
};

/**
 * Una receta emitida NUNCA se edita ni se borra: se anula y se emite otra.
 *
 * El paciente ya se llevó la primera, así que reescribirla dejaría en el sistema un documento que
 * no coincide con el que está en su mano — y es el suyo el que va a presentar en la farmacia.
 */
export const PRESCRIPTION_TRANSITIONS: Readonly<
  Record<PrescriptionStatus, readonly PrescriptionStatus[]>
> = {
  generada: ['enviada', 'anulada'],
  enviada: ['anulada'],
  anulada: [],
};

export function canTransitionPrescription(
  from: PrescriptionStatus,
  to: PrescriptionStatus,
): boolean {
  return PRESCRIPTION_TRANSITIONS[from].includes(to);
}

export function isPrescriptionStatus(value: unknown): value is PrescriptionStatus {
  return typeof value === 'string' && (PRESCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Por dónde se le hace llegar la receta al paciente. */
export const DELIVERY_CHANNELS = ['whatsapp', 'correo', 'descarga'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_CHANNEL_LABELS: Readonly<Record<DeliveryChannel, string>> = {
  whatsapp: 'WhatsApp',
  correo: 'Correo electrónico',
  descarga: 'Descarga directa',
};

/**
 * Canales que el prototipo SIMULA en vez de ejecutar.
 *
 * No hay pasarela de WhatsApp contratada ni servidor de correo saliente. El envío se registra en
 * `envios_receta` con `simulado = true` y la pantalla lo dice con todas las letras: presentar un
 * envío inexistente como realizado sería falsear la evidencia, y el sustentante tendría que
 * defender en la exposición algo que el sistema nunca hizo.
 */
export const SIMULATED_CHANNELS: readonly DeliveryChannel[] = ['whatsapp', 'correo'];

export function isSimulatedChannel(channel: DeliveryChannel): boolean {
  return SIMULATED_CHANNELS.includes(channel);
}

export function isDeliveryChannel(value: unknown): value is DeliveryChannel {
  return typeof value === 'string' && (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

/** Límites de un renglón de receta, alineados con los `varchar` de la migración. */
export const PRESCRIPTION_ITEM_LIMITS = {
  name: 160,
  dose: 120,
  frequency: 120,
  duration: 120,
  indication: 200,
  maxQuantity: 999,
  maxItems: 12,
} as const;

/**
 * Tope de renglones por receta.
 *
 * Doce es holgado para un acné —lo habitual son dos o tres— y acota lo que un formulario puede
 * enviar de una vez. No es una regla clínica: es el límite que evita que un error de la interfaz
 * inserte cientos de filas en una tabla que nadie vuelve a revisar.
 */
export const MAX_PRESCRIPTION_ITEMS = PRESCRIPTION_ITEM_LIMITS.maxItems;
