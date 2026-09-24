import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

/**
 * Infobip WhatsApp — the outbound gateway of the prototype (revision 21/09/2026).
 *
 * Until now WhatsApp was a *simulated* channel: the delivery row said so and nobody received
 * anything. This client sends for real through Infobip's WhatsApp API:
 *
 *  - `POST {base}/whatsapp/1/message/text` — free-form text. Meta only delivers it inside the
 *    24-hour customer-service window the patient opens by writing to the sender first.
 *  - `POST {base}/whatsapp/1/message/template` — a pre-approved template, deliverable at any
 *    time. On the free trial Infobip provides its test sender and the template
 *    `test_whatsapp_template_en` with one placeholder, and delivers only to numbers verified in
 *    its portal. That is a limit of the trial, not of this code.
 *
 * Authentication is `Authorization: App <api key>`. Numbers travel in international format
 * without `+` (`51987654321`). Nothing here is retried: a prescription sent twice is worse than
 * one the physician re-sends by hand after reading the recorded reason.
 */

export interface InfobipStatus {
  groupName: string;
  name: string;
  description: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  messageId: string | null;
  status: InfobipStatus | null;
  /** HTTP status of the call, or `null` when the request never completed. */
  httpStatus: number | null;
  /** Human-readable summary, kept in the delivery row. */
  detail: string;
}

interface InfobipSingleResponse {
  to?: string;
  messageId?: string;
  status?: Partial<InfobipStatus>;
  requestError?: { serviceException?: { messageId?: string; text?: string } };
}

const ACCEPTED_GROUPS = new Set(['PENDING', 'DELIVERED']);

@Injectable()
export class InfobipWhatsAppClient {
  private readonly logger = new Logger(InfobipWhatsAppClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** True when base URL, API key and sender are all present. */
  get isConfigured(): boolean {
    const { baseUrl, apiKey, sender } = this.config.messaging.infobip;
    return baseUrl !== '' && apiKey !== '' && sender !== '';
  }

  get sender(): string {
    return this.config.messaging.infobip.sender;
  }

  get templateName(): string {
    return this.config.messaging.infobip.template;
  }

  /**
   * A phone number as Infobip wants it: digits only, with the country code.
   *
   * Peruvian mobiles are nine digits starting with 9 and patients write them without the
   * country code; `defaultCountryCode` (51) fills the gap. Anything that already carries a code
   * (`+51…`, `0051…`, `51…` with 11 digits) is respected.
   */
  normalizeNumber(raw: string): string {
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    const country = this.config.messaging.defaultCountryCode;
    if (digits.length <= 10 && !digits.startsWith(country)) digits = `${country}${digits}`;
    return digits;
  }

  async sendText(to: string, text: string): Promise<WhatsAppSendResult> {
    return this.post('/whatsapp/1/message/text', {
      from: this.sender,
      to,
      content: { text },
    });
  }

  /**
   * A document the patient can open and print. Infobip fetches `mediaUrl` itself, so it must be
   * reachable from the internet (a public tunnel in development) and should expire soon after.
   */
  async sendDocument(
    to: string,
    mediaUrl: string,
    filename: string,
    caption: string,
  ): Promise<WhatsAppSendResult> {
    return this.post('/whatsapp/1/message/document', {
      from: this.sender,
      to,
      content: { mediaUrl, filename, caption },
    });
  }

  async sendTemplate(to: string, placeholders: string[]): Promise<WhatsAppSendResult> {
    const { template, templateLanguage } = this.config.messaging.infobip;
    return this.post(
      '/whatsapp/1/message/template',
      {
        messages: [
          {
            from: this.sender,
            to,
            content: {
              templateName: template,
              templateData: { body: { placeholders } },
              language: templateLanguage,
            },
          },
        ],
      },
      true,
    );
  }

  private async post(path: string, body: unknown, batched = false): Promise<WhatsAppSendResult> {
    const { baseUrl, apiKey } = this.config.messaging.infobip;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.messaging.timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `App ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: unknown = null;
      try {
        payload = raw === '' ? null : JSON.parse(raw);
      } catch {
        payload = raw;
      }
      return this.interpret(response.status, payload, batched);
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'tiempo de espera agotado'
          : String(error);
      this.logger.warn(`Infobip ${path}: sin respuesta (${reason}).`);
      return {
        ok: false,
        messageId: null,
        status: null,
        httpStatus: null,
        detail: `Infobip no respondió (${reason}).`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private interpret(httpStatus: number, payload: unknown, batched: boolean): WhatsAppSendResult {
    const top = (payload ?? {}) as InfobipSingleResponse & {
      messages?: InfobipSingleResponse[];
    };
    const single: InfobipSingleResponse = batched ? (top.messages?.[0] ?? top) : top;
    const status: InfobipStatus | null = single.status
      ? {
          groupName: single.status.groupName ?? '',
          name: single.status.name ?? '',
          description: single.status.description ?? '',
        }
      : null;
    if (httpStatus >= 200 && httpStatus < 300 && status !== null) {
      const ok = ACCEPTED_GROUPS.has(status.groupName);
      return {
        ok,
        messageId: single.messageId ?? null,
        status,
        httpStatus,
        detail: ok
          ? `Infobip aceptó el mensaje (${status.name}: ${status.description}).`
          : `Infobip rechazó el mensaje (${status.name}: ${status.description}).`,
      };
    }
    const text =
      single.requestError?.serviceException?.text ?? (typeof payload === 'string' ? payload : '');
    return {
      ok: false,
      messageId: null,
      status,
      httpStatus,
      detail: `Infobip respondió HTTP ${httpStatus}${text !== '' ? `: ${text}` : ''}.`,
    };
  }
}
