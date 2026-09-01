import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { ConsentSubject } from 'src/common/domain';

/**
 * Electronic informed consent, for patients and for participating staff.
 *
 * Covers: RNF-07. Append-only: a withdrawal is a new row, never an edit, so the consent trail
 * stays defensible before the ethics committee.
 */
@Entity('consents')
export class Consent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 24, name: 'subject_type' })
  subjectType: ConsentSubject;

  /** Patient id or user id, depending on `subjectType`. */
  @Index()
  @Column({ type: 'uuid', name: 'subject_id' })
  subjectId: string;

  @Column({ type: 'varchar', length: 16 })
  version: string;

  @Column({ type: 'boolean', default: true })
  accepted: boolean;

  @Column({ type: 'timestamptz', name: 'accepted_at' })
  acceptedAt: Date;

  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
