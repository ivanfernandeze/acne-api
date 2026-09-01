/**
 * Inference queue abstraction.
 *
 * Covers: section 9.2 (`inference/` — cola de inferencia, retries).
 *
 * The mandated stack specifies BullMQ over Redis. With no Redis provisioned, the default
 * implementation is a PostgreSQL-backed queue drained by a polling worker: same at-least-once
 * semantics, same retry budget, no extra infrastructure. Declared in TRACEABILITY.md section 4.
 */
export interface InferenceJobPayload {
  caseId: string;
  imageId: string;
  requestedBy: string;
}

export interface ClaimedJob extends InferenceJobPayload {
  jobId: string;
  attempts: number;
  maxAttempts: number;
}

export interface QueueProvider {
  readonly driver: string;

  /** Enqueues an inference and returns the job id. */
  enqueue(payload: InferenceJobPayload): Promise<string>;

  /** Atomically claims the next pending job, or `null` when the queue is empty. */
  claimNext(): Promise<ClaimedJob | null>;

  complete(jobId: string, inferenceId: string): Promise<void>;

  /** Records a failure; the job returns to `pending` while attempts remain. */
  fail(jobId: string, error: string): Promise<void>;

  countByStatus(): Promise<Record<string, number>>;
}

export const QUEUE_PROVIDER = 'QUEUE_PROVIDER';
