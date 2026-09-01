import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { Public } from 'src/common/decorators';
import type { AuthenticatedRequest } from 'src/common/interfaces/authenticated-user';

import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto, RefreshDto } from './dto/auth.dto';

/** Covers: RF-TR-02. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica al personal y emite los tokens de acceso y refresco.' })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto);
    await this.auditService.record(
      { ...result.user },
      { action: 'auth.login', entityType: 'user', entityId: result.user.id },
      request,
    );
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renueva el token de acceso a partir de un token de refresco.' })
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(@Body() dto: RefreshDto): Promise<LoginResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }
}
