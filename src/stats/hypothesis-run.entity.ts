import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type {
  Alternative,
  EffectSize,
  HypothesisKey,
  IndicatorKey,
  StatisticalTest,
  TestDesign,
} from 'src/common/domain';

import { HypothesisPair } from './hypothesis-pair.entity';

/**
 * Immutable record of one hypothesis contrast — table `ejecuciones_hipotesis`.
 *
 * Covers: RNF-05 and RF-OE1-04 / RF-OE2-05 / RF-OE3-05 / RF-OE4-03. Everything needed to
 * re-execute the test identically six months later is stored here: the exact paired data, the
 * seed, the alpha, the normality outcome, the test chosen and the version of the statistical
 * function that produced it.
 *
 * The normality result and the effect size were `jsonb` and are now columns, so "which contrasts
 * were parametric" is a WHERE clause rather than a JSON traversal. `testApplied`, `design` and
 * `alternative` keep SciPy's vocabulary on purpose: they are the exact arguments the function was
 * invoked with, and translating them would need a round-trip dictionary that can only get it wrong.
 */
@Entity('ejecuciones_hipotesis')
export class HypothesisRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 8, name: 'hipotesis_codigo' })
  hypothesis: HypothesisKey;

  @Column({ type: 'varchar', length: 8, name: 'indicador_codigo' })
  indicator: IndicatorKey;

  @Column({ type: 'varchar', length: 16, name: 'diseno' })
  design: TestDesign;

  @Column({ type: 'double precision', name: 'alfa' })
  alpha: number;

  @Column({ type: 'varchar', length: 16, name: 'alternativa' })
  alternative: Alternative;

  @Column({ type: 'int', name: 'n_pares' })
  nPairs: number;

  @Column({ type: 'double precision', name: 'media_pretest' })
  pretestMean: number;

  @Column({ type: 'double precision', name: 'media_postest' })
  postestMean: number;

  @Column({ type: 'double precision', name: 'diferencia_medias' })
  meanDifference: number;

  @Column({ type: 'varchar', length: 24, name: 'normalidad_prueba' })
  normalityTest: string;

  @Column({ type: 'double precision', name: 'normalidad_estadistico', nullable: true })
  normalityStatistic: number | null;

  @Column({ type: 'double precision', name: 'normalidad_p_valor', nullable: true })
  normalityPValue: number | null;

  /** True when p > alpha: normality is NOT rejected and the parametric test applies. */
  @Column({ type: 'boolean', name: 'normalidad_normal' })
  normalityNormal: boolean;

  /** Shapiro-Wilk needs at least 3 observations; below that the test is skipped. */
  @Column({ type: 'boolean', name: 'normalidad_aplicable' })
  normalityApplicable: boolean;

  @Column({ type: 'text', name: 'normalidad_nota', nullable: true })
  normalityNote: string | null;

  @Column({ type: 'varchar', length: 24, name: 'prueba_aplicada' })
  testApplied: StatisticalTest;

  @Column({ type: 'double precision', name: 'estadistico' })
  statistic: number;

  @Column({ type: 'double precision', name: 'p_valor' })
  pValue: number;

  @Column({ type: 'varchar', length: 24, name: 'efecto_tipo', nullable: true })
  effectKind: EffectSize['kind'] | null;

  @Column({ type: 'double precision', name: 'efecto_valor', nullable: true })
  effectValue: number | null;

  @Column({ type: 'varchar', length: 16, name: 'efecto_magnitud', nullable: true })
  effectMagnitude: EffectSize['magnitude'] | null;

  @Column({ type: 'boolean', name: 'rechaza_nula' })
  rejectsNull: boolean;

  @Column({ type: 'text', name: 'conclusion' })
  conclusion: string;

  /** The exact matched observations the test consumed. */
  @OneToMany(() => HypothesisPair, (pair) => pair.run, { cascade: ['insert'] })
  pairRows?: HypothesisPair[];

  @Column({ type: 'int', name: 'semilla', default: 42 })
  seed: number;

  @Column({ type: 'varchar', length: 40, name: 'version_funcion' })
  functionVersion: string;

  @Column({ type: 'varchar', length: 64, name: 'hash_entrada' })
  inputHash: string;

  @Column({ type: 'boolean', name: 'incluye_sinteticos', default: false })
  includesSynthetic: boolean;

  @Column({ type: 'uuid', name: 'ejecutada_por', nullable: true })
  executedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'ejecutada_en' })
  executedAt: Date;
}
