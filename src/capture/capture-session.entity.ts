import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';

/**
 * A phone bound to one case for a short window — table `sesiones_captura`.
 *
 * Closes what section 9.3 of the specification left unspecified: it asks the patient PWA to send
 * photographs "al centro" but never says how a device is tied to a case. The QR carries a one-time
 * token; this row is what it is checked against.
 */
@Entity('sesiones_captura')
export class CaptureSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  /**
   * SHA-256 of the plaintext token. The token itself is NEVER stored: whoever holds a dump of the
   * database still cannot reconstruct a working upload link.
   */
  @Column({ type: 'varchar', length: 64, name: 'hash_token' })
  tokenHash: string;

  /** Who opened the session. Uploads arriving through it are credited to this user. */
  @Column({ type: 'uuid', name: 'creado_por' })
  createdBy: string;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expiresAt: Date;

  @Column({ type: 'int', name: 'max_subidas', default: 8 })
  maxUploads: number;

  @Column({ type: 'int', name: 'subidas', default: 0 })
  uploadCount: number;

  @Column({ type: 'timestamptz', name: 'revocada_en', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'ultimo_uso_en', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
