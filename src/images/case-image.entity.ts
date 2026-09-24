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
import type { ShotKey } from 'src/common/domain';

/**
 * A clinical facial image attached to a case — table `imagenes_caso`.
 *
 * Covers: RNF-02. The bytes are AES-256-GCM ciphertext in the storage backend; `sha256` is the
 * digest of the PLAINTEXT, so integrity can be verified after decryption.
 */
@Entity('imagenes_caso')
export class CaseImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', name: 'caso_id' })
  caseId: string;

  @ManyToOne(() => ClinicalCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caso_id' })
  case?: ClinicalCase;

  /** Object key inside the storage backend (local disk or MinIO bucket). */
  @Column({ type: 'varchar', length: 255, name: 'clave_almacen' })
  storageKey: string;

  @Column({ type: 'varchar', length: 16, name: 'driver_almacen' })
  storageDriver: string;

  @Column({ type: 'varchar', length: 80, name: 'tipo_mime' })
  mimeType: string;

  @Column({ type: 'int', name: 'ancho', nullable: true })
  width: number | null;

  @Column({ type: 'int', name: 'alto', nullable: true })
  height: number | null;

  /** Size of the plaintext image, in bytes. */
  @Column({ type: 'bigint', name: 'tamano_bytes' })
  sizeBytes: string;

  @Column({ type: 'varchar', length: 64, name: 'sha256' })
  sha256: string;

  @Column({ type: 'boolean', name: 'cifrada', default: true })
  encrypted: boolean;

  /** True for Grad-CAM overlays produced by the engine (section 8.4). */
  @Column({ type: 'boolean', name: 'es_mapa_calor', default: false })
  isHeatmap: boolean;

  @Column({ type: 'uuid', name: 'subida_por', nullable: true })
  uploadedBy: string | null;

  /**
   * Which shot of the photographic protocol this image is — FK to `tomas_fotograficas`.
   *
   * Null for the seeder's synthetic images, which did not follow the protocol; claiming otherwise
   * would misdescribe the record.
   */
  @Column({ type: 'varchar', length: 24, name: 'toma_codigo', nullable: true })
  shotKey: ShotKey | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  createdAt: Date;
}
