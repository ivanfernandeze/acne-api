import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { SignedUrlService } from 'src/common/crypto/signed-url.service';
import { readImageDimensions } from 'src/common/utils/image-dimensions';
import { STORAGE_PROVIDER, type StorageProvider } from 'src/storage/storage.provider';

import { CaseImage } from './case-image.entity';
import { CaseImageDto } from './dto/image.dto';

export type { CaseImageDto };

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/**
 * Clinical image handling.
 *
 * Covers: RNF-02. Every byte is AES-256-GCM encrypted BEFORE it reaches the storage backend, and
 * is only ever served back through a signed, time-limited, audited endpoint.
 */
@Injectable()
export class ImagesService {
  constructor(
    @InjectRepository(CaseImage) private readonly repository: Repository<CaseImage>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly encryption: EncryptionService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  async upload(caseId: string, file: UploadedImage, userId: string): Promise<CaseImage> {
    this.validate(file);
    return this.store(caseId, file.buffer, file.mimetype, userId, false);
  }

  /** Persists a Grad-CAM overlay produced by the engine (section 8.4). */
  async storeHeatmap(caseId: string, data: Buffer, mimeType: string): Promise<CaseImage> {
    return this.store(caseId, data, mimeType, null, true);
  }

  private async store(
    caseId: string,
    plaintext: Buffer,
    mimeType: string,
    userId: string | null,
    isHeatmap: boolean,
  ): Promise<CaseImage> {
    const dimensions = readImageDimensions(plaintext);
    // The digest is of the PLAINTEXT, so integrity can be checked after decryption.
    const sha256 = this.encryption.sha256(plaintext);
    const key = `${isHeatmap ? 'heatmaps' : 'cases'}/${caseId}/${randomUUID()}.enc`;

    await this.storage.put(key, this.encryption.encryptBuffer(plaintext), 'application/octet-stream');

    const image = this.repository.create({
      caseId,
      storageKey: key,
      storageDriver: this.storage.driver,
      mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      sizeBytes: String(plaintext.length),
      sha256,
      encrypted: true,
      isHeatmap,
      uploadedBy: userId,
    });
    return this.repository.save(image);
  }

  async findById(id: string): Promise<CaseImage> {
    const image = await this.repository.findOne({ where: { id } });
    if (image === null) throw new NotFoundException(`No existe la imagen ${id}.`);
    return image;
  }

  async findByCase(caseId: string, includeHeatmaps = false): Promise<CaseImage[]> {
    const where = includeHeatmaps ? { caseId } : { caseId, isHeatmap: false };
    return this.repository.find({ where, order: { createdAt: 'ASC' } });
  }

  /**
   * Verifies the signed token, decrypts and returns the plaintext bytes.
   * The caller is responsible for writing the audit entry (RNF-02).
   */
  async readContent(imageId: string, token: string): Promise<{ data: Buffer; mimeType: string }> {
    const issuedTo = this.signedUrl.verify(token, imageId);
    if (issuedTo === null) {
      throw new UnauthorizedException(
        'El enlace de la imagen es inválido o ha expirado. Los enlaces firmados caducan a los 15 minutos (RNF-02).',
      );
    }
    return this.readPlaintext(imageId);
  }

  /**
   * Server-side read with no signed token, for the inference worker.
   *
   * Not reachable from any HTTP route: the only callers are internal services that already run
   * under a verified request, so exposing it does not widen the surface protected by RNF-02.
   */
  async readPlaintext(imageId: string): Promise<{ data: Buffer; mimeType: string }> {
    const image = await this.findById(imageId);
    const stored = await this.storage.get(image.storageKey);
    const data = image.encrypted ? this.encryption.decryptBuffer(stored) : stored;

    if (this.encryption.sha256(data) !== image.sha256) {
      throw new BadRequestException(
        'La imagen almacenada no coincide con su huella SHA-256 registrada: posible corrupción o alteración.',
      );
    }
    return { data, mimeType: image.mimeType };
  }

  toDto(image: CaseImage, apiPrefix: string, userId: string): CaseImageDto {
    return {
      id: image.id,
      caseId: image.caseId,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      sizeBytes: Number(image.sizeBytes),
      sha256: image.sha256,
      encrypted: image.encrypted,
      isHeatmap: image.isHeatmap,
      createdAt: image.createdAt.toISOString(),
      url: this.signedUrl.buildUrl(apiPrefix, image.id, userId),
    };
  }

  private validate(file: UploadedImage): void {
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException(
        `Formato de imagen no admitido (${file.mimetype}). Use JPEG, PNG o WebP.`,
      );
    }
    if (file.buffer.length === 0) {
      throw new BadRequestException('El archivo de imagen está vacío.');
    }
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `La imagen supera el máximo de ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      );
    }
  }
}
