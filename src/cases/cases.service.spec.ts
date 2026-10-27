import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { AnamnesisService } from 'src/anamnesis/anamnesis.service';
import type { CaptureService } from 'src/capture/capture.service';
import type { EncryptionService } from 'src/common/crypto/encryption.service';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user';
import type { AppConfig } from 'src/config/configuration';
import type { DiagnosesService } from 'src/diagnoses/diagnoses.service';
import type { ImagesService } from 'src/images/images.service';
import type { InferenceService } from 'src/inference/inference.service';
import type { SessionsService } from 'src/sessions/sessions.service';
import type { ReviewTimingService } from 'src/study/review-timing.service';

import type { ClinicalCase } from './case.entity';
import { CasesService } from './cases.service';

/**
 * Quitar y corregir un caso. Lo que se protege: un caso con evidencia del estudio nunca se borra, y
 * un caso anulado no admite cambios.
 */
describe('CasesService — quitar y corregir', () => {
  const user = { id: 'user-1', role: 'tecnico' } as AuthenticatedUser;

  function caseRow(overrides: Partial<ClinicalCase> = {}): ClinicalCase {
    return {
      id: 'case-1',
      caseCode: 'ACN-2026-0001',
      patientId: 'patient-1',
      assignedUserId: 'user-1',
      status: 'borrador',
      notes: null,
      voidedAt: null,
      voidedById: null,
      voidReason: null,
      workSessionId: null,
      createdAt: new Date('2026-10-25T10:00:00Z'),
      closedAt: null,
      ...overrides,
    } as ClinicalCase;
  }

  function build(
    found: ClinicalCase,
    evidence: { diagnoses?: number; timings?: number; inferences?: number; prescriptions?: number },
    rows: Record<string, unknown[]> = {},
  ): {
    service: CasesService;
    repository: Repository<ClinicalCase>;
    images: ImagesService;
    capture: CaptureService;
    sessions: SessionsService;
  } {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('"diagnoses"')) {
        return [
          {
            id: 'case-1',
            diagnoses: evidence.diagnoses ?? 0,
            timings: evidence.timings ?? 0,
            inferences: evidence.inferences ?? 0,
            prescriptions: evidence.prescriptions ?? 0,
          },
        ];
      }
      if (sql.includes('FROM "pacientes"')) return rows['pacientes'] ?? [];
      if (sql.includes('FROM "usuarios"')) return rows['usuarios'] ?? [];
      return [];
    });
    const queryBuilder = {
      leftJoinAndSelect: () => queryBuilder,
      where: () => queryBuilder,
      addSelect: () => queryBuilder,
      getOne: jest.fn().mockResolvedValue(found),
    };
    const repository = {
      createQueryBuilder: () => queryBuilder,
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(async (entity: ClinicalCase) => entity),
      manager: { query },
    } as unknown as Repository<ClinicalCase>;
    const images = {
      findByCase: jest.fn().mockResolvedValue([{ storageKey: 'cases/case-1/a.enc' }]),
      purgeStoredBytes: jest.fn().mockResolvedValue(undefined),
    } as unknown as ImagesService;
    const capture = {
      revokeActiveForCase: jest.fn().mockResolvedValue(0),
    } as unknown as CaptureService;
    const sessions = {
      uncountCase: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionsService;

    const service = new CasesService(
      repository,
      images,
      {} as InferenceService,
      { start: jest.fn().mockResolvedValue({}) } as unknown as ReviewTimingService,
      {} as DiagnosesService,
      capture,
      sessions,
      {} as AnamnesisService,
      {} as EncryptionService,
      {} as AppConfig,
    );
    return { service, repository, images, capture, sessions };
  }

  it('erases a draft with no evidence, and its stored photographs', async () => {
    const { service, repository, images } = build(caseRow(), {});

    const result = await service.remove('case-1', 'Paciente equivocado al crear', user);

    expect(result.mode).toBe('eliminar');
    expect(repository.delete).toHaveBeenCalledWith({ id: 'case-1' });
    expect(images.purgeStoredBytes).toHaveBeenCalledWith(['cases/case-1/a.enc']);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('annuls — never erases — a case with a diagnosis, and uncounts it from its session', async () => {
    const { service, repository, capture, sessions } = build(
      caseRow({ status: 'diagnosticado', workSessionId: 'session-1' }),
      { diagnoses: 1, timings: 1 },
    );

    const result = await service.remove('case-1', 'Ingreso duplicado del mismo paciente', user);

    expect(result.mode).toBe('anular');
    expect(result.evidence).toEqual(['1 diagnóstico', '1 revisión medida']);
    expect(repository.delete).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'case-1' },
      expect.objectContaining({
        voidedById: 'user-1',
        voidReason: 'Ingreso duplicado del mismo paciente',
      }),
    );
    expect(capture.revokeActiveForCase).toHaveBeenCalledWith('case-1');
    expect(sessions.uncountCase).toHaveBeenCalledWith('session-1');
  });

  it('refuses to touch a case that is already annulled', async () => {
    const { service } = build(caseRow({ voidedAt: new Date(), voidReason: 'x'.repeat(10) }), {});

    await expect(service.remove('case-1', 'otra vez el motivo', user)).rejects.toThrow(/anulado/);
    await expect(service.update('case-1', { notes: 'nota' })).rejects.toThrow(BadRequestException);
  });

  it('moves a draft to the right patient', async () => {
    const { service, repository } = build(caseRow(), {}, { pacientes: [{ retirado_en: null }] });

    await service.update('case-1', { patientId: 'patient-2' });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-2' }),
    );
  });

  it('refuses to move a diagnosed case to another patient', async () => {
    const { service } = build(caseRow(), { diagnoses: 1 }, { pacientes: [{ retirado_en: null }] });

    await expect(service.update('case-1', { patientId: 'patient-2' })).rejects.toThrow(
      /no se puede cambiar de paciente/,
    );
  });

  it('refuses a patient who withdrew consent, and an inactive assignee', async () => {
    const withdrawn = build(caseRow(), {}, { pacientes: [{ retirado_en: new Date() }] });
    await expect(withdrawn.service.update('case-1', { patientId: 'patient-2' })).rejects.toThrow(
      /retiró su consentimiento/,
    );

    const inactive = build(caseRow(), {}, { usuarios: [{ activo: false }] });
    await expect(inactive.service.update('case-1', { assignedUserId: 'user-9' })).rejects.toThrow(
      /desactivado/,
    );
  });

  describe('abrir la ficha', () => {
    it.each(['diagnosticado', 'cerrado', 'derivar_presencial', 'solicitar_fotos'] as const)(
      'does not send a %s case back to «En revisión»',
      async (status) => {
        const { service, repository } = build(caseRow({ status }), {});
        jest.spyOn(service, 'findOne').mockResolvedValue({} as never);

        await service.open('case-1', { id: 'derm-1', role: 'dermatologo' } as AuthenticatedUser);

        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it('moves a draft into review', async () => {
      const { service, repository } = build(caseRow({ status: 'borrador' }), {});
      jest.spyOn(service, 'findOne').mockResolvedValue({} as never);

      await service.open('case-1', { id: 'derm-1', role: 'dermatologo' } as AuthenticatedUser);

      expect(repository.update).toHaveBeenCalledWith({ id: 'case-1' }, { status: 'en_revision' });
    });
  });
});
