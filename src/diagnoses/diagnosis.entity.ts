import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { Agreement, IgaClass, StudyMode } from 'src/common/domain';
import { ClinicalCase } from 'src/cases/case.entity';
import { User } from 'src/users/user.entity';

/**
 * The specialist's judgement over a case — table `diagnosticos`, the human side of the digital
 * Anexo 5.
 *
 * Covers: OE2 (RF-OE2-01, RF-OE2-02). `agreement` records whether this judgement matched the
 * case's `groundTruthIga`; it is computed server-side at submission time and frozen, so the
 * Anexo 5 table is a faithful record of what happened at the moment of the review rather than a
 * view that shifts if the reference label is later corrected.
 */
@Entity('diagnosticos')
export class Diagnosis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  @Index()
  @Column({ type: 'uuid', name: 'usuario_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id' })
  user?: User;

  @Index()
  @Column({ type: 'varchar', length: 20, name: 'modo_estudio_codigo' })
  studyMode: StudyMode;

  /** The clinically binding diagnosis. FK to `clases_iga`. */
  @Column({ type: 'varchar', length: 24, name: 'clase_iga_codigo' })
  igaClass: IgaClass;

  @Column({ type: 'smallint', name: 'puntaje_gags', nullable: true })
  gagsScore: number | null;

  /** `correcto` / `incorrecto` against `casos.clase_iga_referencia`; null when there is none. */
  @Column({ type: 'varchar', length: 16, name: 'acuerdo', nullable: true })
  agreement: Agreement | null;

  /** Only meaningful in postest: did the physician keep the model's suggestion? */
  @Column({ type: 'boolean', name: 'sugerencia_aceptada', nullable: true })
  aiSuggestionAccepted: boolean | null;

  @Column({ type: 'uuid', name: 'inferencia_id', nullable: true })
  aiInferenceId: string | null;

  /**
   * El diagnóstico redactado, aparte de la clase IGA.
   *
   * La clase IGA sigue siendo obligatoria porque TPD la compara contra el patrón de referencia y un
   * texto libre no es comparable con nada. Esto se agrega ENCIMA, para que la ficha sirva como
   * historia clínica sin dejar de ser medible.
   */
  @Column({ type: 'text', name: 'diagnostico_definitivo', nullable: true })
  definitiveDiagnosis: string | null;

  @Column({ type: 'varchar', length: 10, name: 'cie10_codigo', nullable: true })
  icd10Code: string | null;

  /** Lo que se le dice al paciente; viaja impreso en la receta. */
  @Column({ type: 'text', name: 'observaciones_paciente', nullable: true })
  patientNotes: string | null;

  /** Texto libre que el paciente NUNCA ve. Sin cifrar, igual que `casos.notas`. */
  @Column({ type: 'text', name: 'notas_internas', nullable: true })
  internalNotes: string | null;

  @Column({ type: 'text', name: 'notas', nullable: true })
  notes: string | null;

  /** Clase IGA emitida originalmente; solo se llena si el administrador la corrigió. */
  @Column({ type: 'varchar', length: 24, name: 'clase_iga_original', nullable: true })
  originalIgaClass: IgaClass | null;

  @Column({ type: 'uuid', name: 'corregido_por', nullable: true })
  correctedBy: string | null;

  @Column({ type: 'timestamptz', name: 'corregido_en', nullable: true })
  correctedAt: Date | null;

  @Column({ type: 'text', name: 'motivo_correccion', nullable: true })
  correctionReason: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
