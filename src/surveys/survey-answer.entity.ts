import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { SurveyResponse } from './survey-response.entity';

/**
 * One answer to one of the 8 Likert items of Anexo 6.
 *
 * Covers: OE3 (RF-OE3-03 — per-item reporting). The item text itself is NOT stored here: it lives
 * once in `common/domain/survey.ts`, so the validated wording cannot drift between rows.
 */
@Entity('survey_answers')
@Index(['responseId', 'itemNumber'], { unique: true })
export class SurveyAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'response_id' })
  responseId: string;

  @ManyToOne(() => SurveyResponse, (response) => response.answers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'response_id' })
  response?: SurveyResponse;

  /** 1..8, matching `LIKERT_ITEMS`. */
  @Column({ type: 'int', name: 'item_number' })
  itemNumber: number;

  /** 1..5 on the scale "Muy bajo" .. "Muy alto". */
  @Column({ type: 'int' })
  score: number;
}
