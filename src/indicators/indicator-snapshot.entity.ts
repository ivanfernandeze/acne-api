import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { IndicatorKey, StudyMode } from 'src/common/domain';

import { IndicatorObservation } from './indicator-observation.entity';

/**
 * Immutable record of one indicator computation — table `instantaneas_indicador`.
 *
 * Covers: RNF-05 — "Todo cálculo de indicador genera un log inmutable con: input, semilla,
 * versión de la función estadística, resultado, timestamp". Rows are INSERT-only: the application
 * exposes no UPDATE or DELETE path, so an external evaluator can trust that a reported figure was
 * never retro-edited.
 *
 * The eight descriptive statistics were a `jsonb` map and are now columns. They are a fixed, known
 * set, and as columns they sort, compare across snapshots and chart without expanding JSON.
 */
@Entity('instantaneas_indicador')
export class IndicatorSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 8, name: 'indicador_codigo' })
  indicator: IndicatorKey;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'modo_estudio_codigo' })
  studyMode: StudyMode;

  /** `global`, or a user id when the indicator was computed for a single professional. */
  @Column({ type: 'varchar', length: 64, name: 'alcance', default: 'global' })
  scope: string;

  @Column({ type: 'double precision', name: 'valor' })
  value: number;

  @Column({ type: 'varchar', length: 16, name: 'unidad' })
  unit: string;

  @Column({ type: 'int', name: 'n' })
  n: number;

  @Column({ type: 'double precision', name: 'media' })
  mean: number;

  @Column({ type: 'double precision', name: 'desviacion_estandar' })
  sd: number;

  @Column({ type: 'double precision', name: 'minimo' })
  min: number;

  @Column({ type: 'double precision', name: 'q1' })
  q1: number;

  @Column({ type: 'double precision', name: 'mediana' })
  median: number;

  @Column({ type: 'double precision', name: 'q3' })
  q3: number;

  @Column({ type: 'double precision', name: 'maximo' })
  max: number;

  /** The individual observations behind `value`, kept for the boxplots and for re-analysis. */
  @OneToMany(() => IndicatorObservation, (observation) => observation.snapshot, {
    cascade: ['insert'],
  })
  observationRows?: IndicatorObservation[];

  /** SHA-256 of the ordered input rows (RNF-05). */
  @Column({ type: 'varchar', length: 64, name: 'hash_entrada' })
  inputHash: string;

  @Column({ type: 'varchar', length: 40, name: 'version_funcion' })
  functionVersion: string;

  @Column({ type: 'boolean', name: 'incluye_sinteticos', default: false })
  includesSynthetic: boolean;

  @Column({ type: 'uuid', name: 'calculada_por', nullable: true })
  computedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'calculada_en' })
  computedAt: Date;
}
