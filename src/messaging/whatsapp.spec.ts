import type { AppConfig } from 'src/config/configuration';

import { InfobipWhatsAppClient } from './infobip-whatsapp.client';
import {
  WhatsAppService,
  renderPrescriptionSummary,
  renderPrescriptionText,
  type PrescriptionMessage,
} from './whatsapp.service';

const config = (overrides: Partial<AppConfig['messaging']['infobip']> = {}): AppConfig =>
  ({
    messaging: {
      defaultCountryCode: '51',
      timeoutMs: 1000,
      infobip: {
        baseUrl: 'https://abc.api.infobip.com',
        apiKey: 'secret',
        sender: '447860099299',
        template: 'test_whatsapp_template_en',
        templateLanguage: 'en',
        ...overrides,
      },
    },
  }) as unknown as AppConfig;

const message: PrescriptionMessage = {
  prescriptionCode: 'REC-2026-0001',
  patientName: 'Ana Pérez',
  physicianName: 'Dra. Rojas',
  issuedAt: new Date('2026-09-21T15:00:00Z'),
  instructions: 'Evitar el sol.',
  items: [
    {
      name: 'Adapaleno 0,1 %',
      dose: '1 aplicación',
      frequency: 'cada noche',
      duration: '8 semanas',
      quantity: 1,
      indication: 'Capa fina',
    },
    {
      name: 'Doxiciclina 100 mg',
      dose: '1 tableta',
      frequency: 'cada 12 h',
      duration: '4 semanas',
      quantity: 56,
      indication: null,
    },
  ],
  verificationCode: 'ABCDEF123456',
};

type FetchCall = { url: string; body: string; headers: Record<string, string> };

function mockFetch(responses: Array<{ status: number; body: unknown }>): FetchCall[] {
  const calls: FetchCall[] = [];
  let index = 0;
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url,
      body: typeof init?.body === 'string' ? init.body : '',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = responses[Math.min(index, responses.length - 1)] ?? {
      status: 500,
      body: null,
    };
    index += 1;
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  return calls;
}

describe('InfobipWhatsAppClient', () => {
  it('is configured only with base URL, key and sender', () => {
    expect(new InfobipWhatsAppClient(config()).isConfigured).toBe(true);
    expect(new InfobipWhatsAppClient(config({ apiKey: '' })).isConfigured).toBe(false);
    expect(new InfobipWhatsAppClient(config({ baseUrl: '' })).isConfigured).toBe(false);
  });

  it('normalises Peruvian numbers to international digits', () => {
    const client = new InfobipWhatsAppClient(config());
    expect(client.normalizeNumber('987 654 321')).toBe('51987654321');
    expect(client.normalizeNumber('+51 987654321')).toBe('51987654321');
    expect(client.normalizeNumber('0051987654321')).toBe('51987654321');
    expect(client.normalizeNumber('51987654321')).toBe('51987654321');
    expect(client.normalizeNumber('+44 7860 099299')).toBe('447860099299');
  });

  it('posts a text message with the App authorisation and reads the status', async () => {
    const calls = mockFetch([
      {
        status: 200,
        body: {
          to: '51987654321',
          messageId: 'm-1',
          status: {
            groupId: 1,
            groupName: 'PENDING',
            name: 'PENDING_ENROUTE',
            description: 'Message sent to next instance',
          },
        },
      },
    ]);
    const result = await new InfobipWhatsAppClient(config()).sendText('51987654321', 'hola');
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('m-1');
    expect(calls[0]?.url).toBe('https://abc.api.infobip.com/whatsapp/1/message/text');
    expect(calls[0]?.headers.Authorization).toBe('App secret');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      from: '447860099299',
      to: '51987654321',
      content: { text: 'hola' },
    });
  });

  it('reports a rejection and an HTTP error without throwing', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          messageId: 'm-2',
          status: {
            groupName: 'REJECTED',
            name: 'EC_...',
            description: 'Outside window',
          },
        },
      },
    ]);
    const rejected = await new InfobipWhatsAppClient(config()).sendText('51987654321', 'x');
    expect(rejected.ok).toBe(false);
    expect(rejected.detail).toMatch(/rechazó/);

    mockFetch([
      {
        status: 401,
        body: {
          requestError: { serviceException: { text: 'Invalid login details' } },
        },
      },
    ]);
    const unauthorised = await new InfobipWhatsAppClient(config()).sendText('51987654321', 'x');
    expect(unauthorised.ok).toBe(false);
    expect(unauthorised.httpStatus).toBe(401);
    expect(unauthorised.detail).toMatch(/HTTP 401: Invalid login details/);
  });

  it('reads the first element of a template batch response', async () => {
    const calls = mockFetch([
      {
        status: 200,
        body: {
          messages: [
            {
              messageId: 't-1',
              status: {
                groupName: 'PENDING',
                name: 'PENDING_ACCEPTED',
                description: 'ok',
              },
            },
          ],
        },
      },
    ]);
    const result = await new InfobipWhatsAppClient(config()).sendTemplate('51987654321', [
      'resumen',
    ]);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('t-1');
    const body = JSON.parse(calls[0]?.body ?? '') as {
      messages: Array<{ content: Record<string, unknown> }>;
    };
    expect(body.messages[0]?.content).toEqual({
      templateName: 'test_whatsapp_template_en',
      templateData: { body: { placeholders: ['resumen'] } },
      language: 'en',
    });
  });
});

