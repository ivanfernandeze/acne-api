import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { ProcessStatus } from 'src/common/domain';

/**
 * Inference queue backed by PostgreSQL — table `trabajos_inferencia`.
 *
 * The mandated stack asks for BullMQ over Redis; with no Redis provisioned yet, the default
 * `QueueProvider` stores jobs here and a polling worker drains them. Switching to
 * `QUEUE_DRIVER=bullmq` swaps the provider without touching callers. Declared in
 * TRACEABILITY.md section 4.
 */
@Entity('trabajos_inferencia')
export class InferenceJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @Column({ type: 'uuid', name: 'imagen_id' })
  imageId: string;

  @Column({ type: 'uuid', name: 'solicitado_por' })
  requestedBy: string;

  /** FK to `estados_proceso`, the same catalogue the resulting inference is stamped with. */
  @Index()
  @Column({ type: 'varchar', length: 20, name: 'estado_codigo', default: 'pendiente' })
  status: ProcessStatus;

  @Column({ type: 'int', name: 'intentos', default: 0 })
  attempts: number;

  @Column({ type: 'int', name: 'max_intentos', default: 3 })
  maxAttempts: number;

  /** Set while a worker holds the job, so concurrent workers cannot pick it twice. */
  @Column({ type: 'timestamptz', name: 'bloqueado_en', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'uuid', name: 'inferencia_id', nullable: true })
  inferenceId: string | null;

  @Column({ type: 'text', name: 'ultimo_error', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  updatedAt: Date;
}
