import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { SignedUrlService } from 'src/common/crypto/signed-url.service';
import {
  checkShotView,
  isHeadPose,
  missingRequiredShots,
  type HeadPose,
  type ShotKey,
  type ShotSibling,
} from 'src/common/domain';
import { readImageDimensions } from 'src/common/utils/image-dimensions';
import { sniffImageType, type SniffedImageType } from 'src/common/utils/image-sniffer';
import { AiEngineClient } from 'src/inference/ai-engine.client';
import { STORAGE_PROVIDER, type StorageProvider } from 'src/storage/storage.provider';

import { describeRejection, describeIssues } from './screening-message';

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
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @InjectRepository(CaseImage) private readonly repository: Repository<CaseImage>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly encryption: EncryptionService,
    private readonly signedUrl: SignedUrlService,
    private readonly aiEngine: AiEngineClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * @param userId who is credited with the upload. Null only for machine-produced images; a photo
   *   arriving through a mobile capture session is credited to whoever opened that session, so the
   *   audit trail never loses the responsible person.
   * @param shotKey which shot of the photographic protocol this is, when it follows one.
   */
  async upload(
    caseId: string,
    file: UploadedImage,
    userId: string | null,
    shotKey: ShotKey | null = null,
  ): Promise<{ image: CaseImage; warnings: string[] }> {
    // The recorded mime type is the sniffed one, not the declared one.
    const mimeType = this.validate(file);
    const screening = await this.screen(file.buffer, mimeType);

    const view = checkShotView(
      shotKey,
      screening.pose,
      this.encryption.sha256(file.buffer),
      await this.siblings(caseId),
    );
    if (view.rejection !== null) throw new UnprocessableEntityException(view.rejection);

    const image = await this.store(
      caseId,
      file.buffer,
      mimeType,
      userId,
      false,
      shotKey,
      screening.pose,
    );
    return { image, warnings: [...screening.warnings, ...view.warnings] };
  }

  /** The case's photographs as `checkShotView` reads them, oldest first. */
  private async siblings(caseId: string, excludeId?: string): Promise<ShotSibling[]> {
    const images = await this.findByCase(caseId, false);
    return images
      .filter((image) => image.id !== excludeId)
      .map((image) => ({
        id: image.id,
        shotKey: image.shotKey,
        sha256: image.sha256,
        pose: image.pose,
      }));
  }

  /**
   * Refuses anything that is not an evaluable facial photograph, BEFORE it is stored.
   *
   * Rejecting after storing would leave the junk encrypted on disk and in the case file, which is
   * both a privacy cost and the mess this is meant to prevent.
   *
   * WHAT IT DOES NOT CHECK: whether the photograph shows acne. `sin_lesiones` is one of the five
   * IGA classes and a clean face at a follow-up visit is what a resolved case looks like —
   * screening for the disease would reject the evidence that the treatment worked.
   *
   * It runs in BOTH experimental conditions, which is what makes it admissible: a factor held
   * constant on both sides of a paired contrast cannot explain a difference between them. The
   * engine's verdict carries nothing clinical, so nothing about the disease leaks into the pretest
   * (RF-TR-01).
   *
   * @returns quality warnings worth passing to the photographer (never blocking on their own), and
   *   the head pose when the engine measured one — null otherwise, which skips the pose rules.
   */
  private async screen(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ warnings: string[]; pose: HeadPose | null }> {
    const unchecked: { warnings: string[]; pose: HeadPose | null } = { warnings: [], pose: null };
    if (!this.config.aiEngine.screenUploads) return unchecked;
    try {
      const verdict = await this.aiEngine.screenImage(buffer.toString('base64'), mimeType);
      if (!verdict.checked) return unchecked;
      if (!verdict.acceptable) {
        throw new UnprocessableEntityException(
          describeRejection(verdict.subject, verdict.reason),
        );
      }
      return {
        warnings: describeIssues(verdict.issues),
        pose: isHeadPose(verdict.pose) ? verdict.pose : null,
      };
    } catch (error: unknown) {
      if (error instanceof UnprocessableEntityException) throw error;
      // Failing open is deliberate: a clinician looks at every photograph anyway, and refusing a
      // real patient's intake because the engine blinked is the worse of the two errors. The log
      // is loud so that silence is never mistaken for a verification.
      this.logger.warn(
        'No se pudo cribar la imagen; se admite sin verificar: ' +
          (error instanceof Error ? error.message : String(error)),
      );
      return unchecked;
    }
  }

  /** Persists a Grad-CAM overlay produced by the engine (section 8.4). */
  async storeHeatmap(caseId: string, data: Buffer, mimeType: string): Promise<CaseImage> {
    return this.store(caseId, data, mimeType, null, true, null, null);
  }

  private async store(
    caseId: string,
    plaintext: Buffer,
    mimeType: string,
    userId: string | null,
    isHeatmap: boolean,
    shotKey: ShotKey | null,
    pose: HeadPose | null,
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
      shotKey,
      pose,
    });
    return this.repository.save(image);
  }

  async findById(id: string): Promise<CaseImage> {
    const image = await this.repository.findOne({ where: { id } });
    if (image === null) throw new NotFoundException(`No existe la imagen ${id}.`);
    return image;
  }

  /**
   * Corrige la toma de una fotografía ya subida.
   *
   * La etiqueta es lo que el protocolo mínimo comprueba, y el mostrador se equivoca de desplegable
   * con facilidad: tres fotografías subidas como «Vista general» son, en la práctica, una general y
   * dos perfiles mal rotulados. Reetiquetar no toca los bytes ni el cifrado y no invalida nada que
   * dependa de la imagen (una inferencia mira píxeles, no la etiqueta), así que no tiene las
   * restricciones de `remove`. Un mapa de calor no es una toma y no se reetiqueta.
   *
   * Pasa por las mismas reglas de vista que la subida (`checkShotView`), con la orientación que se
   * midió al subirla: reetiquetar no puede ser la puerta de atrás para archivar un perfil como
   * vista general.
   */
  async relabel(imageId: string, shotKey: ShotKey): Promise<CaseImage> {
    const image = await this.findById(imageId);
    if (image.isHeatmap) {
      throw new BadRequestException('Un mapa de calor no es una toma del protocolo fotográfico.');
    }
    const view = checkShotView(
      shotKey,
      image.pose,
      image.sha256,
      await this.siblings(image.caseId, image.id),
    );
    if (view.rejection !== null) throw new UnprocessableEntityException(view.rejection);
    await this.repository.update({ id: imageId }, { shotKey });
    image.shotKey = shotKey;
    return image;
  }

  /**
   * Retira una fotografía subida por error, con sus bytes.
   *
   * Se BORRA de verdad, no se marca: una imagen clínica que nadie leyó nunca es un dato personal
   * que ya no hace falta, y conservarla «por si acaso» es exactamente lo que la Ley N.º 29733 pide
   * no hacer. Lo que queda es el asiento de auditoría, que dice quién la quitó y cuándo (RNF-05).
   *
   * Se niega en dos casos, y ninguno es burocracia:
   *
   *  - **La miró el modelo.** La inferencia y su mapa de calor son una lectura DE esta fotografía;
   *    sin ella la sugerencia queda sin sustento y el caso muestra una clase IGA que ya no se
   *    puede contrastar contra nada.
   *  - **El especialista ya diagnosticó.** La fotografía es la evidencia sobre la que firmó. Que
   *    desaparezca después convierte un diagnóstico verificable en la palabra de alguien.
   *
   * En ambos casos la salida real es subir la fotografía correcta: el caso admite varias, y quien
   * revisa elige cuál mira.
   */
  async remove(imageId: string): Promise<{ removed: boolean; caseId: string }> {
    const image = await this.findById(imageId);

    if (image.isHeatmap) {
      throw new BadRequestException(
        'El mapa de calor no se retira por separado: lo produjo el modelo al leer una fotografía, ' +
          'y borrarlo dejaría la inferencia sin la superposición que la explica.',
      );
    }

    const [used] = await this.repository.manager.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS "n" FROM "inferencias_ia" WHERE "imagen_id" = $1`,
      [imageId],
    );
    if (Number(used?.n ?? 0) > 0) {
      throw new BadRequestException(
        'Esta fotografía ya fue analizada por el modelo y la inferencia se apoya en ella. Suba la ' +
          'fotografía correcta y analícela: el caso admite varias, y quien revisa elige cuál mira.',
      );
    }

    const [graded] = await this.repository.manager.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS "n" FROM "diagnosticos" WHERE "caso_id" = $1`,
      [image.caseId],
    );
    if (Number(graded?.n ?? 0) > 0) {
      throw new BadRequestException(
        'El caso ya tiene un diagnóstico firmado y esta fotografía es parte de la evidencia sobre ' +
          'la que se firmó. No se puede retirar.',
      );
    }

    // La fila primero: si cayera el almacenamiento, un objeto huérfano cifrado es basura; una fila
    // que apunta a bytes inexistentes es una imagen rota en la ficha de un paciente.
    await this.repository.delete({ id: imageId });
    try {
      await this.storage.remove(image.storageKey);
    } catch (error: unknown) {
      this.logger.warn(
        `La imagen ${imageId} se retiró del caso pero sus bytes siguen en el almacenamiento: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { removed: true, caseId: image.caseId };
  }

  /**
   * Required shots of the photographic protocol the case still lacks.
   *
   * Heatmaps are the model's output, not a photograph of the patient, and photographs uploaded
   * without a shot label cannot be credited to any view — both are ignored (see
   * `missingRequiredShots`).
   */
  async missingRequiredShots(caseId: string): Promise<ShotKey[]> {
    const images = await this.findByCase(caseId, false);
    return missingRequiredShots(images.map((image) => image.shotKey));
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
      shotKey: image.shotKey,
      createdAt: image.createdAt.toISOString(),
      url: this.signedUrl.buildUrl(apiPrefix, image.id, userId),
    };
  }

  /**
   * @returns the mime type read from the file's own bytes, which is what gets recorded.
   *
   * The declared `mimetype` is checked first only to give a clearer message; the binding decision is
   * the sniff. A phone's camera app labels its output inconsistently, and the mobile upload route is
   * authorised by a QR token rather than by a session, so the header cannot be trusted.
   */
  private validate(file: UploadedImage): SniffedImageType {
    if (file.buffer.length === 0) {
      throw new BadRequestException('El archivo de imagen está vacío.');
    }
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `La imagen supera el máximo de ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      );
    }

    const sniffed = sniffImageType(file.buffer);
    if (sniffed === null) {
      const declared = (ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)
        ? `El archivo dice ser ${file.mimetype}, pero su contenido no lo es.`
        : `Formato no admitido (${file.mimetype}).`;
      throw new BadRequestException(
        `${declared} Use una fotografía JPEG, PNG o WebP completa; si la tomó con el teléfono, vuelva a intentarlo con mejor señal.`,
      );
    }
    return sniffed;
  }
}
