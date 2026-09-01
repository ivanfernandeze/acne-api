import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { CASE_STATUSES, STUDY_MODES, type CaseStatus, type StudyMode } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import { CasesService } from './cases.service';
import { CaseDetailDto, CaseSummaryDto, CreateCaseDto, UpdateCaseDto } from './dto/case.dto';

/** Covers: RF-TR-01, RF-TR-03, OE1 (apertura cronometrada). */
@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
export class CasesController {
  constructor(
    private readonly casesService: CasesService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiQuery({ name: 'studyMode', required: false, enum: STUDY_MODES })
  @ApiQuery({ name: 'status', required: false, enum: CASE_STATUSES })
  @ApiQuery({ name: 'mine', required: false, type: Boolean })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiQuery({
    name: 'pending',
    required: false,
    type: Boolean,
    description:
      'Deja solo los casos que aún no tienen medición bajo la condición actual del usuario. ' +
      'Es la bandeja de trabajo real: primero la pasada de pretest sobre los 30 casos, después ' +
      'la de postest sobre esos mismos 30.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Busca por código de caso, código de paciente o nombre del paciente.',
  })
  @ApiOperation({
    summary: 'Bandeja de casos con filtro por modo de estudio (Sección 9.3).',
    description:
      'Para `dermatologo` y `residente` cada caso incluye `patientName` descifrado, de modo que ' +
      'la bandeja se pueda leer por nombre y no solo por código (RF-TR-03). Para el resto de ' +
      'roles llega en `null`.',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Query('studyMode') studyMode?: StudyMode,
    @Query('status') status?: CaseStatus,
    @Query('mine') mine?: string,
    @Query('includeSynthetic') includeSynthetic?: string,
    @Query('pending') pending?: string,
    @Query('search') search?: string,
  ): Promise<CaseSummaryDto[]> {
    const maySeeIdentity = user.role === 'dermatologo' || user.role === 'residente';

    const cases = await this.casesService.findAll({
      studyMode,
      status,
      assignedUserId: mine === 'true' ? user.id : undefined,
      includeSynthetic: includeSynthetic === 'true',
      pendingForMode: pending === 'true' ? user.studyMode : undefined,
      revealIdentity: maySeeIdentity,
      search,
    });

    if (maySeeIdentity) {
      // One entry per listing, not per case: a per-row log would bury the targeted
      // `patient.identity.read` events under the noise of every tray refresh.
      await this.auditService.record(
        user,
        {
          action: 'case.list.identity',
          entityType: 'case',
          metadata: { count: cases.length, search: search ?? null },
        },
        request,
      );
    }
    return cases;
  }

  @Post()
  @Roles('dermatologo', 'residente', 'admin')
  @ApiOperation({
    summary: 'Crea un caso clínico bajo la condición experimental actual del usuario.',
    description:
      'El caso queda sellado con el `study_mode` de quien lo crea y lo conserva de por vida: es ' +
      'lo que permite que las mediciones de pretest y postest sean pareables.',
  })
  async create(
    @Body() dto: CreateCaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaseSummaryDto> {
    const created = await this.casesService.create(dto, user);
    await this.auditService.record(
      user,
      {
        action: 'case.create',
        entityType: 'case',
        entityId: created.id,
        metadata: { caseCode: created.caseCode, studyMode: created.studyMode },
      },
      request,
    );
    return created;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ficha completa del caso.',
    description:
      'El bloque de IA viene en `null` y `aiVisible` en `false` cuando el solicitante opera en ' +
      'pretest, en coherencia con el 403 que devuelven las rutas de inferencia (RF-TR-01).',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaseDetailDto> {
    const detail = await this.casesService.findOne(id, user);
    await this.auditService.record(
      user,
      { action: 'case.read', entityType: 'case', entityId: id },
      request,
    );
    return detail;
  }

  @Post(':id/open')
  @Roles('dermatologo', 'residente')
  @ApiOperation({
    summary: 'Abre la ficha e inicia el cronómetro de revisión (RF-OE1-01).',
    description:
      'Sella t₀ en el servidor. Es idempotente por caso y modo: reabrir o recargar no reinicia ' +
      'el reloj, de modo que un refresco no puede acortar artificialmente el tiempo medido.',
  })
  async open(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaseDetailDto> {
    const detail = await this.casesService.open(id, user);
    await this.auditService.record(
      user,
      {
        action: 'case.open',
        entityType: 'case',
        entityId: id,
        metadata: { studyMode: user.studyMode, t0: detail.timing?.t0 },
      },
      request,
    );
    return detail;
  }

  @Post(':id/close')
  @Roles('dermatologo', 'residente', 'admin')
  @ApiOperation({ summary: 'Cierra el caso una vez diagnosticado.' })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaseSummaryDto> {
    const closed = await this.casesService.close(id);
    await this.auditService.record(
      user,
      { action: 'case.close', entityType: 'case', entityId: id },
      request,
    );
    return closed;
  }

  @Patch(':id')
  @Roles('dermatologo', 'admin')
  @ApiOperation({ summary: 'Actualiza el patrón de consenso o la asignación del caso.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<CaseSummaryDto> {
    const updated = await this.casesService.update(id, dto);
    await this.auditService.record(
      user,
      { action: 'case.update', entityType: 'case', entityId: id, metadata: { ...dto } },
      request,
    );
    return updated;
  }
}
