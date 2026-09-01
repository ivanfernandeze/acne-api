import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { GagsGrade, IgaClass } from 'src/common/domain';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

/**
 * Typed client of `acne-ai-engine`.
 *
 * The response shapes mirror section 9.1 of the specification verbatim. They can be regenerated
 * from the engine's own OpenAPI document with `pnpm generate:ai-types`, which is the contract rule
 * of section 4: no hand-written duplicate of another service's schema.
 */

export interface InferSingleResponse {
  prediction: {
    iga_class: IgaClass;
    confidence: number;
    class_probs: Record<string, number>;
  };
  gags_secondary: { grade: GagsGrade; score: number };
  /** Grad-CAM overlay, base64-encoded PNG (section 8.4). */
  heatmap_png_base64: string | null;
  latency_ms: number;
  model_version: string;
  model_backend: 'stub' | 'torch';
  weights_checksum: string | null;
  seed: number;
}

export interface IiaCheckResponse {
  operational: boolean;
  model_backend: 'stub' | 'torch';
  version: string;
  weights_checksum: string | null;
  latency_median_24h_ms: number | null;
  latency_p95_24h_ms: number | null;
  error_rate_24h: number;
  uptime_hours: number;
  inferences_24h: number;
  seed: number;
  checked_at: string;
  warnings: string[];
}

export interface ModelEvalResponse {
  accuracy: number;
  f1_macro: number;
  auc_roc_macro: number | null;
  confusion_matrix: number[][];
  per_class_metrics: Array<{
    iga_class: IgaClass;
    support: number;
    precision: number;
    recall: number;
    specificity: number;
    f1: number;
  }>;
  dataset_version: string;
  split: string;
  model_version: string;
  run_id: string | null;
  note: string | null;
}

export interface PairedTestRequest {
  design: 'paired' | 'one_sample';
  alpha: number;
  alternative: 'two-sided' | 'less' | 'greater';
  pretest: number[];
  postest?: number[];
  baseline?: number;
  seed: number;
}

export interface PairedTestResponse {
  normality: {
    test: 'shapiro-wilk';
    statistic: number;
    p_value: number;
    normal: boolean;
    applicable: boolean;
    note: string | null;
  };
  test_applied: 'ttest_rel' | 'wilcoxon' | 'ttest_1samp' | 'wilcoxon_1samp';
  statistic: number;
  p_value: number;
  effect_size: {
    kind: 'cohens_dz' | 'rank_biserial';
    value: number;
    magnitude: 'trivial' | 'small' | 'medium' | 'large';
  } | null;
  function_version: string;
}

@Injectable()
export class AiEngineClient {
  private readonly logger = new Logger(AiEngineClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async inferSingle(imageBase64: string, mimeType: string, caseCode: string): Promise<InferSingleResponse> {
    return this.post<InferSingleResponse>('/infer/single', {
      image_base64: imageBase64,
      mime_type: mimeType,
      case_code: caseCode,
    });
  }

  async iiaCheck(): Promise<IiaCheckResponse> {
    return this.get<IiaCheckResponse>('/audit/iia-check');
  }

  async modelEval(datasetVersion: string, split: string): Promise<ModelEvalResponse> {
    return this.post<ModelEvalResponse>('/model/eval', {
      dataset_version: datasetVersion,
      split,
    });
  }

  /** Delegates the SciPy contrast to Python, where the mandated stack puts it. */
  async pairedTest(payload: PairedTestRequest): Promise<PairedTestResponse> {
    return this.post<PairedTestResponse>('/stats/paired-test', payload);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const result = await this.get<{ status: string; model_backend: string }>('/health');
      return { ok: result.status === 'ok', detail: `motor de IA (${result.model_backend})` };
    } catch (error: unknown) {
      return { ok: false, detail: `motor de IA inaccesible: ${this.describe(error)}` };
    }
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.config.aiEngine.url}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.aiEngine.timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const detail = await response.text();
        throw new ServiceUnavailableException(
          `El motor de IA respondió ${response.status} en ${path}: ${detail.slice(0, 500)}`,
        );
      }
      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Fallo al llamar al motor de IA en ${url}: ${this.describe(error)}`);
      throw new ServiceUnavailableException(
        `No se pudo contactar al motor de IA en ${this.config.aiEngine.url}. ` +
          'Verifique que acne-ai-engine esté levantado.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
