import { BadRequestException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import type { AppConfig } from 'src/config/configuration';

import type { Consent } from './consent.entity';
import { Patient } from './patient.entity';
import { PatientsService } from './patients.service';

/**
 * Two properties are load-bearing here and neither is visible from the outside:
 *
 *  - a correction must NEVER write identity in the clear, and must never blank the encrypted
 *    columns it was not asked to touch (they are `select: false`, so a careless `save` does it);
 *  - the search must work for the roles that cannot see the identity, which is the bug this file
 *    exists to keep fixed.
 */
const ID = 'c0000000-0000-4000-8000-000000000003';

const config = { security: { encryptionKey: '11'.repeat(32) } } as unknown as AppConfig;

function buildPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: ID,
    patientCode: 'PAC-2026-0002',
    encryptedFullName: null,
    encryptedDocumentId: null,
    encryptedPhone: null,
    encryptedEmail: null,
    birthDate: null,
    sex: null,
    fitzpatrickPhototype: null,
    consentAcceptedAt: new Date('2026-01-01T00:00:00Z'),
    withdrawnAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  service: PatientsService;
  repository: Repository<Patient>;
  encryption: EncryptionService;
  /** The patches handed to `repository.update`, which is the whole point of these tests. */
  updates: Array<Record<string, unknown>>;
  savedConsents: Array<Partial<Consent>>;
  saved: Patient[];
}

function build(stored: Patient = buildPatient(), rows: Patient[] = []): Harness {
  const encryption = new EncryptionService(config);
  const updates: Array<Record<string, unknown>> = [];
  const savedConsents: Array<Partial<Consent>> = [];
  const saved: Patient[] = [];

  const builder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getOne: jest.fn().mockResolvedValue(stored),
  };

  const repository = {
    findOne: jest.fn().mockResolvedValue(stored),
    createQueryBuilder: jest.fn().mockReturnValue(builder),
    update: jest.fn().mockImplementation((_where: unknown, patch: Record<string, unknown>) => {
      updates.push(patch);
      return Promise.resolve({ affected: 1 });
    }),
    save: jest.fn().mockImplementation((patient: Patient) => {
      saved.push({ ...patient });
      return Promise.resolve(patient);
    }),
  } as unknown as Repository<Patient>;

  const consents = {
    insert: jest.fn().mockImplementation((row: Partial<Consent>) => {
      savedConsents.push(row);
      return Promise.resolve({});
    }),
    find: jest.fn().mockResolvedValue([]),
  } as unknown as Repository<Consent>;

  // `summaries()` runs one raw query and returns the per-patient case counts.
  const dataSource = { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource;

  return {
    service: new PatientsService(repository, consents, encryption, dataSource),
    repository,
    encryption,
    updates,
    savedConsents,
    saved,
  };
}

describe('PatientsService', () => {
  describe('update', () => {
    it('never persists the name in the clear', async () => {
      const { service, encryption, updates } = build();

      await service.update(ID, { fullName: 'Ana Torres Vega' });

      const written = updates[0]?.encryptedFullName as string;
      expect(written).not.toContain('Ana');
      expect(encryption.decryptOptional(written)).toBe('Ana Torres Vega');
    });

    it('does not touch the encrypted columns it was not asked to change', async () => {
      // The trap: `encrypted_full_name` is `select: false`, so an entity loaded by `findById` does
      // not carry it. Saving that entity back is how a stored name silently becomes null.
      const { service, updates } = build();

      await service.update(ID, { fitzpatrickPhototype: 'IV' });

      expect(updates[0]).toEqual({ fitzpatrickPhototype: 'IV' });
      expect(updates[0]).not.toHaveProperty('encryptedFullName');
      expect(updates[0]).not.toHaveProperty('encryptedDocumentId');
    });

    it('writes nothing at all when the body carries no field', async () => {
      const { service, repository } = build();

      await service.update(ID, {});

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses to edit a patient withdrawn from the study', async () => {
      // Otherwise the withdrawal stops meaning anything: a record excluded from every dataset
      // would still be editable as if it were active.
      const { service } = build(buildPatient({ withdrawnAt: new Date('2026-02-01T00:00:00Z') }));

      await expect(service.update(ID, { sex: 'femenino' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('reinstate', () => {
    it('clears the withdrawal and records why, without erasing the withdrawal itself', async () => {
      // `consents` is append-only: the sequence accepted → withdrew → reinstated IS the evidence
      // RNF-07 asks for. Deleting the middle row would leave a record that looks untouched.
      const { service, saved, savedConsents } = build(
        buildPatient({ withdrawnAt: new Date('2026-02-01T00:00:00Z') }),
      );

      await service.reinstate(ID, 'Retiro registrado por error en la mesa de admisión.', '10.0.0.1');

      expect(saved[0]?.withdrawnAt).toBeNull();
      expect(savedConsents[0]).toMatchObject({
        patientId: ID,
        accepted: true,
        notes: 'Retiro registrado por error en la mesa de admisión.',
        ipAddress: '10.0.0.1',
      });
    });

    it('refuses to reinstate a patient who was never withdrawn', async () => {
      const { service } = build(buildPatient({ withdrawnAt: null }));

      await expect(service.reinstate(ID, 'Un motivo cualquiera.', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    const census = [
      buildPatient({ id: '1', patientCode: 'PAC-2026-0001' }),
      buildPatient({ id: '2', patientCode: 'PAC-2026-0002' }),
      buildPatient({ id: '3', patientCode: 'PAC-2026-0003' }),
    ];

    it('filters by patient code for a role that cannot see the identity', async () => {
      // THE regression. `search` used to be dropped on this branch, so `admin` and
      // `evaluador_estadistico` silently got the whole census back for any term they typed.
      const { service } = build(census[0], census);

      const result = await service.findAll({ search: 'PAC-2026-0002', revealIdentity: false });

      expect(result).toHaveLength(1);
      expect(result[0]?.patientCode).toBe('PAC-2026-0002');
      expect(result[0]?.fullName).toBeNull();
    });

    it('withholds the name unless the identity is explicitly revealed', async () => {
      const named = buildPatient({
        patientCode: 'PAC-2026-0004',
        encryptedFullName: new EncryptionService(config).encryptString('Ana Torres Vega'),
      });
      const { service } = build(named, [named]);

      const hidden = await service.findAll({ revealIdentity: false });
      const shown = await service.findAll({ revealIdentity: true });

      expect(hidden[0]?.fullName).toBeNull();
      expect(shown[0]?.fullName).toBe('Ana Torres Vega');
    });
  });
});
