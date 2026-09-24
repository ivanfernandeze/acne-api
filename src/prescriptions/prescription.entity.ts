import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';
import type { PrescriptionStatus } from 'src/common/domain';
import { Diagnosis } from 'src/diagnoses/diagnosis.entity';
import { Patient } from 'src/patients/patient.entity';
import { User } from 'src/users/user.entity';

import { PrescriptionItem } from './prescription-item.entity';

/**
 * La prescripción que cierra la consulta.
 *
 * Cuelga del DIAGNÓSTICO que la justifica y no solo del caso: el mismo caso se diagnostica dos
 * veces —una en pretest y otra en postest— y una receta emitida tras leer la sugerencia del modelo
 * es un documento con un fundamento distinto al de la emitida sin ella. Perder ese vínculo haría
 * imposible decir cuál de las dos lecturas motivó el tratamiento.
 *
 * NO participa de ningún indicador: TRM se detiene al enviar el diagnóstico y TCAD cuenta casos
 * revisados. Existe porque la consulta lo exige, no porque la medición lo pida.
 */
@Entity('recetas')
export class Prescription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Identificador anonimizado del documento, por ejemplo REC-2026-0001. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'codigo_receta' })
  prescriptionCode: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  /** La medición que la fundamenta. Nulo solo si el diagnóstico se borró después. */
  @Column({ type: 'uuid', name: 'diagnostico_id', nullable: true })
  diagnosisId: string | null;

  @ManyToOne(() => Diagnosis, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'diagnostico_id' })
  diagnosis?: Diagnosis | null;

  @Index()
  @Column({ type: 'uuid', name: 'paciente_id' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paciente_id' })
  patient?: Patient;

  @Column({ type: 'uuid', name: 'medico_id' })
  physicianId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'medico_id' })
  physician?: User;

  /** Indicaciones generales del tratamiento, aparte de las de cada renglón. */
  @Column({ type: 'text', name: 'indicaciones', nullable: true })
  instructions: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'estado_codigo', default: 'generada' })
  status: PrescriptionStatus;

  @Column({ type: 'varchar', length: 255, name: 'ruta_pdf', nullable: true })
  pdfPath: string | null;

  /**
   * SHA-256 del contenido más el identificador del médico.
   *
   * NO es una firma electrónica reconocida legalmente: detecta que un PDF descargado no coincide
   * con lo registrado, y nada más. Declarado así en TRACEABILITY.md.
   */
  @Column({ type: 'varchar', length: 128, name: 'firma_digital', nullable: true })
  digitalSignature: string | null;

  @Column({ type: 'timestamptz', name: 'firmado_en', nullable: true })
  signedAt: Date | null;

  @Index()
  @Column({ type: 'boolean', name: 'es_sintetico', default: false })
  isSynthetic: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @OneToMany(() => PrescriptionItem, (item) => item.prescription)
  items?: PrescriptionItem[];
}
