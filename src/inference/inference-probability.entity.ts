import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import type { IgaClass } from 'src/common/domain';

import { AiInference } from './ai-inference.entity';

/**
 * One class of the probability vector — table `probabilidades_inferencia`.
 *
 * Was a `jsonb` map keyed by IGA class, which repeated the class catalogue inside every inference
 * row and left the probabilities unreachable to SQL. As rows they are constrained (0..1), joined to
 * `clases_iga` and aggregated directly, which is what the ordinal error analysis of OE2 needs.
 */
@Entity('probabilidades_inferencia')
export class InferenceProbability {
  @PrimaryColumn({ type: 'uuid', name: 'inferencia_id' })
  inferenceId: string;

  @ManyToOne(() => AiInference, (inference) => inference.probabilities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inferencia_id' })
  inference?: AiInference;

  @PrimaryColumn({ type: 'varchar', length: 24, name: 'clase_iga_codigo' })
  igaClass: IgaClass;

  @Column({ type: 'double precision', name: 'probabilidad' })
  probability: number;
}
