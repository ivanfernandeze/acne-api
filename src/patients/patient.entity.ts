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
 * Anonymised patient record.
 *
 * Covers: RF-TR-03 (only `patientCode` circulates; the real identity is AES-256-GCM ciphertext
 * that only the treating dermatologist decrypts) and RNF-07 (informed consent, right to withdraw).
 */
@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Anonymised identifier, e.g. `PAC-2026-0001`. Safe to show anywhere. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'patient_code' })
  patientCode: string;

  /** AES-256-GCM ciphertext, base64. Never returned by a list endpoint. */
  @Column({ type: 'text', name: 'encrypted_full_name', nullable: true, select: false })
  encryptedFullName: string | null;

  @Column({ type: 'text', name: 'encrypted_document_id', nullable: true, select: false })
  encryptedDocumentId: string | null;

  @Column({ type: 'date', name: 'birth_date', nullable: true })
  birthDate: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  sex: Sex | null;

  /** Recorded for the fairness audit by phototype described in section 8.2. */
  @Column({ type: 'varchar', length: 4, name: 'fitzpatrick_phototype', nullable: true })
  fitzpatrickPhototype: FitzpatrickType | null;

  @Column({ type: 'timestamptz', name: 'consent_accepted_at', nullable: true })
  consentAcceptedAt: Date | null;

  /** RNF-07: right to withdraw. Withdrawn patients are excluded from every study dataset. */
  @Column({ type: 'timestamptz', name: 'withdrawn_at', nullable: true })
  withdrawnAt: Date | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
