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
 * Chronometry of one medical review — table `cronometrajes_revision`, the digital Anexo 4.
 *
 * Covers: OE1 / RF-OE1-01. `t0` is stamped when the physician opens the case file and `t1` when
 * the definitive diagnosis is submitted; TRi = t1 - t0. Both timestamps are written by the server,
 * never by the client, so the measurement cannot be manipulated from the browser.
 *
 * The unique key over (case, mode) is what makes the case the pairing unit of the O₁ → X → O₂
 * design: exactly one pretest value and one postest value per case.
 */
@Entity('cronometrajes_revision')
@Index(['caseId', 'studyMode'], { unique: true })
export class ReviewTiming {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  @Index()
  @Column({ type: 'uuid', name: 'usuario_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'modo_estudio_codigo' })
  studyMode: StudyMode;

  @Column({ type: 'timestamptz', name: 't0' })
  t0: Date;

  @Column({ type: 'timestamptz', name: 't1', nullable: true })
  t1: Date | null;

  /** Persisted rather than derived, so the value in the dataset export is immutable evidence. */
  @Column({ type: 'int', name: 'duracion_segundos', nullable: true })
  durationSeconds: number | null;

  /** False for abandoned or interrupted reviews; excluded from TRM but never deleted. */
  @Column({ type: 'boolean', name: 'valido', default: true })
  valid: boolean;

  @Column({ type: 'text', name: 'notas', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
