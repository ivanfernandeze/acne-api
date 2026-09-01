import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { StudyMode } from 'src/common/domain';
import { User } from 'src/users/user.entity';

import { SurveyAnswer } from './survey-answer.entity';

/**
 * One completed Likert questionnaire — the digital Anexo 6.
 *
 * Covers: OE3 (RF-OE3-01, RF-OE3-03). `pointsObtained` (PO) and `totalPoints` (PT) are frozen at
 * submission so TSP = (PO / PT) x 100 can be recomputed identically months later (RNF-03).
 */
@Entity('survey_responses')
export class SurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'study_mode' })
  studyMode: StudyMode;

  /** PO — sum of the 8 item scores. */
  @Column({ type: 'int', name: 'points_obtained' })
  pointsObtained: number;

  /** PT — maximum attainable score (8 items x 5 = 40). */
  @Column({ type: 'int', name: 'total_points' })
  totalPoints: number;

  /** TSP for this respondent, in %. */
  @Column({ type: 'double precision', name: 'tsp_pct' })
  tspPct: number;

  @Column({ type: 'double precision', name: 'mean_likert' })
  meanLikert: number;

  /** Number of postest cases the respondent had completed when the survey fired (RF-OE3-02). */
  @Column({ type: 'int', name: 'postest_cases_at_submission', default: 0 })
  postestCasesAtSubmission: number;

  @Column({ type: 'boolean', name: 'is_synthetic', default: false })
  isSynthetic: boolean;

  @Column({ type: 'text', nullable: true })
  comments: string | null;

  @OneToMany(() => SurveyAnswer, (answer) => answer.response, { cascade: ['insert'] })
  answers?: SurveyAnswer[];

  @CreateDateColumn({ type: 'timestamptz', name: 'submitted_at' })
  submittedAt: Date;
}