describe('WhatsAppService.sendPrescription', () => {
  it('sends the full text when the window is open', async () => {
    const calls = mockFetch([
      {
        status: 200,
        body: {
          messageId: 'm',
          status: { groupName: 'PENDING', name: 'P', description: 'd' },
        },
      },
    ]);
    const outcome = await new WhatsAppService(new InfobipWhatsAppClient(config())).sendPrescription(
      '987654321',
      message,
    );
    expect(outcome.successful).toBe(true);
    expect(outcome.detail).toMatch(/como texto a \+51987654321/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toContain('REC-2026-0001');
  });

  it('sends the PDF as a document first when a public URL is available', async () => {
    const calls = mockFetch([
      {
        status: 200,
        body: { messageId: 'd', status: { groupName: 'PENDING', name: 'P', description: 'd' } },
      },
    ]);
    const outcome = await new WhatsAppService(new InfobipWhatsAppClient(config())).sendPrescription(
      '987654321',
      message,
      {
        url: 'https://tunnel.example/api/prescriptions/x/document?token=t',
        filename: 'REC-2026-0001.pdf',
      },
    );
    expect(outcome.successful).toBe(true);
    expect(outcome.detail).toMatch(/como documento PDF \(REC-2026-0001\.pdf\)/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/message\/document$/);
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      from: '447860099299',
      to: '51987654321',
      content: {
        mediaUrl: 'https://tunnel.example/api/prescriptions/x/document?token=t',
        filename: 'REC-2026-0001.pdf',
        caption: 'Receta REC-2026-0001 · Dra. Rojas',
      },
    });
  });

  it('falls back to text when the document is refused, and records both', async () => {
    const calls = mockFetch([
      {
        status: 200,
        body: { status: { groupName: 'REJECTED', name: 'EC_MEDIA', description: 'cannot fetch' } },
      },
      {
        status: 200,
        body: { messageId: 'm', status: { groupName: 'PENDING', name: 'P', description: 'd' } },
      },
    ]);
    const outcome = await new WhatsAppService(new InfobipWhatsAppClient(config())).sendPrescription(
      '987654321',
      message,
      { url: 'https://tunnel.example/doc', filename: 'r.pdf' },
    );
    expect(outcome.successful).toBe(true);
    expect(outcome.detail).toMatch(
      /^El documento no fue aceptado: .*cannot fetch.*Enviado por Infobip como texto/,
    );
    expect(calls).toHaveLength(2);
  });

  it('falls back to the template when free text is refused, and says so', async () => {
    const calls = mockFetch([
      {
        status: 200,
        body: {
          messageId: 'm',
          status: {
            groupName: 'REJECTED',
            name: 'EC_OUTSIDE_WINDOW',
            description: 'no session',
          },
        },
      },
      {
        status: 200,
        body: {
          messages: [
            {
              messageId: 't',
              status: { groupName: 'PENDING', name: 'P', description: 'd' },
            },
          ],
        },
      },
    ]);
    const outcome = await new WhatsAppService(new InfobipWhatsAppClient(config())).sendPrescription(
      '987654321',
      message,
    );
    expect(outcome.successful).toBe(true);
    expect(outcome.messageId).toBe('t');
    expect(outcome.detail).toMatch(/plantilla «test_whatsapp_template_en»/);
    expect(outcome.detail).toMatch(/texto libre no fue aceptado/);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toMatch(/message\/template$/);
  });

  it('fails honestly when both routes are refused', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          status: { groupName: 'REJECTED', name: 'R', description: 'no' },
        },
      },
    ]);
    const outcome = await new WhatsAppService(new InfobipWhatsAppClient(config())).sendPrescription(
      '987654321',
      message,
    );
    expect(outcome.successful).toBe(false);
    expect(outcome.detail).toMatch(/Texto no aceptado/);
    expect(outcome.detail).toMatch(/Plantilla no aceptada/);
  });
});

describe('prescription text', () => {
  it('lists every medication and the verification code', () => {
    const text = renderPrescriptionText(message);
    expect(text).toContain('*Acné UNT · Receta REC-2026-0001*');
    expect(text).toContain('Paciente: Ana Pérez');
    expect(text).toContain(
      '1. Adapaleno 0,1 % — 1 aplicación, cada noche, 8 semanas (cantidad: 1)',
    );
    expect(text).toContain('   Indicación: Capa fina');
    expect(text).toContain('2. Doxiciclina 100 mg');
    expect(text).toContain('*Indicaciones*: Evitar el sol.');
    expect(text).toContain('Código de verificación: ABCDEF123456');
    expect(renderPrescriptionSummary(message)).toMatch(
      /^Receta REC-2026-0001 de Dra. Rojas, 21\/09\/2026: Adapaleno/,
    );
  });
});
