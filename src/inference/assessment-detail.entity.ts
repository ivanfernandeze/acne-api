import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InferenceAssessment } from './inference-assessment.entity';

/** The five enumerated blocks of a clinical reading. FK to `tipos_detalle_valoracion`. */
export const ASSESSMENT_DETAIL_TYPES = [
  'lesion',
  'zona',
  'diferencial',
  'consideracion',
  'bandera_anamnesis',
] as const;
export type AssessmentDetailType = (typeof ASSESSMENT_DETAIL_TYPES)[number];

/**
 * One item of one of the reading's five lists — table `detalles_valoracion`.
 *
 * They were five JSON arrays inside a single column. Counting how often the model named rosácea as
 * a differential requires grouping, and an array does not group; `orden` preserves the sequence the
 * model produced, which a set would lose.
 */
@Entity('detalles_valoracion')
export class AssessmentDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'inferencia_id' })
  inferenceId: string;

  @ManyToOne(() => InferenceAssessment, (assessment) => assessment.details, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'inferencia_id' })
  assessment?: InferenceAssessment;

  @Column({ type: 'varchar', length: 24, name: 'tipo_codigo' })
  type: AssessmentDetailType;

  @Column({ type: 'smallint', name: 'orden' })
  position: number;

  @Column({ type: 'text', name: 'texto' })
  text: string;
}
