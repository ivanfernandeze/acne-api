import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import type { JwtPayload } from 'src/common/interfaces/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import type { User } from 'src/users/user.entity';
import { UsersService } from 'src/users/users.service';

import type { LoginDto, LoginResponseDto } from './dto/auth.dto';

/** Covers: RF-TR-02 (JWT + roles). */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly encryption: EncryptionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.usersService.findByEmailWithSecret(dto.email);
    // The same message for "unknown email" and "wrong password" so the endpoint does not confirm
    // which accounts exist.
    const invalid = new UnauthorizedException('Credenciales inválidas.');
    if (user === null) throw invalid;
    if (!this.encryption.verifyPassword(dto.password, user.passwordHash)) throw invalid;
    if (!user.active) throw new UnauthorizedException('La cuenta está desactivada.');

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<LoginResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.jwt.secret,
      });
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado.');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Se requiere un token de refresco.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user.active) throw new UnauthorizedException('La cuenta está desactivada.');
    return this.issueTokens(user);
  }

  /**
   * Tokens carry `studyMode` so that `StudyModeGuard` can decide without a database round trip on
   * every request. The trade-off is that a mode change only takes effect on the next token, which
   * is exactly what the experiment wants: the condition stays stable for the whole session
   * instead of flipping mid-review and splitting one measurement across two conditions.
   */
  private async issueTokens(user: User): Promise<LoginResponseDto> {
    const base = {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...base, type: 'access' } satisfies JwtPayload,
        { secret: this.config.jwt.secret, expiresIn: this.config.jwt.accessTtl },
      ),
      this.jwtService.signAsync(
        { ...base, type: 'refresh' } satisfies JwtPayload,
        { secret: this.config.jwt.secret, expiresIn: this.config.jwt.refreshTtl },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseTtlSeconds(this.config.jwt.accessTtl),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  private parseTtlSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (match === null) return 1800;
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return amount * multiplier;
  }
}
