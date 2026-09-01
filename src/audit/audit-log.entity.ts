import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit trail.
 *
 * Covers: RNF-02 — "logs de auditoría por acceso a caso". Every read of a clinical image, every
 * decryption of a patient's identity and every dataset export lands here.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 180, name: 'user_email', nullable: true })
  userEmail: string | null;

  /** e.g. `image.read`, `patient.identity.read`, `dataset.export`, `hypothesis.run`. */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Index()
  @Column({ type: 'varchar', length: 40, name: 'entity_type' })
  entityType: string;

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
