import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import { InferenceJob } from '../inference-job.entity';
import type { ClaimedJob, InferenceJobPayload, QueueProvider } from './queue.provider';

/**
 * PostgreSQL-backed inference queue.
 *
 * `claimNext` uses `FOR UPDATE SKIP LOCKED`, the standard PostgreSQL pattern for a work queue:
 * concurrent workers never hand the same job to two engines, and a crashed worker's job is picked
 * up again instead of blocking the queue.
 */
@Injectable()
export class PostgresQueueProvider implements QueueProvider {
  readonly driver = 'postgres';

  constructor(
    @InjectRepository(InferenceJob) private readonly repository: Repository<InferenceJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async enqueue(payload: InferenceJobPayload): Promise<string> {
    const job = this.repository.create({
      caseId: payload.caseId,
      imageId: payload.imageId,
      requestedBy: payload.requestedBy,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.config.queue.maxAttempts,
    });
    const saved = await this.repository.save(job);
    return saved.id;
  }

  async claimNext(): Promise<ClaimedJob | null> {
    const raw: unknown = await this.repository.query(
      `UPDATE "inference_jobs"
          SET "status" = 'running',
              "attempts" = "attempts" + 1,
              "locked_at" = now(),
              "updated_at" = now()
        WHERE "id" = (
          SELECT "id" FROM "inference_jobs"
           WHERE "status" = 'pending'
           ORDER BY "created_at" ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING "id", "case_id", "image_id", "requested_by", "attempts", "max_attempts"`,
    );

    const row = extractClaimedRow(raw);
    if (row === null) return null;

    return {
      jobId: row.id,
      caseId: row.case_id,
      imageId: row.image_id,
      requestedBy: row.requested_by,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    };
  }

  async complete(jobId: string, inferenceId: string): Promise<void> {
    await this.repository.update(
      { id: jobId },
      { status: 'succeeded', inferenceId, lockedAt: null, lastError: null },
    );
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = await this.repository.findOne({ where: { id: jobId } });
    if (job === null) return;

    const exhausted = job.attempts >= job.maxAttempts;
    await this.repository.update(
      { id: jobId },
      {
        status: exhausted ? 'failed' : 'pending',
        lockedAt: null,
        lastError: error.slice(0, 2000),
      },
    );
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.repository
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('job.status')
      .getRawMany<{ status: string; count: string }>();

    const result: Record<string, number> = { pending: 0, running: 0, succeeded: 0, failed: 0 };
    for (const row of rows) result[row.status] = Number(row.count);
    return result;
  }
}

interface RawClaimedJob {
  id: string;
  case_id: string;
  image_id: string;
  requested_by: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Normalises what TypeORM returns for `UPDATE ... RETURNING` and validates the row.
 *
 * TypeORM does not hand back a plain array of rows for a RETURNING statement: depending on the
 * driver and the statement type it may return `[rows, affectedCount]`. On an empty queue that
 * makes `raw[0]` an empty ARRAY rather than `undefined`, which passes a naive `=== undefined`
 * check and yields a phantom job whose every field is `undefined`. Downstream, a TypeORM `where`
 * built from undefined values silently drops those conditions and matches the newest row instead —
 * so an empty queue would repeatedly grab an unrelated, already-completed inference and flip it to
 * `running`. Validating the shape here is what keeps an idle worker genuinely idle.
 */
function extractClaimedRow(raw: unknown): RawClaimedJob | null {
  if (!Array.isArray(raw)) return null;

  const candidates: unknown = Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const row: unknown = candidates[0];
  if (typeof row !== 'object' || row === null) return null;

  const record = row as Record<string, unknown>;
  const hasIdentifiers =
    typeof record['id'] === 'string' &&
    typeof record['case_id'] === 'string' &&
    typeof record['image_id'] === 'string';

  return hasIdentifiers ? (record as unknown as RawClaimedJob) : null;
}
