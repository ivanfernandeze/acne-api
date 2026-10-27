import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { CaseStatus, IgaClass, StudyMode } from 'src/common/domain';
import { Patient } from 'src/patients/patient.entity';
import { User } from 'src/users/user.entity';

/**
 * A clinical case — table `casos`: one patient, one set of facial images, one review.
 *
 * Covers: RF-TR-01 (each case carries the experimental condition it was measured under) and
 * RF-TR-03 (`caseCode` is the anonymised handle used everywhere).
 */
@Entity('casos')
export class ClinicalCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Anonymised identifier of the instrument, e.g. `ACN-2026-0001`. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'codigo_caso' })
  caseCode: string;

  @Index()
  @Column({ type: 'uuid', name: 'paciente_id' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paciente_id' })
  patient?: Patient;

  @Index()
  @Column({ type: 'uuid', name: 'usuario_asignado_id', nullable: true })
  assignedUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usuario_asignado_id' })
  assignedUser?: User | null;

  /**
   * The condition under which the case was first REGISTERED — provenance only.
   *
   * It is deliberately NOT the condition of a measurement. The design measures the same 30 cases
   * twice (G: O₁ → X → O₂), so a case is the PAIRING UNIT, not a member of one arm: each case
   * carries one pretest measurement and one postest measurement. The authoritative mode of a
   * measurement lives on `cronometrajes_revision` and `diagnosticos`.
   */
  @Index()
  @Column({ type: 'varchar', length: 20, name: 'modo_estudio_codigo' })
  studyMode: StudyMode;

  /** FK to the `estados_caso` catalogue; transitions are constrained by `transiciones_estado_caso`. */
  @Index()
  @Column({ type: 'varchar', length: 20, name: 'estado_codigo', default: 'borrador' })
  status: CaseStatus;

  /**
   * Consensus reference label (gold standard) for this case.
   *
   * This is the pivot of RF-OE2-05: TPD in pretest compares the physician's manual diagnosis
   * against this label, and TPD in postest compares the CNN's prediction against the very same
   * label. Without a common reference the two conditions would not be comparable.
   */
  @Column({ type: 'varchar', length: 24, name: 'clase_iga_referencia', nullable: true })
  groundTruthIga: IgaClass | null;

  /**
   * True for rows produced by `seed:study`. Excluded by default from exports, indicators and
   * hypothesis contrasts so demo data can never be mistaken for thesis evidence.
   */
  @Index()
  @Column({ type: 'boolean', name: 'es_sintetico', default: false })
  isSynthetic: boolean;

  /** Work session (jornada) this case was reviewed in; feeds NCR for TCAD (OE4). */
  @Index()
  @Column({ type: 'uuid', name: 'jornada_id', nullable: true })
  workSessionId: string | null;

  /**
   * Especialista que TOMÓ el caso, sellado al abrir la ficha.
   *
   * Distinto de `assignedUserId`, que es a quien se le repartió: un caso puede repartirse a uno y
   * acabar revisándolo otro, y OE4 imputa la jornada a quien lo trabajó de verdad.
   */
  @Index()
  @Column({ type: 'uuid', name: 'medico_id', nullable: true })
  physicianId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'medico_id' })
  physician?: User | null;

  /**
   * Por qué el especialista devolvió el caso al mostrador o lo derivó a presencial.
   *
   * Se muestra al técnico en su bandeja: devolver un caso sin decir qué falta obliga a adivinar y
   * garantiza una segunda devolución.
   */
  @Column({ type: 'text', name: 'motivo_devolucion', nullable: true })
  returnReason: string | null;

  @Column({ type: 'text', name: 'notas', nullable: true })
  notes: string | null;

  /**
   * Anulación: el caso tenía evidencia del estudio y no se podía borrar sin destruirla (ver
   * `common/domain/case-removal.ts`). Anulado, sale de la bandeja, los indicadores, los contrastes y
   * las exportaciones; la fila queda para la auditoría.
   */
  @Column({ type: 'timestamptz', name: 'anulado_en', nullable: true })
  voidedAt: Date | null;

  @Column({ type: 'uuid', name: 'anulado_por', nullable: true })
  voidedById: string | null;

  @Column({ type: 'text', name: 'motivo_anulacion', nullable: true })
  voidReason: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', name: 'cerrado_en', nullable: true })
  closedAt: Date | null;
}
