import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { SurveyResponse } from './survey-response.entity';

/**
 * One answer to one of the 8 Likert items — table `detalle_respuestas_encuesta`.
 *
 * Covers: OE3 (RF-OE3-03, per-item reporting). The item wording is NOT stored here: it lives once
 * in `items_encuesta`, referenced by number, so the validated phrasing cannot drift between rows.
 * The score is a foreign key to `escala_likert`, so a 7 on a 1..5 scale is impossible.
 */
@Entity('detalle_respuestas_encuesta')
@Index(['responseId', 'itemNumber'], { unique: true })
export class SurveyAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'respuesta_id' })
  responseId: string;

  @ManyToOne(() => SurveyResponse, (response) => response.answers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'respuesta_id' })
  response?: SurveyResponse;

  /** 1..8, FK to `items_encuesta`. */
  @Column({ type: 'smallint', name: 'item_numero' })
  itemNumber: number;

  /** 1..5, FK to `escala_likert`. */
  @Column({ type: 'smallint', name: 'puntaje' })
  score: number;
}
