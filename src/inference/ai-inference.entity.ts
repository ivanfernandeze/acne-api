import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { GagsGrade, IgaClass } from 'src/common/domain';
import { ClinicalCase } from 'src/cases/case.entity';
import { CaseImage } from 'src/images/case-image.entity';

/**
 * One CNN prediction over one image — the AI side of the digital Anexo 5.
 *
 * Covers: OE2 (RF-OE2-01) and RF-TR-04. `modelVersion`, `weightsChecksum`, `seed` and `latencyMs`
 * are what make the prediction reproducible (RNF-03) and what feed the IIA checklist.
 */
@Entity('ai_inferences')
export class AiInference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'case_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case?: ClinicalCase;

  @Column({ type: 'uuid', name: 'image_id' })
  imageId: string;

  @ManyToOne(() => CaseImage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'image_id' })
  image?: CaseImage;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'running' | 'succeeded' | 'failed';

  @Column({ type: 'varchar', length: 24, name: 'iga_class', nullable: true })
  igaClass: IgaClass | null;

  @Column({ type: 'double precision', nullable: true })
  confidence: number | null;

  /** Full probability vector over the five IGA classes. */
  @Column({ type: 'jsonb', name: 'class_probs', nullable: true })
  classProbs: Record<string, number> | null;

  @Column({ type: 'varchar', length: 24, name: 'gags_grade', nullable: true })
  gagsGrade: GagsGrade | null;

  @Column({ type: 'int', name: 'gags_score', nullable: true })
  gagsScore: number | null;

  /** Storage key of the Grad-CAM overlay produced by the engine (section 8.4). */
  @Column({ type: 'uuid', name: 'heatmap_image_id', nullable: true })
  heatmapImageId: string | null;

  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'varchar', length: 80, name: 'model_version' })
  modelVersion: string;

  @Column({ type: 'varchar', length: 16, name: 'model_backend', default: 'stub' })
  modelBackend: string;

  @Column({ type: 'varchar', length: 64, name: 'weights_checksum', nullable: true })
  weightsChecksum: string | null;

  @Column({ type: 'int', default: 42 })
  seed: number;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
