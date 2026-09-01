/**
 * Typed application configuration, loaded once at bootstrap.
 *
 * Adapter drivers live here because they are the switch that restores the mandated stack
 * (Redis/BullMQ, MinIO, MLflow) without touching application code. See TRACEABILITY.md section 4.
 */

export type StorageDriver = 'local' | 'minio';
export type QueueDriver = 'postgres' | 'bullmq';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  globalPrefix: string;
  corsOrigins: string[];

  database: {
    url: string;
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
    redis: { host: string; port: number };
  };

  aiEngine: {
    url: string;
    timeoutMs: number;
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
    },

    jwt: {
      secret: jwtSecret,
      accessTtl: envString('JWT_ACCESS_TTL', '30m'),
      refreshTtl: envString('JWT_REFRESH_TTL', '7d'),
    },

    security: {
      encryptionKey,
      signedUrlTtlSeconds: envNumber('SIGNED_URL_TTL_SECONDS', 900),
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
      redis: {
        host: envString('REDIS_HOST', '127.0.0.1'),
        port: envNumber('REDIS_PORT', 6379),
      },
    },

    aiEngine: {
      url: envString('AI_ENGINE_URL', 'http://127.0.0.1:8000').replace(/\/+$/, ''),
      timeoutMs: envNumber('AI_ENGINE_TIMEOUT_MS', 30000),
    },

    study: {
      surveyTriggerCases: envNumber('SURVEY_TRIGGER_CASES', 10),
      tspBaselinePercent: envNumber('TSP_BASELINE_PERCENT', 60),
      alpha: envNumber('STATS_ALPHA', 0.05),
    },

    reports: {
      outputDir: envString('REPORTS_OUTPUT_DIR', './reports-output'),
    },
  };
}

/** Injection token for the fully resolved configuration object. */
export const APP_CONFIG = 'APP_CONFIG';
