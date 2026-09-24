import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Medication } from './medication.entity';
import { Prescription } from './prescription.entity';

/**
 * Un renglón del tratamiento.
 *
 * El `name` se COPIA del catálogo en vez de leerse a través de la clave foránea. Una receta es un
 * documento emitido en una fecha, y renombrar el medicamento en el catálogo no puede reescribir lo
 * que el paciente ya se llevó impreso. `medicationId` queda solo para trazabilidad, y se pone en
 * nulo si el fármaco se retira: el renglón sigue siendo legible.
 */
@Entity('items_receta')
export class PrescriptionItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'receta_id' })
  prescriptionId: string;

  @ManyToOne(() => Prescription, (prescription) => prescription.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receta_id' })
  prescription?: Prescription;

  @Column({ type: 'uuid', name: 'medicamento_id', nullable: true })
  medicationId: string | null;

  @ManyToOne(() => Medication, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'medicamento_id' })
  medication?: Medication | null;

  @Column({ type: 'varchar', length: 160, name: 'nombre' })
  name: string;

  @Column({ type: 'varchar', length: 120, name: 'dosis' })
  dose: string;

  @Column({ type: 'varchar', length: 120, name: 'frecuencia' })
  frequency: string;

  @Column({ type: 'varchar', length: 120, name: 'duracion' })
  duration: string;

  @Column({ type: 'smallint', name: 'cantidad', default: 1 })
  quantity: number;

  @Column({ type: 'varchar', length: 200, name: 'indicacion', nullable: true })
  indication: string | null;

  @Column({ type: 'smallint', name: 'orden', default: 0 })
  order: number;
}
