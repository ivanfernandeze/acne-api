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
 * A clinical facial image attached to a case.
 *
 * Covers: RNF-02. The bytes are AES-256-GCM ciphertext in the storage backend; `sha256` is the
 * digest of the PLAINTEXT, so integrity can be verified after decryption.
 */
@Entity('case_images')
export class CaseImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'case_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case?: ClinicalCase;

  /** Object key inside the storage backend (local disk or MinIO bucket). */
  @Column({ type: 'varchar', length: 255, name: 'storage_key' })
  storageKey: string;

  @Column({ type: 'varchar', length: 16, name: 'storage_driver' })
  storageDriver: string;

  @Column({ type: 'varchar', length: 80, name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  /** Size of the plaintext image, in bytes. */
  @Column({ type: 'bigint', name: 'size_bytes' })
  sizeBytes: string;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'boolean', default: true })
  encrypted: boolean;

  /** True for Grad-CAM overlays produced by the engine (section 8.4). */
  @Column({ type: 'boolean', name: 'is_heatmap', default: false })
  isHeatmap: boolean;

  @Column({ type: 'uuid', name: 'uploaded_by', nullable: true })
  uploadedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
