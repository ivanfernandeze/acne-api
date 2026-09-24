import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { DeliveryChannel } from 'src/common/domain';

import { Prescription } from './prescription.entity';

/**
 * Bitácora append-only de cada entrega de una receta al paciente.
 *
 * `simulated` en `true` es el estado NORMAL del prototipo: no hay pasarela de WhatsApp contratada
 * ni servidor de correo saliente. El envío se registra y la pantalla lo dice con todas las letras.
 * Presentar un envío inexistente como realizado sería falsear la evidencia, y el sustentante
 * tendría que defender en la exposición algo que el sistema nunca hizo.
 */
@Entity('envios_receta')
export class PrescriptionDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'receta_id' })
  prescriptionId: string;

  @ManyToOne(() => Prescription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receta_id' })
  prescription?: Prescription;

  @Column({ type: 'varchar', length: 20, name: 'canal_codigo' })
  channel: DeliveryChannel;

  /**
   * Teléfono o correo al que se envió.
   *
   * Es un dato identificador del paciente (RF-TR-03), de modo que solo lo devuelven las rutas a los
   * roles con `ver_identidad_paciente` y cada lectura queda en la traza.
   */
  @Column({ type: 'varchar', length: 120, name: 'destino' })
  destination: string;

  @Column({ type: 'boolean', name: 'simulado', default: true })
  simulated: boolean;

  @Column({ type: 'boolean', name: 'exitoso', default: true })
  successful: boolean;

  @Column({ type: 'text', name: 'detalle', nullable: true })
  detail: string | null;

  @Column({ type: 'uuid', name: 'enviado_por', nullable: true })
  sentBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'enviado_en' })
  sentAt: Date;
}
