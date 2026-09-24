import { Column, Entity, JoinColumn, OneToMany, OneToOne, PrimaryColumn } from 'typeorm';

import { AiInference } from './ai-inference.entity';
import { AssessmentDetail } from './assessment-detail.entity';

/**
 * The reasoned clinical reading behind a grade — table `valoraciones_inferencia`, 1:1 with the
 * inference it justifies.
 *
 * WHY IT EXISTS: a class plus a probability vector tells the physician *what* the model concluded
 * and nothing about *why*. A suggestion that cannot be inspected can only be trusted or ignored,
 * and neither is clinical judgement.
 *
 * WHAT IT IS NOT: a diagnosis. The record's diagnosis is the one the specialist signs in
 * `diagnosticos`, and OE2 measures that against `casos.clase_iga_referencia`. Nothing here enters
 * an indicator or a hypothesis contrast.
 */
@Entity('valoraciones_inferencia')
export class InferenceAssessment {
  @PrimaryColumn({ type: 'uuid', name: 'inferencia_id' })
  inferenceId: string;

  @OneToOne(() => AiInference, (inference) => inference.assessmentRow, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inferencia_id' })
  inference?: AiInference;

  /** The reading in prose, as a dermatologist would dictate it. */
  @Column({ type: 'text', name: 'resumen' })
  summary: string;

  /** Why that IGA class and not the neighbouring one. The ordinal scale lives or dies here. */
  @Column({ type: 'text', name: 'fundamento_severidad' })
  severityRationale: string;

  @OneToMany(() => AssessmentDetail, (detail) => detail.assessment)
  details?: AssessmentDetail[];
}
