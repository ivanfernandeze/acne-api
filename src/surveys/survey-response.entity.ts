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
 * One completed Likert questionnaire — table `respuestas_encuesta`, the digital Anexo 6.
 *
 * Covers: OE3 (RF-OE3-01, RF-OE3-03). `pointsObtained` (PO) and `totalPoints` (PT) are frozen at
 * submission so TSP = (PO / PT) × 100 can be recomputed identically months later (RNF-03).
 */
@Entity('respuestas_encuesta')
export class SurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'usuario_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'modo_estudio_codigo' })
  studyMode: StudyMode;

  /** PO — sum of the 8 item scores. */
  @Column({ type: 'smallint', name: 'puntos_obtenidos' })
  pointsObtained: number;

  /** PT — maximum attainable score (8 items × 5 = 40). */
  @Column({ type: 'smallint', name: 'puntos_totales' })
  totalPoints: number;

  /** TSP for this respondent, in %. */
  @Column({ type: 'double precision', name: 'tsp_pct' })
  tspPct: number;

  @Column({ type: 'double precision', name: 'promedio_likert' })
  meanLikert: number;

  /** Postest cases the respondent had completed when the survey fired (RF-OE3-02). */
  @Column({ type: 'int', name: 'casos_postest_al_enviar', default: 0 })
  postestCasesAtSubmission: number;

  @Column({ type: 'boolean', name: 'es_sintetico', default: false })
  isSynthetic: boolean;

  @Column({ type: 'text', name: 'comentarios', nullable: true })
  comments: string | null;

  @OneToMany(() => SurveyAnswer, (answer) => answer.response, { cascade: ['insert'] })
  answers?: SurveyAnswer[];

  @CreateDateColumn({ type: 'timestamptz', name: 'enviada_en' })
  submittedAt: Date;
}
