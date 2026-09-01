import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { StudyMode } from 'src/common/domain';
import { ClinicalCase } from 'src/cases/case.entity';
import { User } from 'src/users/user.entity';

/**
 * Chronometry of one medical review — the digital Anexo 4.
 *
 * Covers: OE1 / RF-OE1-01. `t0` is stamped when the physician opens the case file and `t1` when
 * the definitive diagnosis is submitted; TRi = t1 - t0. Both timestamps are written by the server,
 * never by the client, so the measurement cannot be manipulated from the browser.
 */
@Entity('review_timings')
@Index(['caseId', 'studyMode'], { unique: true })
export class ReviewTiming {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'case_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case?: ClinicalCase;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'study_mode' })
  studyMode: StudyMode;

  @Column({ type: 'timestamptz' })
  t0: Date;

  @Column({ type: 'timestamptz', nullable: true })
  t1: Date | null;

  /** Persisted rather than derived, so the value in the dataset export is immutable evidence. */
  @Column({ type: 'int', name: 'duration_seconds', nullable: true })
  durationSeconds: number | null;

  /** Set to false for abandoned or interrupted reviews; excluded from TRM. */
  @Column({ type: 'boolean', default: true })
  valid: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
