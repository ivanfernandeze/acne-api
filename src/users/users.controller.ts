import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import {
  CASE_ACCESS_ROLES,
  TECHNICIAN_ADMIN_ROLES,
  USER_ADMIN_ROLES,
} from 'src/common/domain';
import type { AuthenticatedRequest, AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import {
  ChangePasswordDto,
  CreateUserDto,
  TemporaryPasswordDto,
  UpdateUserDto,
  UserResponseDto,
} from './dto/user.dto';
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

  /**
   * También el especialista, y solo para ver su mostrador.
   *
   * El grupo de roles abre la PUERTA; lo que acota el contenido es `actorRole`, que el servicio
   * usa para intersecar lo pedido con lo que ese rol administra. Un `@Roles` más ancho sin esa
   * intersección le habría dado el listado completo del personal.
   */
  @Get()
  @Roles(...USER_ADMIN_ROLES, ...TECHNICIAN_ADMIN_ROLES)
  @ApiQuery({
    name: 'role',
    required: false,
    description: 'Roles separados por comas, p. ej. `dermatologo,tecnico`.',
  })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false, description: 'Coincide en nombre o correo.' })
  @ApiOperation({ summary: 'Lista el personal del estudio (solo admin).' })
  async findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('role') role?: string,
    @Query('active') active?: string,
    @Query('search') search?: string,
  ): Promise<UserResponseDto[]> {
    return this.usersService.findAll(
      {
        roles: role === undefined || role === '' ? undefined : role.split(','),
        active: active === undefined || active === '' ? undefined : active === 'true',
        search,
      },
      actor.role,
    );
  }

  @Post()
  @Roles(...USER_ADMIN_ROLES, ...TECHNICIAN_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Registra un nuevo integrante del personal.',
    description:
      'El administrador crea cualquier rol; el especialista solo cuentas de `tecnico`. El límite ' +
      'lo pone el servicio y no la pantalla: un desplegable con una sola opción no impide un ' +
      'curl. Cualquier otro rol responde 403 diciendo qué se intentó crear.',
  })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    const created = await this.usersService.create(dto, actor.role);
    await this.auditService.record(
      actor,
      { action: 'user.create', entityType: 'user', entityId: created.id, metadata: { role: created.role } },
      request,
    );
    return created;
  }

  @Get('me')
  // Self-service: every role reads its own profile, none reads anyone else's.
  @Roles(...CASE_ACCESS_ROLES)
  @ApiOperation({ summary: 'Devuelve el perfil autenticado y su condición experimental actual.' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return this.usersService.toResponse(await this.usersService.findById(user.id));
  }


  @Patch('me/password')
  // Every role changes its own password. Before this endpoint nobody could change theirs at all:
  // the seeded ones were printed once and an account that lost its password was simply lost.
  @Roles(...CASE_ACCESS_ROLES)
  @ApiOperation({
    summary: 'Cambia la contraseña del usuario autenticado.',
    description:
      'Exige la contraseña vigente. Si no coincide responde 400, nunca 401: el portal cierra la ' +
      'sesión ante cualquier 401, y equivocarse al teclear no debe costar la sesión.',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ changed: true }> {
    await this.usersService.changePassword(user.id, dto);
    await this.auditService.record(
      user,
      { action: 'user.password.change', entityType: 'user', entityId: user.id },
      request,
    );
    return { changed: true };
  }

  @Post('me/consent')
  // Every member of staff records their own informed consent (RNF-07).
  @Roles(...CASE_ACCESS_ROLES)
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

  // ---------------------------------------------------------------------------
  // Routes with a `:id` parameter go LAST, and this is not a style preference.
  //
  // Nest matches handlers in declaration order. `@Get(':id')` declared above `@Get('me')` swallows
  // `/users/me`, the `ParseUUIDPipe` then rejects the literal "me", and every profile screen in the
  // portal starts answering 400. Anything added below must keep this property.
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @Roles(...USER_ADMIN_ROLES)
  @ApiOperation({ summary: 'Actualiza datos de un usuario (solo admin).' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    const updated = await this.usersService.update(id, dto, actor.id);
    await this.auditService.record(
      actor,
      {
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        // Field NAMES, never their values: the trail says what was touched without copying the
        // data into `audit_logs.metadata`, which is plain jsonb.
        metadata: { fields: Object.keys(dto) },
      },
      request,
    );
    return updated;
  }

  @Get(':id')
  @Roles(...USER_ADMIN_ROLES)
  @ApiOperation({ summary: 'Devuelve un integrante del personal por su id (solo admin).' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.toResponse(await this.usersService.findById(id));
  }

  /**
   * También el especialista, y solo sobre su mostrador.
   *
   * Una cuenta que se crea y luego se queda sin contraseña es una cuenta perdida: si el médico
   * puede darla de alta y no puede devolverle el acceso, el trámite que esto venía a evitar
   * reaparece el primer lunes que alguien olvide su clave.
   */
  @Post(':id/password-reset')
  @Roles(...USER_ADMIN_ROLES, ...TECHNICIAN_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Genera una contraseña nueva para un usuario (solo admin).',
    description:
      'Devuelve la contraseña UNA sola vez; no se almacena en claro ni se registra en la ' +
      'auditoría. No revoca las sesiones vigentes: el token de refresco sigue siendo válido ' +
      'hasta que caduque. Ver la nota de seguridad abierta en TRACEABILITY.md.',
  })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<TemporaryPasswordDto> {
    const password = await this.usersService.resetPassword(id, actor.role);
    await this.auditService.record(
      actor,
      // The generated password is deliberately absent from the metadata.
      { action: 'user.password.reset', entityType: 'user', entityId: id },
      request,
    );
    return { password };
  }
}
