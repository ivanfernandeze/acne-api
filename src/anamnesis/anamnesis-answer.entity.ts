import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { CaseAnamnesis } from './case-anamnesis.entity';

/**
 * One answer to one anamnesis question — table `respuestas_anamnesis`.
 *
 * WHY THREE VALUE COLUMNS. The 21 questions answer in four shapes: yes/no, free text, a number and
 * a choice. A single `text` column would store `"true"` and `"72"` as strings, which throws away
 * the type the catalogue declares and makes "average weight" a cast away from failing on the first
 * malformed row. One typed column per shape, plus a CHECK that at most one is filled, keeps the
 * type in the database where it can be trusted. Choices carry no value here at all: they are rows
 * of `respuestas_anamnesis_opcion`, so an option the question never offered cannot be stored.
 */
@Entity('respuestas_anamnesis')
export class AnamnesisAnswerRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'anamnesis_id' })
  anamnesisId: string;

  @ManyToOne(() => CaseAnamnesis, (anamnesis) => anamnesis.answerRows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anamnesis_id' })
  anamnesis?: CaseAnamnesis;

  /** FK to `preguntas_anamnesis`. Resolved from the catalogue key by the service. */
  @Index()
  @Column({ type: 'uuid', name: 'pregunta_id' })
  questionId: string;

  @Column({ type: 'boolean', name: 'valor_booleano', nullable: true })
  booleanValue: boolean | null;

  @Column({ type: 'text', name: 'valor_texto', nullable: true })
  textValue: string | null;

  @Column({ type: 'double precision', name: 'valor_numerico', nullable: true })
  numericValue: number | null;

  /**
   * Free-text follow-up ("¿cuál?", "¿por cuánto tiempo?"). UNENCRYPTED, like `casos.notas`: the UI
   * warns against writing names or documents into it (Ley N.º 29733).
   */
  @Column({ type: 'varchar', length: 500, name: 'detalle', nullable: true })
  detail: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'respondida_en' })
  answeredAt: Date;
}
