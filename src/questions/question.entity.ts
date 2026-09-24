import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { AnamnesisAnswerType, AnamnesisScope, AnamnesisSection } from 'src/common/domain';

/**
 * Una pregunta del cuestionario de ingreso, tal como se PRESENTA.
 *
 * El reparto con `common/domain/anamnesis.ts` es deliberado y conviene tenerlo claro antes de
 * tocar nada:
 *
 *  - El DOMINIO manda sobre la clave, el tipo, el ámbito y las opciones. Son el contrato que valida
 *    las respuestas, y cambiarlos desde una pantalla dejaría huérfanas las anamnesis ya guardadas
 *    o aceptaría valores que el servidor rechaza.
 *  - La TABLA manda sobre la redacción: enunciado, ayuda, prompt del detalle, si es obligatoria y
 *    si sigue activa. Eso es presentación, y la clínica tiene que poder ajustarlo sin desplegar.
 *
 * Hasta la migración del 08/09/2026 la tabla existía y nadie la leía: `GET /meta/catalogs` servía
 * el texto desde la constante de TypeScript, de modo que editarla no cambiaba nada en pantalla.
 */
@Entity('preguntas_anamnesis')
export class AnamnesisQuestionRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** INMUTABLE: es la clave bajo la que se archivan las respuestas. */
  @Column({ type: 'varchar', length: 40, name: 'clave' })
  key: string;

  @Column({ type: 'smallint', name: 'numero' })
  number: number;

  @Column({ type: 'varchar', length: 20, name: 'seccion_codigo' })
  section: AnamnesisSection;

  /** La redacción que ve el paciente. Editable desde el portal. */
  @Column({ type: 'text', name: 'enunciado' })
  text: string;

  @Column({ type: 'varchar', length: 20, name: 'tipo_codigo' })
  type: AnamnesisAnswerType;

  @Column({ type: 'varchar', length: 20, name: 'ambito_codigo' })
  scope: AnamnesisScope;

  @Column({ type: 'varchar', length: 16, name: 'unidad', nullable: true })
  unit: string | null;

  @Column({ type: 'boolean', name: 'obligatoria', default: false })
  required: boolean;

  @Column({ type: 'varchar', length: 160, name: 'prompt_detalle', nullable: true })
  detailPrompt: string | null;

  @Column({ type: 'text', name: 'ayuda', nullable: true })
  hint: string | null;

  /**
   * Copia de las opciones válidas, para pintarlas sin consultar el dominio.
   *
   * La VALIDACIÓN sigue haciéndola `common/domain/anamnesis.ts`: dos copias de una lista cerrada
   * solo pueden discrepar, y la que manda es la que rechaza una respuesta inválida.
   */
  @Column({ type: 'jsonb', name: 'opciones', nullable: true })
  options: string[] | null;

  @Column({ type: 'varchar', length: 16, name: 'version' })
  version: string;

  /**
   * Una pregunta desactivada deja de mostrarse en el ingreso, pero NO desaparece: las anamnesis ya
   * respondidas siguen citándola, y borrarla dejaría respuestas sin enunciado seis meses después.
   */
  @Column({ type: 'boolean', name: 'activa', default: true })
  active: boolean;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizada_en' })
  updatedAt: Date;

  @Column({ type: 'uuid', name: 'actualizada_por', nullable: true })
  updatedBy: string | null;
}
