import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { iiaValue, type StudyMode } from 'src/common/domain';

import type { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto/user.dto';
import { User } from './user.entity';

/** Covers: RF-TR-01 (per-user study mode) and RF-TR-02 (roles). */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repository: Repository<User>,
    private readonly encryption: EncryptionService,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const existing = await this.repository.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing !== null) {
      throw new BadRequestException(`Ya existe un usuario con el correo ${dto.email}.`);
    }

    const user = this.repository.create({
      email: dto.email.toLowerCase(),
      passwordHash: this.encryption.hashPassword(dto.password),
      fullName: dto.fullName,
      role: dto.role,
      studyMode: dto.studyMode ?? 'produccion',
      specialty: dto.specialty ?? null,
      active: true,
    });
    return this.toResponse(await this.repository.save(user));
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

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.repository.find({ order: { fullName: 'ASC' } });
    return users.map((user) => this.toResponse(user));
  }

  /** Professionals whose measurements feed the indicators (dermatologists and residents). */
  async findDiagnosingStaff(): Promise<User[]> {
    return this.repository
      .createQueryBuilder('user')
      .where('user.role IN (:...roles)', { roles: ['dermatologo', 'residente'] })
      .orderBy('user.fullName', 'ASC')
      .getMany();
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.findById(id);
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.specialty !== undefined) user.specialty = dto.specialty;
    return this.toResponse(await this.repository.save(user));
  }

  /** RF-TR-01. Returns the updated user so the caller can reissue a token carrying the new mode. */
  async setStudyMode(id: string, studyMode: StudyMode): Promise<User> {
    const user = await this.findById(id);
    user.studyMode = studyMode;
    return this.repository.save(user);
  }

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
      studyMode: user.studyMode,
      specialty: user.specialty,
      active: user.active,
      iia: iiaValue(user.studyMode),
      consentAcceptedAt: user.consentAcceptedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
