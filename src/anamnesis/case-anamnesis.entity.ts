import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';

import { AnamnesisAnswerRow } from './anamnesis-answer.entity';

/**
 * Header of the acne history taken at intake — table `anamnesis_caso`, one row per case.
 *
 * Attached to the CASE and not to the patient: a follow-up six weeks later has its own treatments,
 * its own symptoms and its own answers, and overwriting them would erase how the patient was at the
 * previous control. When a patient returns, the previous set is offered as a starting point and the
 * new row records what changed (`prefilledFromCaseId`).
 *
 * The 21 answers used to live in a `jsonb` column on this row. They are now rows of
 * `respuestas_anamnesis`: a JSON blob cannot be joined, indexed by value or constrained, so
 * "how many patients reported a current pregnancy" was a scan with JSON operators and is now a
 * two-table join. `AnamnesisService` still hands callers the same keyed map.
 */
@Entity('anamnesis_caso')
export class CaseAnamnesis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  /** `ANAMNESIS_VERSION` of the catalogue these answers were given against (RNF-03, RNF-05). */
  @Column({ type: 'varchar', length: 16, name: 'version_cuestionario' })
  version: string;

  /** Informative only — never a precondition for creating or reviewing the case. */
  @Column({ type: 'boolean', name: 'completa', default: false })
  complete: boolean;

  @Column({ type: 'uuid', name: 'precargada_de_caso_id', nullable: true })
  prefilledFromCaseId: string | null;

  @Column({ type: 'uuid', name: 'completada_por', nullable: true })
  completedBy: string | null;

  @OneToMany(() => AnamnesisAnswerRow, (answer) => answer.anamnesis)
  answerRows?: AnamnesisAnswerRow[];

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  updatedAt: Date;
}
