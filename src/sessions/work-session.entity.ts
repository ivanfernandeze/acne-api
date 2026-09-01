import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { StudyMode, WorkShift } from 'src/common/domain';
import { User } from 'src/users/user.entity';

/**
 * A work journey (jornada) — the digital Anexo 7.
 *
 * Covers: OE4 (RF-OE4-01, RF-OE4-02). TCAD = NCR / TJ, where NCR is counted by the system
 * (`casesReviewed`) and TJ is declared by the professional when closing the journey
 * (`declaredDurationHours`), exactly as the instrument prescribes.
 */
@Entity('work_sessions')
export class WorkSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'study_mode' })
  studyMode: StudyMode;

  @Column({ type: 'varchar', length: 16 })
  shift: WorkShift;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt: Date | null;

  /** TJ — declared by the user at closing time. */
  @Column({ type: 'double precision', name: 'declared_duration_hours', nullable: true })
  declaredDurationHours: number | null;

  /** NCR — number of cases the system counted as reviewed during this journey. */
  @Column({ type: 'int', name: 'cases_reviewed', default: 0 })
  casesReviewed: number;

  /** TCAD = NCR / TJ, frozen at closing time so the Anexo 7 row is immutable evidence. */
  @Column({ type: 'double precision', nullable: true })
  tcad: number | null;

  @Column({ type: 'boolean', name: 'is_synthetic', default: false })
  isSynthetic: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
