import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { ANALYSIS_ROLES, JOURNEY_ROLES, SYSTEM_MEASUREMENT_MODE } from 'src/common/domain';
import type { StudyMode } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import { Anexo7RowDto } from './dto/anexo7.dto';
import { CloseSessionDto, OpenSessionDto, WorkSessionDto } from './dto/session.dto';
import { SessionsService } from './sessions.service';

/** Covers: OE4 (RF-OE4-01, RF-OE4-02). */
@ApiTags('sessions')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('active')
  @Roles(...JOURNEY_ROLES)
  @ApiOperation({ summary: 'Devuelve la jornada abierta del profesional, si la hay.' })
  async active(@CurrentUser() user: AuthenticatedUser): Promise<WorkSessionDto | null> {
    const session = await this.sessionsService.findActive(user.id);
    return session === null ? null : this.sessionsService.toResponse(session);
  }

  @Post('open')
  @Roles(...JOURNEY_ROLES)
  @ApiOperation({ summary: 'Abre una jornada de trabajo (RF-OE4-02).' })
  async open(
    @Body() dto: OpenSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkSessionDto> {
    const session = await this.sessionsService.open(user.id, SYSTEM_MEASUREMENT_MODE, dto);
    await this.auditService.record(
      user,
      {
        action: 'session.open',
        entityType: 'work_session',
        entityId: session.id,
        metadata: { shift: dto.shift, studyMode: SYSTEM_MEASUREMENT_MODE },
      },
      request,
    );
    return this.sessionsService.toResponse(session);
  }

  @Post('close')
  @Roles(...JOURNEY_ROLES)
  @ApiOperation({
    summary: 'Cierra la jornada declarando TJ y congela TCAD = NCR / TJ.',
    description:
      'NCR lo cuenta el sistema conforme se cierran casos; TJ lo declara el profesional, tal ' +
      'como establece el instrumento del Anexo 7.',
  })
  async close(
    @Body() dto: CloseSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkSessionDto> {
    const session = await this.sessionsService.close(user.id, dto);
    await this.auditService.record(
      user,
      {
        action: 'session.close',
        entityType: 'work_session',
        entityId: session.id,
        metadata: { ncr: session.casesReviewed, tj: session.declaredDurationHours, tcad: session.tcad },
      },
      request,
    );
    return this.sessionsService.toResponse(session);
  }

  @Get()
  @Roles(...JOURNEY_ROLES)
  @ApiQuery({ name: 'studyMode', required: false })
  @ApiQuery({ name: 'mine', required: false, type: Boolean })
  @ApiOperation({ summary: 'Lista jornadas registradas.' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('studyMode') studyMode?: StudyMode,
    @Query('mine') mine?: string,
  ): Promise<WorkSessionDto[]> {
    const sessions = await this.sessionsService.findAll(
      mine === 'true' ? user.id : undefined,
      studyMode,
    );
    return sessions.map((s) => this.sessionsService.toResponse(s));
  }

  @Get('anexo-7')
  @Roles(...ANALYSIS_ROLES)
  @ApiQuery({ name: 'studyMode', required: false })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Anexo 7 digitalizado — ficha de registro de capacidad de atención.',
    description: 'N.º, fecha, jornada/turno, número de casos revisados (NCR) y duración (TJ).',
  })
  async anexo7(
    @Query('studyMode') studyMode?: StudyMode,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<Anexo7RowDto[]> {
    return this.sessionsService.anexo7Rows(studyMode ?? null, includeSynthetic === 'true');
  }
}
