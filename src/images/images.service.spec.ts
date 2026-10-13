import { UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';

import type { EncryptionService } from 'src/common/crypto/encryption.service';
import type { SignedUrlService } from 'src/common/crypto/signed-url.service';
import type { AppConfig } from 'src/config/configuration';
import { encodePng } from 'src/database/seeds/synthetic-image';
import type { AiEngineClient, ImageScreenResponse } from 'src/inference/ai-engine.client';
import type { StorageProvider } from 'src/storage/storage.provider';

import type { CaseImage } from './case-image.entity';
import { ImagesService, type UploadedImage } from './images.service';

/**
 * The upload path: screening first, then the view check, then storage. Nothing that is refused may
 * reach the storage backend — a rejected photograph left encrypted on disk is the mess this exists
 * to prevent.
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

  function screened(overrides: Partial<ImageScreenResponse> = {}): ImageScreenResponse {
    return {
      acceptable: true,
      checked: true,
      subject: 'rostro_humano',
      issues: [],
      reason: '',
      pose: 'frontal',
      yaw_ratio: 0,
      latency_ms: 5,
      model_backend: 'torch',
      ...overrides,
    };
  }

  function build(
    screen: () => Promise<ImageScreenResponse>,
    existing: Partial<CaseImage>[] = [],
  ): { service: ImagesService; storage: StorageProvider; saved: Partial<CaseImage>[] } {
    const saved: Partial<CaseImage>[] = [];
    const repository = {
      create: jest.fn((data: Partial<CaseImage>) => data),
      save: jest.fn(async (entity: Partial<CaseImage>) => {
        saved.push(entity);
        return { id: 'new-image', createdAt: new Date(), ...entity };
      }),
      find: jest.fn().mockResolvedValue(existing),
    } as unknown as Repository<CaseImage>;
    const storage = {
      driver: 'local',
      put: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageProvider;
    const encryption = {
      sha256: (data: Buffer) => sha(data),
      encryptBuffer: (data: Buffer) => data,
    } as unknown as EncryptionService;
    const aiEngine = { screenImage: jest.fn(screen) } as unknown as AiEngineClient;
    const config = { aiEngine: { screenUploads: true } } as AppConfig;

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
    const { service, storage } = build(async () => screened({ pose: 'nariz_izquierda' }), [
      { id: 'img-1', shotKey: 'perfil_izquierdo', sha256: sha(PNG), pose: 'nariz_izquierda' },
    ]);

    await expect(service.upload('case-1', file(), 'user-1', 'perfil_derecho')).rejects.toThrow(
      /Perfil izquierdo/,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses a second profile turned to the same side as the first', async () => {
    const { service } = build(async () => screened({ pose: 'nariz_izquierda' }), [
      { id: 'img-1', shotKey: 'perfil_izquierdo', sha256: sha(OTHER_PNG), pose: 'nariz_izquierda' },
    ]);

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

  it('skips the pose rules when the engine cannot be reached (fails open)', async () => {
    const { service, saved } = build(async () => {
      throw new Error('ECONNREFUSED');
    });

    await service.upload('case-1', file(), 'user-1', 'general');

    expect(saved[0]).toMatchObject({ shotKey: 'general', pose: null });
  });

  it('still refuses a duplicate when the engine cannot be reached', async () => {
    const { service } = build(
      async () => {
        throw new Error('ECONNREFUSED');
      },
      [{ id: 'img-1', shotKey: 'general', sha256: sha(PNG), pose: null }],
    );

    await expect(service.upload('case-1', file(), 'user-1', 'perfil_derecho')).rejects.toThrow(
      /Vista general/,
    );
  });
});
