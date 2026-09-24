/**
 * Typed application configuration, loaded once at bootstrap.
 *
 * Adapter drivers live here because they are the switch that restores the mandated stack
 * (Redis/BullMQ, MinIO, MLflow) without touching application code. See TRACEABILITY.md section 4.
 */

import { CAPTURE_DEFAULT_TTL_SECONDS } from 'src/common/domain';

export type StorageDriver = 'local' | 'minio';
export type QueueDriver = 'postgres' | 'bullmq';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  globalPrefix: string;
  corsOrigins: string[];

  database: {
    url: string;
    /** Plazo máximo de una consulta, en el servidor y en el cliente. */
    statementTimeoutMs: number;
    /** Plazo para abrir una conexión nueva. */
    connectTimeoutMs: number;
    ssl: boolean;
  };

  jwt: {
    secret: string;
    accessTtl: string;
    refreshTtl: string;
  };

  security: {
    /** 32-byte AES-256 key, hex encoded (RNF-02). */
    encryptionKey: string;
    /** TTL of the signed image URLs, in seconds. RNF-02 mandates 15 minutes. */
    signedUrlTtlSeconds: number;
    /**
     * TTL of a mobile capture session, in seconds.
     *
     * Same window as the signed URLs, and for the same reason: it is the only thing bounding a QR
     * link that anyone holding it can use, since the phone carries no session.
     */
    captureSessionTtlSeconds: number;
  };

  storage: {
    driver: StorageDriver;
    localPath: string;
    minio: {
      endPoint: string;
      port: number;
      useSSL: boolean;
      accessKey: string;
      secretKey: string;
      bucket: string;
    };
  };

  queue: {
    driver: QueueDriver;
    pollIntervalMs: number;
    maxAttempts: number;
    /**
     * Cuánto puede un trabajo estar «ejecutando» antes de darlo por abandonado.
     *
     * Un obrero puede morir a media faena —el proceso se reinicia, la conexión con la base se
     * corta entre el `UPDATE` que reclama el trabajo y su respuesta— y entonces el trabajo queda
     * marcado como en curso sin nadie detrás. Pasado el arriendo, otro obrero puede reclamarlo.
     *
     * Ha de ser holgadamente mayor que lo que tarda el motor, o se le quitaría el trabajo a un
     * obrero que sigue vivo y la misma imagen se inferiría dos veces.
     */
    leaseMs: number;
    redis: { host: string; port: number };
  };

  aiEngine: {
    url: string;
    timeoutMs: number;
    /**
     * Whether an uploaded photograph is screened for being an evaluable facial image before it is
     * filed. Off is a legitimate operating mode: the check costs a call per upload, and a model
     * that turns out to be too strict would block a real intake — the one failure a clinic cannot
     * absorb. It never blocks on its own when the engine is unreachable.
     */
    screenUploads: boolean;
  };

  study: {
    /** N postest cases that trigger the Likert questionnaire (RF-OE3-02). */
    surveyTriggerCases: number;
    /** Baseline satisfaction for the one-sample contrast of HE3 (RF-OE3-05), in %. */
    tspBaselinePercent: number;
    /** Significance level for every hypothesis test. */
    alpha: number;
  };

  reports: {
    outputDir: string;
  };

  /** Letterhead of the prescription PDF. */
  clinic: {
    name: string;
    subtitle: string;
    address: string;
    phone: string;
    email: string;
    taxId: string;
  };

  /**
   * How the outside world reaches this API (e.g. an ngrok tunnel). Needed only for a gateway
   * that must fetch a file from us — Infobip downloads the prescription PDF from here. Empty =
   * the prescription travels as text.
   */
  publicBaseUrl: string;

  messaging: {
    /** Country code prepended to local numbers (Peru: 51). */
    defaultCountryCode: string;
    timeoutMs: number;
    infobip: {
      /** `https://<subdominio>.api.infobip.com`, as shown in the Infobip portal. Empty = off. */
      baseUrl: string;
      apiKey: string;
      /** Registered WhatsApp sender; on the free trial, Infobip's test sender. */
      sender: string;
      /** Fallback template when free text is refused; empty disables the fallback. */
      template: string;
      templateLanguage: string;
    };
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno obligatoria "${name}". Copia .env.example a .env y complétala.`,
    );
  }
  return value;
}

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`La variable de entorno "${name}" debe ser numérica; se recibió "${raw}".`);
  }
  return parsed;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function envEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = envString(name, fallback);
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(
      `La variable de entorno "${name}" debe ser una de [${allowed.join(', ')}]; se recibió "${raw}".`,
    );
  }
  return raw as T;
}

export function loadConfiguration(): AppConfig {
  const encryptionKey = requireEnv('ENCRYPTION_KEY');
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error(
      'ENCRYPTION_KEY debe ser una clave AES-256 en hexadecimal de 64 caracteres. ' +
        'Genera una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  const jwtSecret = requireEnv('JWT_SECRET');
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  }

  return {
    nodeEnv: envString('NODE_ENV', 'development'),
    port: envNumber('API_PORT', 3001),
    globalPrefix: envString('API_GLOBAL_PREFIX', 'api'),
    // `localhost` and `127.0.0.1` are different origins to a browser, and developers use them
    // interchangeably. Allowing only one turns a trivial URL choice into a confusing
    // "cannot contact the API" error with no CORS message in sight.
    corsOrigins: envString(
      'CORS_ORIGINS',
      'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3002,http://127.0.0.1:3002',
    )
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),

    database: {
      url: requireEnv('DATABASE_URL'),
      ssl: envBoolean('DATABASE_SSL', false),
      // Holgado para los informes del administrador y muy por debajo de «para siempre».
      statementTimeoutMs: envNumber('DB_STATEMENT_TIMEOUT_MS', 60_000),
      connectTimeoutMs: envNumber('DB_CONNECT_TIMEOUT_MS', 15_000),
    },

    jwt: {
      secret: jwtSecret,
      accessTtl: envString('JWT_ACCESS_TTL', '30m'),
      refreshTtl: envString('JWT_REFRESH_TTL', '7d'),
    },

    security: {
      encryptionKey,
      signedUrlTtlSeconds: envNumber('SIGNED_URL_TTL_SECONDS', 900),
      captureSessionTtlSeconds: envNumber(
        'CAPTURE_SESSION_TTL_SECONDS',
        CAPTURE_DEFAULT_TTL_SECONDS,
      ),
    },

    storage: {
      driver: envEnum('STORAGE_DRIVER', ['local', 'minio'] as const, 'local'),
      localPath: envString('STORAGE_LOCAL_PATH', './storage'),
      minio: {
        endPoint: envString('MINIO_ENDPOINT', '127.0.0.1'),
        port: envNumber('MINIO_PORT', 9000),
        useSSL: envBoolean('MINIO_USE_SSL', false),
        accessKey: envString('MINIO_ACCESS_KEY', ''),
        secretKey: envString('MINIO_SECRET_KEY', ''),
        bucket: envString('MINIO_BUCKET', 'tesisacne-images'),
      },
    },

    queue: {
      driver: envEnum('QUEUE_DRIVER', ['postgres', 'bullmq'] as const, 'postgres'),
      pollIntervalMs: envNumber('QUEUE_POLL_INTERVAL_MS', 1500),
      maxAttempts: envNumber('QUEUE_MAX_ATTEMPTS', 3),
      // Cuatro veces el tiempo máximo del motor: si sigue trabajando, no se le quita el trabajo.
      leaseMs: envNumber('QUEUE_LEASE_MS', envNumber('AI_ENGINE_TIMEOUT_MS', 30000) * 4),
      redis: {
        host: envString('REDIS_HOST', '127.0.0.1'),
        port: envNumber('REDIS_PORT', 6379),
      },
    },

    aiEngine: {
      url: envString('AI_ENGINE_URL', 'http://127.0.0.1:8000').replace(/\/+$/, ''),
      timeoutMs: envNumber('AI_ENGINE_TIMEOUT_MS', 30000),
      screenUploads: envBoolean('IMAGE_SCREENING_ENABLED', true),
    },

    study: {
      surveyTriggerCases: envNumber('SURVEY_TRIGGER_CASES', 10),
      tspBaselinePercent: envNumber('TSP_BASELINE_PERCENT', 60),
      alpha: envNumber('STATS_ALPHA', 0.05),
    },

    reports: {
      outputDir: envString('REPORTS_OUTPUT_DIR', './reports-output'),
    },

    clinic: {
      name: envString('CLINIC_NAME', 'Consultorio Dermatológico — Estudio Acné UNT'),
      subtitle: envString('CLINIC_SUBTITLE', 'Universidad Nacional de Trujillo · Facultad de Ingeniería'),
      address: envString('CLINIC_ADDRESS', 'Trujillo, La Libertad, Perú'),
      phone: envString('CLINIC_PHONE', ''),
      email: envString('CLINIC_EMAIL', ''),
      taxId: envString('CLINIC_TAX_ID', ''),
    },
    publicBaseUrl: envString('PUBLIC_BASE_URL', '').trim().replace(/\/+$/, ''),

    messaging: {
      defaultCountryCode: envString('MESSAGING_DEFAULT_COUNTRY_CODE', '51').replace(/\D/g, ''),
      timeoutMs: envNumber('MESSAGING_TIMEOUT_MS', 15000),
      infobip: {
        baseUrl: envString('INFOBIP_BASE_URL', '')
          .trim()
          .replace(/\/+$/, '')
          .replace(/^(?!https?:\/\/)(.+)$/, 'https://$1'),
        apiKey: envString('INFOBIP_API_KEY', '').trim(),
        sender: envString('INFOBIP_WHATSAPP_SENDER', '447860099299').replace(/\D/g, ''),
        template: envString('INFOBIP_WHATSAPP_TEMPLATE', 'test_whatsapp_template_en').trim(),
        templateLanguage: envString('INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE', 'en').trim(),
      },
    },
  };
}

/** Injection token for the fully resolved configuration object. */
export const APP_CONFIG = 'APP_CONFIG';
