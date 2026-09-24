import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { IndicatorSnapshot } from './indicator-snapshot.entity';

/**
 * One observation behind an indicator value — table `observaciones_indicador`.
 *
 * `orden` preserves the exact sequence the values entered the computation in, which is what makes
 * `hash_entrada` verifiable: a set would reproduce the mean but not the hash. Kept alongside the
 * aggregate so a re-analysis need not re-query the transactional tables, which by then may have
 * moved on.
 */
@Entity('observaciones_indicador')
export class IndicatorObservation {
  @PrimaryColumn({ type: 'uuid', name: 'instantanea_id' })
  snapshotId: string;

  @ManyToOne(() => IndicatorSnapshot, (snapshot) => snapshot.observationRows, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'instantanea_id' })
  snapshot?: IndicatorSnapshot;

  @PrimaryColumn({ type: 'int', name: 'orden' })
  position: number;

  @Column({ type: 'double precision', name: 'valor' })
  value: number;
}
