import { Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * An option ticked on a choice answer — table `respuestas_anamnesis_opcion`.
 *
 * One row for `opcion_unica`, several for `opcion_multiple`. The foreign key against
 * `opciones_pregunta` makes it structurally impossible to store an option the question does not
 * offer; before this the catalogue lived only in TypeScript and an invalid value was caught, at
 * best, by the application layer.
 *
 * The literal the option stands for is NOT duplicated here — it lives once in `opciones_pregunta`,
 * and `AnamnesisService` resolves ids to literals when it rebuilds the answer map.
 */
@Entity('respuestas_anamnesis_opcion')
export class AnamnesisAnswerOption {
  @PrimaryColumn({ type: 'uuid', name: 'respuesta_id' })
  answerId: string;

  @Index()
  @PrimaryColumn({ type: 'uuid', name: 'opcion_id' })
  optionId: string;
}
