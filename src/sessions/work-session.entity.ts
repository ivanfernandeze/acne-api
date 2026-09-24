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
 * A work journey (jornada) — table `jornadas_trabajo`, the digital Anexo 7.
 *
 * Covers: OE4 (RF-OE4-01, RF-OE4-02). TCAD = NCR / TJ, where NCR is counted by the system
 * (`casesReviewed`) and TJ is declared by the professional when closing the journey
 * (`declaredDurationHours`), exactly as the instrument prescribes.
 */
@Entity('jornadas_trabajo')
export class WorkSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'usuario_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'modo_estudio_codigo' })
  studyMode: StudyMode;

  @Column({ type: 'varchar', length: 16, name: 'turno_codigo' })
  shift: WorkShift;

  @Column({ type: 'timestamptz', name: 'iniciada_en' })
  startedAt: Date;

  @Column({ type: 'timestamptz', name: 'finalizada_en', nullable: true })
  endedAt: Date | null;

  /** TJ — declared by the user at closing time. */
  @Column({ type: 'double precision', name: 'horas_declaradas', nullable: true })
  declaredDurationHours: number | null;

  /** NCR — number of cases the system counted as reviewed during this journey. */
  @Column({ type: 'int', name: 'casos_revisados', default: 0 })
  casesReviewed: number;

  /** TCAD = NCR / TJ, frozen at closing time so the Anexo 7 row is immutable evidence. */
  @Column({ type: 'double precision', name: 'tcad', nullable: true })
  tcad: number | null;

  @Column({ type: 'boolean', name: 'es_sintetico', default: false })
  isSynthetic: boolean;

  @Column({ type: 'text', name: 'notas', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
