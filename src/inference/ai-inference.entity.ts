import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { GagsGrade, IgaClass, ProcessStatus } from 'src/common/domain';

import type { EnsembleAgreement } from './ai-engine.client';
import { ClinicalCase } from 'src/cases/case.entity';
import { CaseImage } from 'src/images/case-image.entity';

import { InferenceAssessment } from './inference-assessment.entity';
import { InferenceMember } from './inference-member.entity';
import { InferenceProbability } from './inference-probability.entity';

/**
 * One model prediction over one image — table `inferencias_ia`, the AI side of the digital Anexo 5.
 *
 * Covers: OE2 (RF-OE2-01) and RF-TR-04. `modelVersion`, `weightsChecksum`, `seed` and `latencyMs`
 * are what make the prediction reproducible (RNF-03) and what feed the IIA checklist.
 *
 * The probability vector and the reasoned reading used to be `jsonb` columns on this row and are
 * now child tables. The probabilities repeated the IGA catalogue as JSON keys inside every row, so
 * a confusion matrix meant expanding JSON; they are now five rows a `GROUP BY` can reach.
 */
@Entity('inferencias_ia')
export class AiInference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  @Column({ type: 'uuid', name: 'imagen_id' })
  imageId: string;

  @ManyToOne(() => CaseImage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'imagen_id' })
  image?: CaseImage;

  /** FK to the `estados_proceso` catalogue, shared with the queue job that produced this row. */
  @Index()
  @Column({ type: 'varchar', length: 20, name: 'estado_codigo', default: 'pendiente' })
  status: ProcessStatus;

  @Column({ type: 'varchar', length: 24, name: 'clase_iga_codigo', nullable: true })
  igaClass: IgaClass | null;

  @Column({ type: 'double precision', name: 'confianza', nullable: true })
  confidence: number | null;

  /** Full probability vector over the five IGA classes, one row per class. */
  @OneToMany(() => InferenceProbability, (probability) => probability.inference)
  probabilities?: InferenceProbability[];

  @Column({ type: 'varchar', length: 24, name: 'grado_gags_codigo', nullable: true })
  gagsGrade: GagsGrade | null;

  @Column({ type: 'smallint', name: 'puntaje_gags', nullable: true })
  gagsScore: number | null;

  /** Grad-CAM overlay produced by the engine (section 8.4). */
  @Column({ type: 'uuid', name: 'imagen_mapa_calor', nullable: true })
  heatmapImageId: string | null;

  @Column({ type: 'int', name: 'latencia_ms', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'varchar', length: 200, name: 'version_modelo' })
  modelVersion: string;

  /** How far the ensemble members agreed; null when a single model served. */
  @Column({ type: 'varchar', length: 16, name: 'acuerdo_codigo', nullable: true })
  agreement: EnsembleAgreement | null;

  /** One row per model when the engine served an ensemble. */
  @OneToMany(() => InferenceMember, (member) => member.inference)
  members?: InferenceMember[];

  @Column({ type: 'varchar', length: 16, name: 'backend_modelo', default: 'stub' })
  modelBackend: string;

  @Column({ type: 'varchar', length: 64, name: 'checksum_pesos', nullable: true })
  weightsChecksum: string | null;

  @Column({ type: 'int', name: 'semilla', default: 42 })
  seed: number;

  /**
   * The reasoned reading behind the grade. Absent for an image-only backend, which is the honest
   * state: a CNN emits five numbers and cannot justify them in prose.
   */
  @OneToOne(() => InferenceAssessment, (assessment) => assessment.inference)
  assessmentRow?: InferenceAssessment | null;

  @Column({ type: 'text', name: 'mensaje_error', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
