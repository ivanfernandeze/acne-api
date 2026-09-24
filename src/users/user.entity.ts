import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { UserRole } from 'src/common/domain';

/**
 * Clinical staff and study personnel — table `usuarios`.
 *
 * Covers: RF-TR-02 (JWT + roles) and RF-TR-01 (`studyMode` is the per-user switch of the
 * independent variable; a dermatologist in `pretest` cannot reach the AI at all).
 *
 * The property names stay English and the column names are Spanish: the database is a thesis
 * deliverable read by an examiner, the code is read by whoever maintains it, and `@Column({ name })`
 * is exactly the seam that lets each be written for its own audience.
 */
@Entity('usuarios')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 180, name: 'correo' })
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'hash_contrasena', select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 160, name: 'nombre_completo' })
  fullName: string;

  /** FK to the `roles` catalogue. */
  @Column({ type: 'varchar', length: 24, name: 'rol_codigo' })
  role: UserRole;

  @Column({ type: 'varchar', length: 120, name: 'especialidad', nullable: true })
  specialty: string | null;

  /**
   * Teléfono de contacto, cifrado en reposo igual que el del paciente.
   *
   * Un directorio del personal en claro es lo que la Ley N.º 29733 pide no dejar por ahí: el
   * número de un profesional identifica a una persona exactamente igual que el de un paciente.
   */
  @Column({ type: 'text', name: 'telefono_cifrado', nullable: true })
  encryptedPhone: string | null;

  @Column({ type: 'boolean', name: 'activo', default: true })
  active: boolean;

  /**
   * True for the professionals `seed:study` invents to populate the demonstration census.
   *
   * The synthetic cases have carried this flag since the beginning; the accounts they were assigned
   * to did not, so the staff count of the study included four people who do not exist. Indicators
   * per professional and dataset exports exclude them under the same `includeSynthetic` rule.
   */
  @Column({ type: 'boolean', name: 'es_sintetico', default: false })
  isSynthetic: boolean;

  /** RNF-07: informed consent of the medical staff participating in the study. */
  @Column({ type: 'timestamptz', name: 'consentimiento_en', nullable: true })
  consentAcceptedAt: Date | null;

  /**
   * Imagen de la firma que se estampa en cada receta que emite.
   *
   * NO es una firma electrónica reconocida legalmente (D.L. 1075): es la rúbrica que el paciente
   * espera ver en su receta. Lo que detecta una receta alterada es el SHA-256 de `recetas`, no
   * esto, y así se declara en TRACEABILITY.md.
   */
  @Column({ type: 'varchar', length: 255, name: 'firma_ruta', nullable: true })
  signaturePath: string | null;

  @Column({ type: 'timestamptz', name: 'firma_actualizada_en', nullable: true })
  signatureUpdatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  updatedAt: Date;
}
