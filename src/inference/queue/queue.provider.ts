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

  /**
   * Atomically claims the next pending job, or `null` when the queue is empty.
   *
   * "Pending" includes a job abandoned mid-flight: one whose lease expired while it was marked as
   * running. Without that, a worker that died between claiming and finishing would leave the job
   * marked running for ever — and the portal keeps showing "the model is reading the case" for a
   * case nobody is reading.
   */
  claimNext(): Promise<ClaimedJob | null>;

  /**
   * Gives up on jobs abandoned mid-flight that have no attempts left.
   *
   * @returns the abandoned jobs, so the caller can mark their inferences failed. An inference left
   *   pending for ever is worse than one marked failed: the second can be retried from the screen,
   *   the first only looks like the queue is slow.
   */
  expireStale(): Promise<Array<{ jobId: string; caseId: string; imageId: string }>>;

  complete(jobId: string, inferenceId: string): Promise<void>;

  /** Records a failure; the job returns to `pending` while attempts remain. */
  fail(jobId: string, error: string): Promise<void>;

  countByStatus(): Promise<Record<string, number>>;
}

export const QUEUE_PROVIDER = 'QUEUE_PROVIDER';
