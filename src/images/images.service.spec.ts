import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';

import type { EncryptionService } from 'src/common/crypto/encryption.service';
import type { SignedUrlService } from 'src/common/crypto/signed-url.service';
import type { AppConfig } from 'src/config/configuration';
import { encodePng } from 'src/database/seeds/synthetic-image';
import type {
  AiEngineClient,
  IdentityCheck,
  ImageScreenResponse,
  ScreenReference,
} from 'src/inference/ai-engine.client';
import type { StorageProvider } from 'src/storage/storage.provider';

import type { CaseImage } from './case-image.entity';
import { ImagesService, type UploadedImage } from './images.service';

/**
 * The upload path: screening first, then the view check, then the same-subject check, then
 * storage. Nothing that is refused may reach the storage backend — a rejected photograph left
 * encrypted on disk is the mess this exists to prevent. And nothing unverified is admitted: an
 * engine that cannot answer is a 503, not a pass.
 */
describe('ImagesService.upload', () => {
  // Two different, genuinely decodable PNGs: the sniffer reads the bytes, not the declared type.
  const PNG = encodePng(4, 4, Buffer.alloc(4 * 4 * 3, 120));
  const OTHER_PNG = encodePng(4, 4, Buffer.alloc(4 * 4 * 3, 200));
  const file = (buffer = PNG): UploadedImage => ({
    buffer,
    mimetype: 'image/png',
    originalname: 'x.png',
  });
  const sha = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

  const identity = (overrides: Partial<IdentityCheck> = {}): IdentityCheck => ({
    checked: true,
    face_found: true,
    comparisons: [],
    version: 'sface-2021dec',
    ...overrides,
  });

  function screened(overrides: Partial<ImageScreenResponse> = {}): ImageScreenResponse {
    return {
      acceptable: true,
      checked: true,
      subject: 'rostro_humano',
      issues: [],
      reason: '',
      pose: 'frontal',
      yaw_ratio: 0,
      identity: identity(),
      latency_ms: 5,
      model_backend: 'torch',
      ...overrides,
    };
  }

  /** Bytes behind each photograph on file, so it can be decrypted and sent as reference. */
  const filed = new Map<string, Buffer>();
  beforeEach(() => filed.clear());

  /** A photograph already in the case. */
  function onFile(
    id: string,
    shotKey: CaseImage['shotKey'],
    pose: CaseImage['pose'],
    bytes = OTHER_PNG,
  ): Partial<CaseImage> {
    filed.set(id, bytes);
    return {
      id,
      shotKey,
      pose,
      sha256: sha(bytes),
      storageKey: `cases/c/${id}.enc`,
      encrypted: true,
      mimeType: 'image/png',
      isHeatmap: false,
      caseId: 'case-1',
    };
  }

  type Screen = (
    base64: string,
    mime: string,
    references: ScreenReference[],
  ) => Promise<ImageScreenResponse>;

  function build(
    screen: Screen,
    existing: Partial<CaseImage>[] = [],
    screenUploads = true,
  ): {
    service: ImagesService;
    storage: StorageProvider;
    saved: Partial<CaseImage>[];
    screenImage: jest.Mock<ReturnType<Screen>, Parameters<Screen>>;
  } {
    const saved: Partial<CaseImage>[] = [];
    const repository = {
      create: jest.fn((data: Partial<CaseImage>) => data),
      save: jest.fn(async (entity: Partial<CaseImage>) => {
        saved.push(entity);
        return { id: 'new-image', createdAt: new Date(), ...entity };
      }),
      find: jest.fn().mockResolvedValue(existing),
      findOne: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          existing.find((image) => image.id === where.id) ?? null,
      ),
      update: jest.fn().mockResolvedValue(undefined),
      // `assertCaseActive`: the case exists and was not annulled.
      manager: { query: jest.fn().mockResolvedValue([{ anulado_en: null, codigo_caso: 'ACN-1' }]) },
    } as unknown as Repository<CaseImage>;
    const storage = {
      driver: 'local',
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(async (key: string) => {
        const image = existing.find((candidate) => candidate.storageKey === key);
        return filed.get(image?.id ?? '') ?? Buffer.alloc(0);
      }),
    } as unknown as StorageProvider;
    const encryption = {
      sha256: (data: Buffer) => sha(data),
      encryptBuffer: (data: Buffer) => data,
      decryptBuffer: (data: Buffer) => data,
    } as unknown as EncryptionService;
    const screenImage = jest.fn(screen);
    const aiEngine = { screenImage } as unknown as AiEngineClient;
    const config = { aiEngine: { screenUploads } } as AppConfig;

    return {
      service: new ImagesService(
        repository,
        storage,
        encryption,
        {} as SignedUrlService,
        aiEngine,
        config,
      ),
      storage,
      saved,
      screenImage,
    };
  }

  it('stores a frontal photograph as the general view, with its pose', async () => {
    const { service, saved } = build(async () => screened({ pose: 'frontal' }));

    const { warnings } = await service.upload('case-1', file(), 'user-1', 'general');

    expect(warnings).toEqual([]);
    expect(saved[0]).toMatchObject({ shotKey: 'general', pose: 'frontal' });
  });

  it('refuses a turned head filed as the general view, and stores nothing', async () => {
    const { service, storage } = build(async () => screened({ pose: 'nariz_izquierda' }));

    await expect(service.upload('case-1', file(), 'user-1', 'general')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses the same file uploaded into a second shot', async () => {
    const { service, storage } = build(
      async () => screened({ pose: 'nariz_izquierda' }),
      [onFile('img-1', 'perfil_izquierdo', 'nariz_izquierda', PNG)],
    );

    await expect(service.upload('case-1', file(), 'user-1', 'perfil_derecho')).rejects.toThrow(
      /Perfil izquierdo/,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses a second profile turned to the same side as the first', async () => {
    const { service } = build(
      async () => screened({ pose: 'nariz_izquierda' }),
      [onFile('img-1', 'perfil_izquierdo', 'nariz_izquierda')],
    );

    await expect(service.upload('case-1', file(), 'user-1', 'perfil_derecho')).rejects.toThrow(
      /mismo lado/,
    );
  });

  it('adds the side warning to the quality warnings without blocking', async () => {
    const { service, saved } = build(async () =>
      screened({ pose: 'nariz_izquierda', issues: ['enfoque'] }),
    );

    const { warnings } = await service.upload('case-1', file(), 'user-1', 'perfil_derecho');

    expect(saved).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toMatch(/espejada/);
  });

  describe('same person in every shot', () => {
    it('sends the latest photograph of each OTHER facial shot as reference', async () => {
      const { service, screenImage } = build(
        async () => screened({ pose: 'nariz_izquierda' }),
        [
          onFile('old-general', 'general', 'frontal'),
          onFile('new-general', 'general', 'frontal', encodePng(4, 4, Buffer.alloc(48, 10))),
          onFile('right', 'perfil_derecho', 'nariz_derecha'),
          onFile('old-left', 'perfil_izquierdo', 'nariz_izquierda'),
          onFile('chest', 'pecho', null),
        ],
      );

      await service.upload('case-1', file(), 'user-1', 'perfil_izquierdo');

      const references = screenImage.mock.calls[0]?.[2] ?? [];
      expect(references.map((r) => r.label)).toEqual(['general', 'perfil_derecho']);
      expect(references[0]?.image_base64).toBe(
        encodePng(4, 4, Buffer.alloc(48, 10)).toString('base64'),
      );
    });

    it('refuses a profile of another person and stores nothing', async () => {
      const { service, storage } = build(
        async () =>
          screened({
            pose: 'nariz_derecha',
            identity: identity({
              comparisons: [
                {
                  label: 'general',
                  verdict: 'distinta',
                  similarity: 0.08,
                  threshold: 0.495,
                  near_duplicate: false,
                },
              ],
            }),
          }),
        [onFile('img-1', 'general', 'frontal')],
      );

      await expect(service.upload('case-1', file(), 'user-1', 'perfil_derecho')).rejects.toThrow(
        /no corresponde a la misma persona que «Vista general»/,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses a re-encoded copy of a shot already on file', async () => {
      const { service } = build(
        async () =>
          screened({
            pose: 'frontal',
            identity: identity({
              comparisons: [
                {
                  label: 'acercamiento',
                  verdict: 'misma',
                  similarity: 0.98,
                  threshold: 0.445,
                  near_duplicate: true,
                },
              ],
            }),
          }),
        [onFile('img-1', 'acercamiento', 'frontal')],
      );

      await expect(service.upload('case-1', file(), 'user-1', 'general')).rejects.toThrow(
        /misma que ya está registrada como «Acercamiento»/,
      );
    });

    it('stores a required shot cut at the eyes, with a warning to check it by eye', async () => {
      const { service, saved } = build(async () =>
        screened({
          pose: 'indeterminado',
          identity: identity({ face_found: false }),
        }),
      );

      const { warnings } = await service.upload('case-1', file(), 'user-1', 'perfil_derecho');

      expect(saved).toHaveLength(1);
      expect(warnings.some((warning) => /No se pudo comprobar/.test(warning))).toBe(true);
    });
  });

  describe('fails closed', () => {
    it('refuses with 503 when the engine cannot be reached, and stores nothing', async () => {
      const { service, storage } = build(async () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(service.upload('case-1', file(), 'user-1', 'general')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('refuses with 503 when the engine did not screen the image', async () => {
      const { service } = build(async () => screened({ checked: false }));

      await expect(service.upload('case-1', file(), 'user-1', 'general')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('refuses with 503 when the identity could not be compared', async () => {
      const { service } = build(async () =>
        screened({ identity: identity({ checked: false, face_found: false }) }),
      );

      await expect(service.upload('case-1', file(), 'user-1', 'general')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('refuses with 503 an engine too old to report identity', async () => {
      const { service } = build(async () => screened({ identity: undefined }));

      await expect(service.upload('case-1', file(), 'user-1', 'general')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('admits unverified only when screening is switched off on purpose', async () => {
      const { service, saved, screenImage } = build(
        async () => screened(),
        [onFile('img-1', 'general', 'frontal')],
        false,
      );

      await service.upload('case-1', file(), 'user-1', 'perfil_derecho');

      expect(screenImage).not.toHaveBeenCalled();
      expect(saved[0]).toMatchObject({ shotKey: 'perfil_derecho', pose: null });
    });
  });

  describe('relabel', () => {
    it('re-checks the identity when a photograph becomes a required shot', async () => {
      const { service, screenImage } = build(
        async () =>
          screened({
            pose: 'nariz_derecha',
            identity: identity({
              comparisons: [
                {
                  label: 'general',
                  verdict: 'distinta',
                  similarity: 0.1,
                  threshold: 0.495,
                  near_duplicate: false,
                },
              ],
            }),
          }),
        [onFile('img-1', 'general', 'frontal'), onFile('img-2', 'otra', 'nariz_derecha', PNG)],
      );

      await expect(service.relabel('img-2', 'perfil_derecho')).rejects.toThrow(
        /no corresponde a la misma persona/,
      );
      expect(screenImage.mock.calls[0]?.[2].map((r) => r.label)).toEqual(['general']);
    });
  });
});
