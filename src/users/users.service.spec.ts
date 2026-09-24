import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import type { Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import type { AppConfig } from 'src/config/configuration';

import { UpdateUserDto } from './dto/user.dto';
import { User } from './user.entity';
import { UsersService } from './users.service';

/**
 * The maintainer is the first screen that lets one person rewrite another person's account, so the
 * tests here are mostly about what it must REFUSE.
 */
const ACTOR = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000002';

const config = {
  security: { encryptionKey: '00'.repeat(32) },
} as unknown as AppConfig;

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: OTHER,
    email: 'dermatologo2@centro.pe',
    passwordHash: '',
    fullName: 'Dr. Luis Campos Ríos',
    role: 'dermatologo',
    specialty: null,
    encryptedPhone: null,
    active: true,
    isSynthetic: false,
    signaturePath: null,
    signatureUpdatedAt: null,
    consentAcceptedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  service: UsersService;
  repository: Repository<User>;
  encryption: EncryptionService;
  saved: User[];
}

function build(stored: User = buildUser()): Harness {
  const encryption = new EncryptionService(config);
  const saved: User[] = [];

  // `findByIdWithSecret` and the filtered `findAll` both go through a query builder; the chain is
  // fluent, so every method returns the same object and only the terminals resolve.
  const builder = {
    addSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(stored),
    getMany: jest.fn().mockResolvedValue([stored]),
  };

  const repository = {
    findOne: jest.fn().mockResolvedValue(stored),
    // `create` de TypeORM solo construye la instancia; no toca la base. Devolver el literal tal
    // cual basta y deja que `save` registre lo que realmente se iba a escribir.
    create: jest.fn().mockImplementation((data: Partial<User>) => ({ ...buildUser(), ...data })),
    save: jest.fn().mockImplementation((user: User) => {
      saved.push({ ...user });
      return Promise.resolve(user);
    }),
    createQueryBuilder: jest.fn().mockReturnValue(builder),
  } as unknown as Repository<User>;

  return { service: new UsersService(repository, encryption), repository, encryption, saved };
}

