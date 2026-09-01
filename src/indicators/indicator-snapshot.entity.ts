import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { IndicatorKey, StudyMode } from 'src/common/domain';

/**
 * Immutable record of one indicator computation.
 *
 * Covers: RNF-05 — "Todo cálculo de indicador genera un log inmutable con: input, semilla,
 * versión de la función estadística, resultado, timestamp". Rows are INSERT-only: the migration
 * grants no UPDATE or DELETE path from the application, so an external evaluator can trust that a
 * reported figure was never retro-edited.
 */
@Entity('indicator_snapshots')
export class IndicatorSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 8 })
  indicator: IndicatorKey;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'study_mode' })
  studyMode: StudyMode;

  /** `global` or a user id, when the indicator was computed for a single professional. */
  @Column({ type: 'varchar', length: 64, default: 'global' })
  scope: string;

  @Column({ type: 'double precision' })
  value: number;

  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @Column({ type: 'int' })
  n: number;

  /** The individual observations behind `value`, kept for the boxplots and for re-analysis. */
  @Column({ type: 'jsonb' })
  observations: number[];

  @Column({ type: 'jsonb' })
  descriptive: Record<string, number>;

  /** SHA-256 of the ordered input rows (RNF-05). */
  @Column({ type: 'varchar', length: 64, name: 'input_hash' })
  inputHash: string;

  @Column({ type: 'varchar', length: 40, name: 'function_version' })
  functionVersion: string;

  @Column({ type: 'boolean', name: 'includes_synthetic', default: false })
  includesSynthetic: boolean;

  @Column({ type: 'uuid', name: 'computed_by', nullable: true })
  computedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'computed_at' })
  computedAt: Date;
}
