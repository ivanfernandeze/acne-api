import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Medication } from './medication.entity';

/**
 * Para qué se usa un fármaco, y cómo se pauta en ese uso.
 *
 * La dosis sugerida cuelga de la INDICACIÓN y no del medicamento porque un mismo fármaco no se
 * pauta igual según para qué se receta: la isotretinoína en un acné moderado y en uno conglobata
 * llevan dosis distintas, y guardar una sola en el medicamento obligaría al especialista a
 * corregirla a mano cada vez.
 */
@Entity('indicaciones_medicamento')
export class MedicationIndication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'medicamento_id' })
  medicationId: string;

  @ManyToOne(() => Medication, (medication) => medication.indications, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medicamento_id' })
  medication?: Medication;

  @Column({ type: 'varchar', length: 200, name: 'indicacion' })
  indication: string;

  @Column({ type: 'varchar', length: 120, name: 'dosis_sugerida', nullable: true })
  suggestedDose: string | null;

  @Column({ type: 'varchar', length: 120, name: 'frecuencia_sugerida', nullable: true })
  suggestedFrequency: string | null;

  @Column({ type: 'varchar', length: 120, name: 'duracion_sugerida', nullable: true })
  suggestedDuration: string | null;

  @Column({ type: 'smallint', name: 'orden', default: 0 })
  order: number;
}
