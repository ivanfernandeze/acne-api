import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import type { AuthenticatedRequest, AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import { CreateUserDto, SetStudyModeDto, UpdateUserDto, UserResponseDto } from './dto/user.dto';
import { UsersService } from './users.service';

/** Covers: RF-TR-01, RF-TR-02, RNF-07. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Lista el personal del estudio (solo admin).' })
  async findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Registra un nuevo integrante del personal (solo admin).' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    const created = await this.usersService.create(dto);
    await this.auditService.record(
      actor,
      { action: 'user.create', entityType: 'user', entityId: created.id, metadata: { role: created.role } },
      request,
    );
    return created;
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Actualiza datos de un usuario (solo admin).' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    const updated = await this.usersService.update(id, dto);
    await this.auditService.record(
      actor,
      { action: 'user.update', entityType: 'user', entityId: id },
      request,
    );
    return updated;
  }

  @Get('me')
  @ApiOperation({ summary: 'Devuelve el perfil autenticado y su condición experimental actual.' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return this.usersService.toResponse(await this.usersService.findById(user.id));
  }

  @Patch('me/study-mode')
  @ApiOperation({
    summary: 'Cambia el modo de estudio del usuario autenticado (RF-TR-01).',
    description:
      'Cambiar de pretest a postest equivale a aplicar la intervención X del diseño ' +
      'preexperimental, por lo que la acción queda registrada en la traza de auditoría. ' +
      'El nuevo modo solo surte efecto en los tokens emitidos después del cambio.',
  })
  async setStudyMode(
    @Body() dto: SetStudyModeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    const previous = user.studyMode;
    const updated = await this.usersService.setStudyMode(user.id, dto.studyMode);
    await this.auditService.record(
      user,
      {
        action: 'user.study_mode.change',
        entityType: 'user',
        entityId: user.id,
        metadata: { from: previous, to: dto.studyMode, requirement: 'RF-TR-01' },
      },
      request,
    );
    return this.usersService.toResponse(updated);
  }

  @Post('me/consent')
  @ApiOperation({ summary: 'Registra el consentimiento informado del profesional (RNF-07).' })
  async acceptConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    const updated = await this.usersService.acceptConsent(user.id);
    await this.auditService.record(
      user,
      { action: 'user.consent.accept', entityType: 'user', entityId: user.id },
      request,
    );
    return this.usersService.toResponse(updated);
  }
}
