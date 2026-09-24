import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { MedicationIndication } from './medication-indication.entity';

/**
 * El vademécum del que el especialista arma una receta.
 *
 * `active` es una lápida, no un borrado: un fármaco retirado deja de ofrecerse en el buscador, pero
 * las recetas que ya lo citan siguen siendo legibles — el paciente se llevó una de ellas impresa.
 */
@Entity('medicamentos')
export class Medication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160, name: 'nombre' })
  name: string;

  @Column({ type: 'varchar', length: 160, name: 'principio_activo', nullable: true })
  activeIngredient: string | null;

  @Column({ type: 'text', name: 'descripcion', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', name: 'activo', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @OneToMany(() => MedicationIndication, (indication) => indication.medication)
  indications?: MedicationIndication[];
}
