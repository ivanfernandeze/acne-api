import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { FitzpatrickType, Sex } from 'src/common/domain';

/**
 * Anonymised patient record — table `pacientes`.
 *
 * Covers: RF-TR-03 (only `patientCode` circulates; the real identity is AES-256-GCM ciphertext
 * that only authorised staff decrypt) and RNF-07 (informed consent, right to withdraw).
 */
@Entity('pacientes')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Anonymised identifier, e.g. `PAC-2026-0001`. Safe to show anywhere. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'codigo_paciente' })
  patientCode: string;

  /** AES-256-GCM ciphertext, base64. Never returned by a list endpoint. */
  @Column({ type: 'text', name: 'nombre_completo_cifrado', nullable: true, select: false })
  encryptedFullName: string | null;

  @Column({ type: 'text', name: 'documento_cifrado', nullable: true, select: false })
  encryptedDocumentId: string | null;

  /**
   * Teléfono de contacto, cifrado como el resto de la identidad.
   *
   * Existe para hacerle llegar la receta. En claro convertiría la tabla en un directorio telefónico
   * de pacientes dermatológicos, que es justo lo que RF-TR-03 impide; solo se descifra al enviar, y
   * ese descifrado queda en la traza.
   */
  /**
   * Contacto, cifrado como el nombre y el documento.
   *
   * Un teléfono identifica a una persona tan bien como su nombre (Ley N.º 29733), de modo que
   * guardarlo en claro habría abierto por la puerta de atrás justo lo que RF-TR-03 cierra por la
   * principal. `select: false` obliga a pedirlo explícitamente: nunca viaja en un listado.
   */
  @Column({ type: 'text', name: 'telefono_cifrado', nullable: true, select: false })
  encryptedPhone: string | null;

  @Column({ type: 'text', name: 'correo_cifrado', nullable: true, select: false })
  encryptedEmail: string | null;

  @Column({ type: 'date', name: 'fecha_nacimiento', nullable: true })
  birthDate: string | null;

  /** FK to the `sexos` catalogue. */
  @Column({ type: 'varchar', length: 16, name: 'sexo_codigo', nullable: true })
  sex: Sex | null;

  /** FK to `fototipos_fitzpatrick`. Recorded for the fairness audit of section 8.2. */
  @Column({ type: 'varchar', length: 4, name: 'fototipo_codigo', nullable: true })
  fitzpatrickPhototype: FitzpatrickType | null;

  @Column({ type: 'timestamptz', name: 'consentimiento_en', nullable: true })
  consentAcceptedAt: Date | null;

  /** RNF-07: right to withdraw. Withdrawn patients are excluded from every study dataset. */
  @Column({ type: 'timestamptz', name: 'retirado_en', nullable: true })
  withdrawnAt: Date | null;

  @Column({ type: 'uuid', name: 'creado_por', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  updatedAt: Date;
}
