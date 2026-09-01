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
 * A clinical case: one patient, one set of facial images, one review.
 *
 * Covers: RF-TR-01 (each case carries the experimental condition it was measured under) and
 * RF-TR-03 (`caseCode` is the anonymised handle used everywhere).
 */
@Entity('cases')
export class ClinicalCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Anonymised identifier of the instrument, e.g. `ACN-2026-0001`. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'case_code' })
  caseCode: string;

  @Index()
  @Column({ type: 'uuid', name: 'patient_id' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient;

  @Index()
  @Column({ type: 'uuid', name: 'assigned_user_id', nullable: true })
  assignedUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser?: User | null;

  /**
   * The condition under which the case was first REGISTERED — provenance only.
   *
   * It is deliberately NOT the condition of a measurement. The design measures the same 30 cases
   * twice (G: O₁ → X → O₂), so a case is the PAIRING UNIT, not a member of one arm: each case
   * carries one pretest measurement and one postest measurement. The authoritative mode of a
   * measurement lives on `review_timings.study_mode` and `diagnoses.study_mode`.
   */
  @Index()
  @Column({ type: 'varchar', length: 20, name: 'study_mode' })
  studyMode: StudyMode;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: CaseStatus;

  /**
   * Consensus reference label (gold standard) for this case.
   *
   * This is the pivot of RF-OE2-05: TPD in pretest compares the physician's manual diagnosis
   * against this label, and TPD in postest compares the CNN's prediction against the very same
   * label. Without a common reference the two conditions would not be comparable.
   */
  @Column({ type: 'varchar', length: 24, name: 'ground_truth_iga', nullable: true })
  groundTruthIga: IgaClass | null;

  /**
   * True for rows produced by `seed:study`. Excluded by default from exports, indicators and
   * hypothesis contrasts so demo data can never be mistaken for thesis evidence.
   */
  @Index()
  @Column({ type: 'boolean', name: 'is_synthetic', default: false })
  isSynthetic: boolean;

  /** Work session (jornada) this case was reviewed in; feeds NCR for TCAD (OE4). */
  @Index()
  @Column({ type: 'uuid', name: 'work_session_id', nullable: true })
  workSessionId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt: Date | null;
}
