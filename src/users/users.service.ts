import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { randomBytes } from 'node:crypto';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { can, USER_ROLES, type UserRole } from 'src/common/domain';

import type {
  ChangePasswordDto,
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
} from './dto/user.dto';
import { User } from './user.entity';

/**
 * Los roles que puede ver y crear quien está pidiendo.
 *
 * Es LA regla de alcance, y vive en el servidor porque una pantalla que solo ofrece «técnico» en
 * el desplegable no impide nada: basta con un `curl`. Quien tiene `gestionar_usuarios` administra
 * a todo el personal; quien solo tiene `gestionar_tecnicos` —el especialista— administra el
 * mostrador y nada más, de modo que no puede fabricarse un administrador ni tocar a otro médico.
 */
export function manageableRoles(actorRole: UserRole): readonly UserRole[] {
  if (can(actorRole, 'gestionar_usuarios')) return USER_ROLES;
  if (can(actorRole, 'gestionar_tecnicos')) return ['tecnico'];
  return [];
}

/** Filters the maintainer screens apply to the staff list. */
export interface UserFilters {
  roles?: readonly string[];
  active?: boolean;
  search?: string;
}

/** Covers: RF-TR-01 (per-user study mode) and RF-TR-02 (roles). */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repository: Repository<User>,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * @param actorRole quién lo está creando. Decide QUÉ roles puede crear, y por eso no es opcional:
   *   un parámetro que se pudiera omitir acabaría omitido en la próxima ruta que se añada.
   */
  async create(dto: CreateUserDto, actorRole: UserRole): Promise<UserResponseDto> {
    this.assertMayManage(actorRole, dto.role);

    const existing = await this.repository.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing !== null) {
      throw new BadRequestException(`Ya existe un usuario con el correo ${dto.email}.`);
    }

    const user = this.repository.create({
      email: dto.email.toLowerCase(),
      passwordHash: this.encryption.hashPassword(dto.password),
      fullName: dto.fullName,
      role: dto.role,
      specialty: dto.specialty ?? null,
      encryptedPhone: this.encryption.encryptOptional(dto.phone),
      active: true,
    });
    return this.toResponse(await this.repository.save(user));
  }

  /** Se niega con el rol escrito en el mensaje: «no autorizado» a secas no dice qué intentó. */
  private assertMayManage(actorRole: UserRole, targetRole: UserRole): void {
    const allowed = manageableRoles(actorRole);
    if (!allowed.includes(targetRole)) {
      throw new ForbiddenException(
        `Su rol solo puede administrar cuentas de: ${allowed.join(', ') || 'ninguna'}. ` +
          `Pida a un administrador que cree la cuenta de «${targetRole}».`,
      );
    }
  }

  /** Includes `passwordHash`, which is `select: false` by default. Used only by AuthService. */
  async findByEmailWithSecret(email: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  async findById(id: string): Promise<User> {
    const user = await this.repository.findOne({ where: { id } });
    if (user === null) throw new NotFoundException(`No existe el usuario ${id}.`);
    return user;
  }

  /** Includes `passwordHash`. Used only where a credential is verified or replaced. */
  private async findByIdWithSecret(id: string): Promise<User> {
    const user = await this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
    if (user === null) throw new NotFoundException(`No existe el usuario ${id}.`);
    return user;
  }

  /**
   * The staff list, optionally narrowed.
   *
   * Inactive users are included unless asked otherwise: a maintainer whose list hides the accounts
   * it is meant to reactivate would be useless, and `active` is this system's only tombstone.
   */
  async findAll(filters: UserFilters = {}, actorRole?: UserRole): Promise<UserResponseDto[]> {
    // Resolved BEFORE any query is built: `role IN ()` is a syntax error in PostgreSQL, so an
    // all-unknown filter is answered here rather than handed to the database. Empty means
    // "nothing matches", never "no filter".
    let roles: UserRole[] | undefined;
    if (filters.roles !== undefined) {
      roles = filters.roles.filter((role): role is UserRole =>
        (USER_ROLES as readonly string[]).includes(role),
      );
      if (roles.length === 0) return [];
    }

    /*
     * El alcance del solicitante se INTERSECA con lo que pidió, nunca lo reemplaza.
     *
     * Así el especialista que abre su sección de técnicos ve técnicos, y el que se inventa
     * `?role=admin` sigue viendo técnicos en vez de un 403 — la lista se acota, no se niega,
     * porque una lista vacía es la respuesta honesta a «enséñame lo que no te corresponde».
     */
    if (actorRole !== undefined) {
      const allowed = manageableRoles(actorRole);
      roles = (roles ?? [...USER_ROLES]).filter((role) => allowed.includes(role));
      if (roles.length === 0) return [];
    }

    const query = this.repository.createQueryBuilder('user').orderBy('user.fullName', 'ASC');
    if (roles !== undefined) query.andWhere('user.role IN (:...roles)', { roles });

    if (filters.active !== undefined) {
      query.andWhere('user.active = :active', { active: filters.active });
    }

    const search = filters.search?.trim() ?? '';
    if (search !== '') {
      // `unaccent` en AMBOS lados: limpiar solo el término dejaría el problema simétrico, y quien
      // sí escribe la tilde no encontraría lo guardado sin ella.
      query.andWhere(
        '(unaccent(user.fullName) ILIKE unaccent(:term) OR unaccent(user.email) ILIKE unaccent(:term))',
        { term: `%${search}%` },
      );
    }

    const users = await query.getMany();
    return users.map((user) => this.toResponse(user));
  }

  /**
   * @param actorId the administrator making the change, so the two self-inflicted lockouts can be
   *   refused. Only an `admin` reaches this route, so refusing self-deactivation and a self role
   *   change is enough: any other target leaves the acting administrator active and an admin.
   */
  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserResponseDto> {
    const user = await this.findById(id);

    if (id === actorId && dto.active === false) {
      throw new BadRequestException(
        'No puede desactivar su propia cuenta. Pida a otro administrador que lo haga.',
      );
    }
    if (id === actorId && dto.role !== undefined && dto.role !== user.role) {
      throw new BadRequestException(
        'No puede cambiar su propio rol. Pida a otro administrador que lo haga.',
      );
    }

    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase();
      const taken = await this.repository.findOne({ where: { email } });
      // Excluding the row itself: re-saving the form without touching the address must not fail.
      if (taken !== null && taken.id !== id) {
        throw new BadRequestException(`Ya existe un usuario con el correo ${dto.email}.`);
      }
      user.email = email;
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.specialty !== undefined) user.specialty = dto.specialty;
    if (dto.phone !== undefined) user.encryptedPhone = this.encryption.encryptOptional(dto.phone);
    return this.toResponse(await this.repository.save(user));
  }

  /**
   * Self-service password change.
   *
   * Fails with 400 and NEVER with 401 when the current password is wrong. The web client calls
   * `clearSession()` on any 401, so answering 401 here would throw someone out of their session for
   * mistyping — losing whatever they had open, over a typo.
   */
  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findByIdWithSecret(id);

    if (!this.encryption.verifyPassword(dto.currentPassword, user.passwordHash)) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La contraseña nueva debe ser distinta de la actual.');
    }

    user.passwordHash = this.encryption.hashPassword(dto.newPassword);
    await this.repository.save(user);
  }

  /**
   * Issues a fresh password for someone else and returns it ONCE, in the clear.
   *
   * Generated, not chosen: an administrator typing a password for another person is how a shared
   * one ends up in a chat. Same generator as the seeder, for the same reason.
   *
   * This does NOT lock an attacker out — `POST /auth/refresh` is public and a stolen refresh token
   * stays valid for its full TTL. That gap is declared in TRACEABILITY.md; closing it needs token
   * revocation, which is a migration.
   */
  async resetPassword(id: string, actorRole: UserRole): Promise<string> {
    const user = await this.findById(id);
    // Restablecer la clave de alguien es tomar su cuenta: el alcance manda aquí igual que al crear.
    this.assertMayManage(actorRole, user.role);
    const password = randomBytes(9).toString('base64url');
    user.passwordHash = this.encryption.hashPassword(password);
    await this.repository.save(user);
    return password;
  }

  /** RF-TR-01. Returns the updated user so the caller can reissue a token carrying the new mode. */

  /** RNF-07: informed consent of the participating medical staff. */
  async acceptConsent(id: string): Promise<User> {
    const user = await this.findById(id);
    user.consentAcceptedAt = new Date();
    return this.repository.save(user);
  }

  toResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      specialty: user.specialty,
      phone: this.encryption.decryptOptional(user.encryptedPhone),
      active: user.active,
      isSynthetic: user.isSynthetic,
      consentAcceptedAt: user.consentAcceptedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
