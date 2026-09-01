import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { JobStatus } from 'src/common/domain';

/**
 * Inference queue backed by PostgreSQL.
 *
 * The mandated stack asks for BullMQ over Redis; with no Redis provisioned yet, the default
 * `QueueProvider` stores jobs here and a polling worker drains them. Switching to
 * `QUEUE_DRIVER=bullmq` swaps the provider without touching callers. Declared in
 * TRACEABILITY.md section 4.
 */
@Entity('inference_jobs')
export class InferenceJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'case_id' })
  caseId: string;

  @Column({ type: 'uuid', name: 'image_id' })
  imageId: string;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: JobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', name: 'max_attempts', default: 3 })
  maxAttempts: number;

  /** Set while a worker holds the job, so concurrent workers cannot pick it twice. */
  @Column({ type: 'timestamptz', name: 'locked_at', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'uuid', name: 'inference_id', nullable: true })
  inferenceId: string | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
