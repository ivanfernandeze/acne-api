import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';

import type { ClinicalCase } from 'src/cases/case.entity';
import type { AppConfig } from 'src/config/configuration';
import type { ImagesService } from 'src/images/images.service';

import { CaptureService } from './capture.service';
import type { CaptureSession } from './capture-session.entity';

/**
 * The capture session is the one capability in the system a stranger can exercise: the phone carries
 * no account, and the QR token is the whole authorisation. These tests pin the four things that
 * bound it — the token is never stored in the clear, expiry and revocation both close the door, and
 * the upload cap holds — because each of them failing would be silent.
 */
describe('CaptureService', () => {
  const config = { security: { captureSessionTtlSeconds: 900 } } as AppConfig;

  const openCase = { id: 'case-1', caseCode: 'ACN-2026-0001', status: 'borrador' } as ClinicalCase;

  function build(
    session: CaptureSession | null,
    clinicalCase: ClinicalCase | null = openCase,
  ): {
    service: CaptureService;
    repository: Repository<CaptureSession>;
    images: ImagesService;
    saved: CaptureSession[];
  } {
    const saved: CaptureSession[] = [];
    const repository = {
      create: jest.fn((data: Partial<CaptureSession>) => ({ id: 'session-1', ...data })),
      save: jest.fn(async (entity: CaptureSession) => {
        saved.push(entity);
        return entity;
      }),
      findOne: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockResolvedValue({ affected: 2 }),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    } as unknown as Repository<CaptureSession>;

    const cases = {
      findOne: jest.fn().mockResolvedValue(clinicalCase),
      // `assertCaseActive`: the case exists and was not annulled.
      manager: { query: jest.fn().mockResolvedValue([{ anulado_en: null, codigo_caso: 'ACN-1' }]) },
    } as unknown as Repository<ClinicalCase>;

    const images = {
      findByCase: jest.fn().mockResolvedValue([]),
      upload: jest.fn().mockResolvedValue({
        image: { id: 'image-1', shotKey: 'general', createdAt: new Date() },
        warnings: [],
      }),
    } as unknown as ImagesService;

    return {
      service: new CaptureService(repository, cases, images, config),
      repository,
      images,
      saved,
    };
  }

  function live(overrides: Partial<CaptureSession> = {}): CaptureSession {
    return {
      id: 'session-1',
      caseId: 'case-1',
      tokenHash: '',
      createdBy: 'user-1',
      expiresAt: new Date(Date.now() + 600_000),
      maxUploads: 8,
      uploadCount: 0,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  const file = { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'a.png' };
  const TOKEN = 'un-token-suficientemente-largo';

  describe('create', () => {
    it('stores only the digest, never the token itself', async () => {
      const { service, saved } = build(null);
      const result = await service.create('case-1', 'user-1');

      const row = saved[0];
      expect(row?.tokenHash).toBe(createHash('sha256').update(result.token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(result.token);
    });

    it('revokes any session already open for the case', async () => {
      // Two working links for one case, and nobody able to say which was handed to whom.
      const { service, repository } = build(null);
      await service.create('case-1', 'user-1');

      // `revokedAt` is TypeORM's IsNull() operator, so match on the case and on the stamp.
      expect(repository.update).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'case-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('refuses a closed case', async () => {
      const { service } = build(null, { ...openCase, status: 'cerrado' });
      await expect(service.create('case-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('context', () => {
    it('answers with the case CODE and never the patient', async () => {
      const { service } = build(live());
      const context = await service.context(TOKEN);

      expect(context.caseCode).toBe('ACN-2026-0001');
      expect(JSON.stringify(context)).not.toContain('patient');
    });

    it('rejects an expired session', async () => {
      const { service } = build(live({ expiresAt: new Date(Date.now() - 1000) }));
      await expect(service.context(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a revoked session', async () => {
      const { service } = build(live({ revokedAt: new Date() }));
      await expect(service.context(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers an unknown token exactly as it answers an expired one', async () => {
      // Telling them apart would let a caller probe which cases exist.
      const { service } = build(null);
      await expect(service.context(TOKEN)).rejects.toThrow(/no es válido o ya caducó/);
    });

    it('rejects a token too short to be one of ours before touching the database', async () => {
      const { service, repository } = build(live());
      await expect(service.context('corto')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    it('credits the image to whoever opened the session', async () => {
      // The request carried no principal; an anonymous write to a clinical record is exactly what
      // RNF-02 exists to prevent.
      const { service, images } = build(live({ createdBy: 'tecnico-7' }));
      await service.upload(TOKEN, file, 'general');

      expect(images.upload).toHaveBeenCalledWith('case-1', file, 'tecnico-7', 'general');
    });

    it('counts the upload', async () => {
      const { service } = build(live());
      const { result } = await service.upload(TOKEN, file, 'borde');
      expect(result.uploadCount).toBe(1);
    });

    it('refuses once the cap is reached', async () => {
      const { service, images } = build(live({ uploadCount: 8, maxUploads: 8 }));
      await expect(service.upload(TOKEN, file, 'general')).rejects.toThrow(/límite de 8/);
      expect(images.upload).not.toHaveBeenCalled();
    });

    it('refuses after the session was revoked, which is what opening the case file does', async () => {
      const { service, images } = build(live({ revokedAt: new Date() }));
      await expect(service.upload(TOKEN, file, 'general')).rejects.toBeInstanceOf(NotFoundException);
      expect(images.upload).not.toHaveBeenCalled();
    });
  });

  describe('activeForCase', () => {
    it('does not offer a session whose time already ran out', async () => {
      const { service } = build(live({ expiresAt: new Date(Date.now() - 1) }));
      await expect(service.activeForCase('case-1')).resolves.toBeNull();
    });

    it('reports a live one as active', async () => {
      const { service } = build(live());
      const status = await service.activeForCase('case-1');

      expect(status?.active).toBe(true);
      expect(status?.remainingSeconds).toBeGreaterThan(0);
    });
  });
});
