import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  Alternative,
  EffectSize,
  HypothesisKey,
  IndicatorKey,
  NormalityResult,
  PairedObservation,
  StatisticalTest,
  TestDesign,
} from 'src/common/domain';

/**
 * Immutable record of one hypothesis contrast.
 *
 * Covers: RNF-05 and RF-OE1-04 / RF-OE2-05 / RF-OE3-05 / RF-OE4-03. Everything needed to
 * re-execute the test identically six months later is stored here: the exact paired data, the
 * seed, the alpha, the normality outcome, the test chosen and the version of the statistical
 * function that produced it.
 */
@Entity('hypothesis_runs')
export class HypothesisRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 8 })
  hypothesis: HypothesisKey;

  @Column({ type: 'varchar', length: 8 })
  indicator: IndicatorKey;

  @Column({ type: 'varchar', length: 16 })
  design: TestDesign;

  @Column({ type: 'double precision' })
  alpha: number;

  @Column({ type: 'varchar', length: 16 })
  alternative: Alternative;

  @Column({ type: 'int', name: 'n_pairs' })
  nPairs: number;

  @Column({ type: 'double precision', name: 'pretest_mean' })
  pretestMean: number;

  @Column({ type: 'double precision', name: 'postest_mean' })
  postestMean: number;

  @Column({ type: 'double precision', name: 'mean_difference' })
  meanDifference: number;

  @Column({ type: 'jsonb' })
  normality: NormalityResult;

  @Column({ type: 'varchar', length: 24, name: 'test_applied' })
  testApplied: StatisticalTest;

  @Column({ type: 'double precision' })
  statistic: number;

  @Column({ type: 'double precision', name: 'p_value' })
  pValue: number;

  @Column({ type: 'jsonb', name: 'effect_size', nullable: true })
  effectSize: EffectSize | null;

  @Column({ type: 'boolean', name: 'rejects_null' })
  rejectsNull: boolean;

  @Column({ type: 'text' })
  conclusion: string;

  /** The exact matched observations the test consumed. */
  @Column({ type: 'jsonb' })
  pairs: PairedObservation[];

  @Column({ type: 'int', default: 42 })
  seed: number;

  @Column({ type: 'varchar', length: 40, name: 'function_version' })
  functionVersion: string;

  @Column({ type: 'varchar', length: 64, name: 'input_hash' })
  inputHash: string;

  @Column({ type: 'boolean', name: 'includes_synthetic', default: false })
  includesSynthetic: boolean;

  @Column({ type: 'uuid', name: 'executed_by', nullable: true })
  executedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'executed_at' })
  executedAt: Date;
}
