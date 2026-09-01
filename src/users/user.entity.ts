import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { StudyMode } from 'src/common/domain';
import type { UserRole } from 'src/common/domain';

/**
 * Clinical staff and study personnel.
 *
 * Covers: RF-TR-02 (JWT + roles) and RF-TR-01 (`study_mode` is the per-user switch of the
 * independent variable; a dermatologist in `pretest` cannot reach the AI at all).
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 180 })
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 160, name: 'full_name' })
  fullName: string;

  @Column({ type: 'varchar', length: 40 })
  role: UserRole;

  /** RF-TR-01. Persisted per user so the experimental condition survives a re-login. */
  @Column({ type: 'varchar', length: 20, name: 'study_mode', default: 'produccion' })
  studyMode: StudyMode;

  @Column({ type: 'varchar', length: 120, nullable: true })
  specialty: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** RNF-07: informed consent of the medical staff participating in the study. */
  @Column({ type: 'timestamptz', name: 'consent_accepted_at', nullable: true })
  consentAcceptedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
