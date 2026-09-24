import { Injectable, Logger } from '@nestjs/common';

import { InfobipWhatsAppClient, type WhatsAppSendResult } from './infobip-whatsapp.client';

/** What the patient receives: the prescription in words, since the trial cannot attach a PDF. */
export interface PrescriptionMessage {
  prescriptionCode: string;
  patientName: string | null;
  physicianName: string;
  issuedAt: Date;
  instructions: string | null;
  items: Array<{
    name: string;
    dose: string;
    frequency: string;
    duration: string;
    quantity: number;
    indication: string | null;
  }>;
  /** First characters of the document fingerprint, so the patient can verify it in the clinic. */
  verificationCode: string | null;
}

export interface DeliveryOutcome {
  successful: boolean;
  /** Recorded in `entregas_receta.detalle`; says which route worked, or why none did. */
  detail: string;
  messageId: string | null;
}

/**
 * WhatsApp delivery of a prescription, with the two routes Meta allows.
 *
 * Text first: complete and readable. If Infobip rejects it — almost always because the patient
 * has not written to the sender in the last 24 hours — the template route is tried, which Meta
 * delivers at any time but whose wording is fixed at Meta (on the trial, Infobip's test
 * template with one placeholder). Both attempts are described in `detail`, so the physician
 * sees what was sent and the audit says why.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly client: InfobipWhatsAppClient) {}

  get isConfigured(): boolean {
    return this.client.isConfigured;
  }

  async sendPrescription(
    destination: string,
    message: PrescriptionMessage,
    document: { url: string; filename: string } | null = null,
  ): Promise<DeliveryOutcome> {
    const to = this.client.normalizeNumber(destination);
    const text = renderPrescriptionText(message);

    // The PDF is the deliverable; the text is what remains when the PDF cannot travel.
    let documentNote = '';
    if (document !== null) {
      const caption = `Receta ${message.prescriptionCode} · ${message.physicianName}`;
      const asDocument = await this.client.sendDocument(
        to,
        document.url,
        document.filename,
        caption,
      );
      if (asDocument.ok) {
        return {
          successful: true,
          messageId: asDocument.messageId,
          detail: `Enviado por Infobip como documento PDF (${document.filename}) a +${to}. ${asDocument.detail}`,
        };
      }
      this.logger.warn(`WhatsApp documento a +${to} no aceptado: ${asDocument.detail}`);
      documentNote = `El documento no fue aceptado: ${trimDot(asDocument.detail)}. `;
    }

    const asText = await this.client.sendText(to, text);
    if (asText.ok) {
      return {
        successful: true,
        messageId: asText.messageId,
        detail: `${documentNote}Enviado por Infobip como texto a +${to}. ${asText.detail}`,
      };
    }
    this.logger.warn(`WhatsApp texto a +${to} no aceptado: ${asText.detail}`);

    if (this.client.templateName === '') {
      return {
        successful: false,
        messageId: null,
        detail: `${documentNote}Texto no aceptado: ${asText.detail}`,
      };
    }
    const asTemplate = await this.client.sendTemplate(to, [renderPrescriptionSummary(message)]);
    if (asTemplate.ok) {
      return {
        successful: true,
        messageId: asTemplate.messageId,
        detail:
          `${documentNote}Enviado por Infobip con la plantilla «${this.client.templateName}» a +${to} ` +
          `(el texto libre no fue aceptado: ${trimDot(asText.detail)}). ${asTemplate.detail}`,
      };
    }
    return {
      successful: false,
      messageId: null,
      detail: `${documentNote}Texto no aceptado: ${trimDot(asText.detail)}. Plantilla no aceptada: ${asTemplate.detail}`,
    };
  }
}

function trimDot(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** The full prescription, WhatsApp-formatted (asterisks are bold). */
export function renderPrescriptionText(m: PrescriptionMessage): string {
  const lines: string[] = [];
  lines.push(`*Acné UNT · Receta ${m.prescriptionCode}*`);
  if (m.patientName !== null && m.patientName.trim() !== '')
    lines.push(`Paciente: ${m.patientName.trim()}`);
  lines.push(`Médico/a: ${m.physicianName}`);
  lines.push(`Fecha: ${formatDate(m.issuedAt)}`);
  lines.push('');
  lines.push('*Medicamentos*');
  m.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.name} — ${item.dose}, ${item.frequency}, ${item.duration} (cantidad: ${item.quantity})`,
    );
    if (item.indication !== null && item.indication.trim() !== '') {
      lines.push(`   Indicación: ${item.indication.trim()}`);
    }
  });
  if (m.instructions !== null && m.instructions.trim() !== '') {
    lines.push('');
    lines.push(`*Indicaciones*: ${m.instructions.trim()}`);
  }
  lines.push('');
  if (m.verificationCode !== null) lines.push(`Código de verificación: ${m.verificationCode}`);
  lines.push(
    'Mensaje informativo del estudio Acné UNT. Ante cualquier duda, consulte a su médico/a.',
  );
  return lines.join('\n');
}

/** One placeholder's worth: what fits in a template body. */
export function renderPrescriptionSummary(m: PrescriptionMessage): string {
  const meds = m.items
    .map((i) => `${i.name} (${i.dose}, ${i.frequency}, ${i.duration})`)
    .join('; ');
  const summary = `Receta ${m.prescriptionCode} de ${m.physicianName}, ${formatDate(m.issuedAt)}: ${meds}.`;
  return summary.length > 1000 ? `${summary.slice(0, 997)}…` : summary;
}

export type { WhatsAppSendResult };
