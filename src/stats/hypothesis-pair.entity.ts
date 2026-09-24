import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { HypothesisRun } from './hypothesis-run.entity';

/**
 * One matched observation of a contrast — table `pares_hipotesis`.
 *
 * `pairKey` is a case id (HE₁, HE₂) or a professional id (HE₄). The values are stored BY VALUE and
 * not by reference on purpose: if the underlying case later changes, an already published contrast
 * must remain reproducible exactly as it was run.
 */
@Entity('pares_hipotesis')
export class HypothesisPair {
  @PrimaryColumn({ type: 'uuid', name: 'ejecucion_id' })
  runId: string;

  @ManyToOne(() => HypothesisRun, (run) => run.pairRows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ejecucion_id' })
  run?: HypothesisRun;

  @PrimaryColumn({ type: 'varchar', length: 64, name: 'clave_par' })
  pairKey: string;

  @Column({ type: 'varchar', length: 120, name: 'etiqueta' })
  label: string;

  @Column({ type: 'double precision', name: 'valor_pretest' })
  pretest: number;

  @Column({ type: 'double precision', name: 'valor_postest' })
  postest: number;

  @Column({ type: 'double precision', name: 'diferencia' })
  difference: number;
}