describe('UsersService', () => {
  describe('update', () => {
    it('refuses to let an administrator deactivate their own account', async () => {
      // The only way back from this is another administrator, and a single-admin deployment would
      // simply lose its way in.
      const { service } = build(buildUser({ id: ACTOR }));

      await expect(service.update(ACTOR, { active: false }, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses to let an administrator change their own role', async () => {
      const { service } = build(buildUser({ id: ACTOR, role: 'admin' }));

      await expect(
        service.update(ACTOR, { role: 'dermatologo' }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an administrator deactivate someone else', async () => {
      const { service, saved } = build(buildUser({ id: OTHER }));

      await service.update(OTHER, { active: false }, ACTOR);

      expect(saved[0]?.active).toBe(false);
    });

    it('rejects an email that already belongs to another account', async () => {
      const target = buildUser({ id: OTHER });
      const { service, repository } = build(target);
      (repository.findOne as jest.Mock)
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(buildUser({ id: ACTOR, email: 'ocupado@centro.pe' }));

      await expect(
        service.update(OTHER, { email: 'ocupado@centro.pe' }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts re-saving the account with its own email', async () => {
      // Resubmitting the form without touching the address must not look like a duplicate.
      const target = buildUser({ id: OTHER, email: 'dermatologo2@centro.pe' });
      const { service, repository, saved } = build(target);
      (repository.findOne as jest.Mock).mockResolvedValue(target);

      await service.update(OTHER, { email: 'Dermatologo2@Centro.pe' }, ACTOR);

      expect(saved[0]?.email).toBe('dermatologo2@centro.pe');
    });
  });

  describe('changePassword', () => {
    function withPassword(current: string): Harness {
      const encryption = new EncryptionService(config);
      const stored = buildUser({ passwordHash: encryption.hashPassword(current) });
      return build(stored);
    }

    it('changes the password when the current one matches', async () => {
      const { service, saved, encryption } = withPassword('ClaveVieja123');

      await service.changePassword(OTHER, {
        currentPassword: 'ClaveVieja123',
        newPassword: 'ClaveNueva456',
      });

      expect(encryption.verifyPassword('ClaveNueva456', saved[0]?.passwordHash ?? '')).toBe(true);
    });

    it('rejects a wrong current password with 400 and NEVER 401', async () => {
      // The web client calls `clearSession()` on any 401. Answering 401 here would throw someone
      // out of their session for mistyping — the assertion is on the exception type for that
      // reason, not for tidiness.
      const { service } = withPassword('ClaveVieja123');

      await expect(
        service.changePassword(OTHER, {
          currentPassword: 'equivocada',
          newPassword: 'ClaveNueva456',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects reusing the same password', async () => {
      const { service } = withPassword('ClaveVieja123');

      await expect(
        service.changePassword(OTHER, {
          currentPassword: 'ClaveVieja123',
          newPassword: 'ClaveVieja123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * El alcance de quien solo administra el mostrador.
   *
   * Es la regla que hace seguro poner el alta de técnicos en el portal del especialista: sin ella,
   * abrirle `POST /users` le habría dejado crearse un administrador. Se prueba aquí y no en la
   * pantalla porque el desplegable con una sola opción no impide un `curl`.
   */
  describe('alcance de gestionar_tecnicos', () => {
    const nuevoTecnico = {
      email: 'admision@centro.pe',
      password: 'ClaveSegura123',
      fullName: 'Rosa Quispe Mamani',
      role: 'tecnico' as const,
      phone: '+51987654321',
    };

    it('deja al especialista crear una cuenta de mostrador', async () => {
      const { service, repository, saved } = build();
      (repository.findOne as jest.Mock).mockResolvedValueOnce(null);

      const created = await service.create(nuevoTecnico, 'dermatologo');

      expect(created.role).toBe('tecnico');
      expect(saved[0]?.role).toBe('tecnico');
    });

    it.each(['admin', 'dermatologo'] as const)(
      'le niega al especialista crear un %s',
      async (role) => {
        const { service, repository } = build();
        (repository.findOne as jest.Mock).mockResolvedValueOnce(null);

        await expect(
          service.create({ ...nuevoTecnico, role }, 'dermatologo'),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('guarda el teléfono cifrado, no en claro', async () => {
      // Un directorio del personal en claro es lo que la Ley N.º 29733 pide no dejar por ahí.
      const { service, repository, saved, encryption } = build();
      (repository.findOne as jest.Mock).mockResolvedValueOnce(null);

      const created = await service.create(nuevoTecnico, 'admin');

      expect(saved[0]?.encryptedPhone).not.toBe(nuevoTecnico.phone);
      expect(encryption.decryptOptional(saved[0]?.encryptedPhone ?? null)).toBe(nuevoTecnico.phone);
      expect(created.phone).toBe(nuevoTecnico.phone);
    });

    it('acota el listado del especialista al mostrador aunque pida otro rol', async () => {
      // Se acota, no se niega: una lista vacía es la respuesta honesta a «enséñame lo que no te
      // corresponde», y un 403 aquí rompería una pantalla legítima por un parámetro de más.
      const { service, repository } = build();

      await expect(service.findAll({ roles: ['admin'] }, 'dermatologo')).resolves.toEqual([]);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('le niega al especialista restablecer la clave de un médico', async () => {
      const { service } = build(buildUser({ id: OTHER, role: 'dermatologo' }));

      await expect(service.resetPassword(OTHER, 'dermatologo')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('resetPassword', () => {
    it('returns a password that actually opens the account', async () => {
      // What the administrator reads on screen has to be what ended up in the database; anything
      // else locks the user out with nobody able to tell why.
      const { service, saved, encryption } = build();

      const issued = await service.resetPassword(OTHER, 'admin');

      expect(issued.length).toBeGreaterThanOrEqual(12);
      expect(encryption.verifyPassword(issued, saved[0]?.passwordHash ?? '')).toBe(true);
    });
  });

  describe('findAll', () => {
    it('answers an all-unknown role filter without touching the database', async () => {
      // `role IN ()` is a syntax error in PostgreSQL. Empty means "nothing matches".
      const { service, repository } = build();

      await expect(service.findAll({ roles: ['no_existe'] })).resolves.toEqual([]);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('UpdateUserDto', () => {
    it('exposes exactly the fields an administrator may correct', () => {
      // Read from the real class-validator metadata, not from a literal written here.
      //
      // `studyMode` must stay absent: moving a professional to postest is applying the
      // intervention X of the pre-experimental design (RF-TR-01), and with
      // `forbidNonWhitelisted: true` the ABSENCE of the property is what returns 400. `password`
      // must stay absent too — resetting a credential has its own endpoint so it can be audited as
      // what it is. Adding either "for convenience" fails here first.
      const properties = new Set(
        getMetadataStorage()
          .getTargetValidationMetadatas(UpdateUserDto, '', false, false)
          .map((metadata) => metadata.propertyName),
      );

      // `phone` sí entra: es un dato de contacto que se corrige como el nombre, y su ausencia
      // no protege ninguna medición del estudio.
      expect(properties).toEqual(
        new Set(['fullName', 'email', 'role', 'active', 'specialty', 'phone']),
      );
    });
  });
});
