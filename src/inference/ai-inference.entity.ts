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

import type {
  AcneVerdict,
  EnsembleAgreement,
  SecondOpinionLabel,
  VerdictSource,
} from './ai-engine.client';
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

  /**
   * `no_acne` when the engine's gate decided the photograph does not show acne and did not grade
   * it — `igaClass`, `confidence` and the GAGS fields then stay null on a SUCCESSFUL row: the model
   * worked, and its answer is that there is nothing to grade.
   */
  @Column({ type: 'varchar', length: 12, name: 'veredicto_codigo', default: 'acne' })
  verdict: AcneVerdict;

  /**
   * Who decided `verdict`: the local gate (`filtro`), or the second opinion (`segunda_opinion`)
   * when it saw another condition in an image the gate had let through as acne.
   */
  @Column({ type: 'varchar', length: 16, name: 'veredicto_origen', default: 'filtro' })
  verdictSource: VerdictSource;

  /** The gate's probability of acne; null when no gate was loaded. */
  @Column({ type: 'double precision', name: 'probabilidad_acne', nullable: true })
  acneProbability: number | null;

  /** Version of the gate that decided the verdict; null when there was none. */
  @Column({ type: 'varchar', length: 120, name: 'version_filtro', nullable: true })
  gateVersion: string | null;

  /**
   * Second opinion taken before grading (an external model). When it saw another condition the view
   * was not graded and `verdictSource` is `segunda_opinion`; otherwise it is a warning the portal
   * shows next to the reading. All four null when it was not consulted.
   */
  @Column({ type: 'varchar', length: 16, name: 'segunda_opinion_codigo', nullable: true })
  secondOpinionLabel: SecondOpinionLabel | null;

  /** Conditions other than acne it named, joined by «; ». Display text, never aggregated. */
  @Column({ type: 'varchar', length: 300, name: 'segunda_opinion_condiciones', nullable: true })
  secondOpinionConditions: string | null;

  @Column({ type: 'varchar', length: 400, name: 'segunda_opinion_explicacion', nullable: true })
  secondOpinionExplanation: string | null;

  @Column({ type: 'varchar', length: 120, name: 'segunda_opinion_version', nullable: true })
  secondOpinionVersion: string | null;

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
