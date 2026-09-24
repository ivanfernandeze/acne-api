import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import type { IgaClass } from 'src/common/domain';

import { AiInference } from './ai-inference.entity';

/**
 * One model's vote inside an ensemble inference — table `miembros_inferencia`.
 *
 * The header row (`inferencias_ia`) keeps the combined recommendation; each member keeps its own
 * class, confidence, probability vector, Grad-CAM and identity (version + checksum), so the
 * physician can see every vote and the audit can say which weights produced it. `peso` is the
 * member's F1 macro on the frozen test split, the coefficient of the soft vote (section 8.1,
 * revision 17/09/2026).
 *
 * The probability vector is `jsonb` rather than one row per class as in
 * `probabilidades_inferencia`: it is displayed, never aggregated — the analysis of OE2 works on the
 * combined vector of the header.
 */
@Entity('miembros_inferencia')
export class InferenceMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'inferencia_id' })
  inferenceId: string;

  @ManyToOne(() => AiInference, (inference) => inference.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inferencia_id' })
  inference?: AiInference;

  /** Order in the ensemble, as configured in the engine. */
  @Column({ type: 'smallint', name: 'orden' })
  position: number;

  @Column({ type: 'varchar', length: 40, name: 'etiqueta' })
  tag: string;

  @Column({ type: 'varchar', length: 40, name: 'nombre_modelo' })
  modelName: string;

  @Column({ type: 'varchar', length: 80, name: 'version_modelo' })
  modelVersion: string;

  @Column({ type: 'varchar', length: 64, name: 'checksum_pesos' })
  weightsChecksum: string;

  @Column({ type: 'double precision', name: 'peso' })
  weight: number;

  @Column({ type: 'varchar', length: 24, name: 'clase_iga_codigo' })
  igaClass: IgaClass;

  @Column({ type: 'double precision', name: 'confianza' })
  confidence: number;

  @Column({ type: 'jsonb', name: 'probabilidades' })
  classProbs: Record<string, number>;

  @Column({ type: 'uuid', name: 'imagen_mapa_calor', nullable: true })
  heatmapImageId: string | null;

  @Column({ type: 'int', name: 'latencia_ms' })
  latencyMs: number;
}
