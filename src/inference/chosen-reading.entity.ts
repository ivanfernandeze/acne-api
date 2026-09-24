import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from 'src/users/user.entity';

import { AiInference } from './ai-inference.entity';

/**
 * A reading the clinician chose for a case — table `lecturas_elegidas`.
 *
 * A history: one row per choice, withdrawn (`withdrawnAt`) rather than deleted when the case goes
 * back to the rule or someone chooses again. The active choice is the latest row with
 * `withdrawnAt === null`; while its inference is still the latest for its image,
 * `InferenceService.caseAnalysis` uses it as the case suggestion instead of the automatic rule.
 * See migration `1758000000000-LecturaElegida`.
 */
@Entity('lecturas_elegidas')
export class ChosenReading {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @Column({ type: 'uuid', name: 'inferencia_id' })
  inferenceId: string;

  @ManyToOne(() => AiInference, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inferencia_id' })
  inference?: AiInference;

  /** `null` = the ensemble reading of that view; otherwise a `miembros_inferencia.etiqueta`. */
  @Column({ type: 'varchar', length: 40, name: 'miembro_etiqueta', nullable: true })
  memberTag: string | null;

  @Column({ type: 'text', name: 'motivo', nullable: true })
  reason: string | null;

  @Column({ type: 'uuid', name: 'usuario_id', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  user?: User | null;

  @Column({ type: 'timestamptz', name: 'elegida_en' })
  chosenAt: Date;

  @Column({ type: 'timestamptz', name: 'retirada_en', nullable: true })
  withdrawnAt: Date | null;

  @Column({ type: 'uuid', name: 'retirada_por_id', nullable: true })
  withdrawnById: string | null;
}
