import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { IgaClass, StudyMode } from 'src/common/domain';
import { ClinicalCase } from 'src/cases/case.entity';
import { User } from 'src/users/user.entity';

/**
 * The specialist's judgement over a case — the human side of the digital Anexo 5.
 *
 * Covers: OE2 (RF-OE2-01, RF-OE2-02). `agreement` records whether this judgement matched the
 * case's `groundTruthIga`; it is computed server-side at submission time and frozen, so the
 * Anexo 5 table is a faithful record of what happened at the moment of the review.
 */
@Entity('diagnoses')
export class Diagnosis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'case_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case?: ClinicalCase;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'study_mode' })
  studyMode: StudyMode;

  /** The clinically binding diagnosis. */
  @Column({ type: 'varchar', length: 24, name: 'iga_class' })
  igaClass: IgaClass;

  @Column({ type: 'int', name: 'gags_score', nullable: true })
  gagsScore: number | null;

  /** `correcto` / `incorrecto` against `cases.ground_truth_iga`; null when there is no reference. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  agreement: 'correcto' | 'incorrecto' | null;

  /** Only meaningful in postest: did the physician keep the CNN's suggestion? */
  @Column({ type: 'boolean', name: 'ai_suggestion_accepted', nullable: true })
  aiSuggestionAccepted: boolean | null;

  @Column({ type: 'uuid', name: 'ai_inference_id', nullable: true })
  aiInferenceId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
