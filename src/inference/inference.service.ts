import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { GagsGrade, IgaClass } from 'src/common/domain';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { ImagesService } from 'src/images/images.service';

import { AiInference } from './ai-inference.entity';
import { AiEngineClient } from './ai-engine.client';
import { AiInferenceDto } from './dto/inference.dto';
import { QUEUE_PROVIDER, type QueueProvider } from './queue/queue.provider';

export type { AiInferenceDto };

/**
 * Orchestrates CNN inference: enqueue, drain, persist.
 *
 * Covers: OE2 (RF-OE2-01) and section 9.2 (`inference/`).
 *
 * Inference is asynchronous on purpose. Making the physician's request block on the model would
 * fold the engine's latency into TRi and contaminate the OE1 measurement with something that is
 * not medical review time.
 */
@Injectable()
export class InferenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InferenceService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private readonly startedAt = Date.now();

  constructor(
    @InjectRepository(AiInference) private readonly repository: Repository<AiInference>,
    @Inject(QUEUE_PROVIDER) private readonly queue: QueueProvider,
    private readonly aiEngine: AiEngineClient,
    private readonly imagesService: ImagesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain();
    }, this.config.queue.pollIntervalMs);
    this.logger.log(
      `Worker de inferencia activo (driver=${this.queue.driver}, intervalo=${this.config.queue.pollIntervalMs} ms).`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Creates the pending inference row and enqueues the job. Idempotent per (case, image). */
  async request(caseId: string, imageId: string, userId: string): Promise<AiInference> {
    const existing = await this.repository.findOne({
      where: { caseId, imageId },
      order: { createdAt: 'DESC' },
    });
    if (existing !== null && existing.status !== 'failed') return existing;

    const inference = await this.repository.save(
      this.repository.create({
        caseId,
        imageId,
        status: 'pending',
        modelVersion: 'pending',
        modelBackend: 'unknown',
        seed: 42,
      }),
    );
    await this.queue.enqueue({ caseId, imageId, requestedBy: userId });
    return inference;
  }

  async findByCase(caseId: string): Promise<AiInference | null> {
    return this.repository.findOne({ where: { caseId }, order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<AiInference> {
    const inference = await this.repository.findOne({ where: { id } });
    if (inference === null) throw new NotFoundException(`No existe la inferencia ${id}.`);
    return inference;
  }

  async queueStatus(): Promise<Record<string, number>> {
    return this.queue.countByStatus();
  }

  /** Drains one job per tick, keeping the API responsive under a single-process deployment. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const job = await this.queue.claimNext();
      if (job === null) return;

      try {
        const inference = await this.execute(job.caseId, job.imageId);
        await this.queue.complete(job.jobId, inference.id);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Inferencia fallida para el caso ${job.caseId} (intento ${job.attempts}/${job.maxAttempts}): ${message}`,
        );
        await this.queue.fail(job.jobId, message);
        // Both statuses must be reachable here: `execute` moves the row to `running` before it
        // can fail, so filtering on `pending` alone would leave every failed inference stuck in
        // `running` forever, invisible to the portal and to the IIA error rate.
        await this.repository.update(
          { caseId: job.caseId, imageId: job.imageId, status: In(['pending', 'running']) },
          { status: 'failed', errorMessage: message.slice(0, 2000) },
        );
      }
    } catch (error: unknown) {
      this.logger.error(`Error al drenar la cola de inferencia: ${String(error)}`);
    } finally {
      this.draining = false;
    }
  }

  private async execute(caseId: string, imageId: string): Promise<AiInference> {
    // Second line of defence against a malformed job: a TypeORM `where` built from undefined
    // values drops those conditions and would match an unrelated inference.
    if (typeof caseId !== 'string' || caseId === '' || typeof imageId !== 'string' || imageId === '') {
      throw new Error(
        `Trabajo de inferencia inválido (caseId="${caseId}", imageId="${imageId}"): se descarta ` +
          'sin tocar ninguna inferencia existente.',
      );
    }

    const inference = await this.repository.findOneOrFail({
      where: { caseId, imageId },
      order: { createdAt: 'DESC' },
    });
    await this.repository.update({ id: inference.id }, { status: 'running' });

    const { data, mimeType } = await this.imagesService.readPlaintext(imageId);
    const result = await this.aiEngine.inferSingle(
      data.toString('base64'),
      mimeType,
      caseId,
    );

    let heatmapImageId: string | null = null;
    if (result.heatmap_png_base64 !== null) {
      const heatmap = await this.imagesService.storeHeatmap(
        caseId,
        Buffer.from(result.heatmap_png_base64, 'base64'),
        'image/png',
      );
      heatmapImageId = heatmap.id;
    }

    await this.repository.update(
      { id: inference.id },
      {
        status: 'succeeded',
        igaClass: result.prediction.iga_class,
        confidence: result.prediction.confidence,
        classProbs: result.prediction.class_probs,
        gagsGrade: result.gags_secondary.grade,
        gagsScore: result.gags_secondary.score,
        heatmapImageId,
        latencyMs: result.latency_ms,
        modelVersion: result.model_version,
        modelBackend: result.model_backend,
        weightsChecksum: result.weights_checksum,
        seed: result.seed,
        errorMessage: null,
      },
    );

    return this.findById(inference.id);
  }

  /**
   * Latency and error statistics of the last 24 hours, as measured by the orchestrator itself.
   * Feeds `GET /audit/iia-check` (RF-TR-04) and the RNF-01 latency budget.
   */
  async latencyStats24h(): Promise<{
    count: number;
    medianMs: number | null;
    p95Ms: number | null;
    errorRate: number;
    uptimeHours: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.repository
      .createQueryBuilder('inference')
      .select('inference.latency_ms', 'latency')
      .addSelect('inference.status', 'status')
      .where('inference.created_at >= :since', { since })
      .getRawMany<{ latency: number | null; status: string }>();

    const latencies = rows
      .filter((r) => r.status === 'succeeded' && r.latency !== null)
      .map((r) => r.latency as number)
      .sort((a, b) => a - b);

    const failed = rows.filter((r) => r.status === 'failed').length;

    return {
      count: rows.length,
      medianMs: this.quantile(latencies, 0.5),
      p95Ms: this.quantile(latencies, 0.95),
      errorRate: rows.length === 0 ? 0 : failed / rows.length,
      uptimeHours: (Date.now() - this.startedAt) / 3_600_000,
    };
  }

  toDto(inference: AiInference): AiInferenceDto {
    return {
      id: inference.id,
      caseId: inference.caseId,
      imageId: inference.imageId,
      status: inference.status,
      igaClass: inference.igaClass,
      confidence: inference.confidence,
      classProbs: inference.classProbs,
      gagsGrade: inference.gagsGrade,
      gagsScore: inference.gagsScore,
      heatmapImageId: inference.heatmapImageId,
      latencyMs: inference.latencyMs,
      modelVersion: inference.modelVersion,
      modelBackend: inference.modelBackend,
      weightsChecksum: inference.weightsChecksum,
      seed: inference.seed,
      errorMessage: inference.errorMessage,
      createdAt: inference.createdAt.toISOString(),
    };
  }

  private quantile(sorted: number[], q: number): number | null {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
    return sorted[index] ?? null;
  }
}
