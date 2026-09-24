import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { INTAKE_ROLES } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import { AnamnesisService } from './anamnesis.service';
import {
  AnamnesisPrefillDto,
  AnamnesisResponseDto,
  SaveAnamnesisDto,
} from './dto/anamnesis.dto';

/**
 * Acne anamnesis of a case.
 *
 * Covers: extension requested by the research team (see TRACEABILITY.md), feeding RF-OE2-01. Reading
 * and writing it is NOT gated by study mode — the history must look identical in pretest and in
 * postest or the paired contrast would no longer isolate the AI.
 */
@ApiTags('anamnesis')
@ApiBearerAuth()
@Controller()
export class AnamnesisController {
  constructor(
    private readonly anamnesisService: AnamnesisService,
    private readonly auditService: AuditService,
  ) {}

  @Get('cases/:caseId/anamnesis')
  @Roles(...INTAKE_ROLES)
  @ApiOperation({
    summary: 'Anamnesis de acné del caso.',
    description:
      'Devuelve 404 mientras el caso no tenga anamnesis, que es lo normal hasta que el ingreso ' +
      'la registra. El cuestionario nunca condiciona abrir ni revisar el caso.',
  })
  async findOne(
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<AnamnesisResponseDto> {
    return this.anamnesisService.findByCase(caseId);
  }

  @Put('cases/:caseId/anamnesis')
  @Roles(...INTAKE_ROLES)
  @ApiOperation({
    summary: 'Registra o actualiza la anamnesis del caso.',
    description:
      'Valida cada respuesta contra el catálogo de `GET /meta/catalogs`: rechaza claves ' +
      'desconocidas, opciones inexistentes y preguntas que no aplican al sexo y la edad del ' +
      'paciente. Los campos de texto libre no se cifran, de modo que no deben contener nombres ' +
      'ni documentos (Ley N.º 29733).',
  })
  async save(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: SaveAnamnesisDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<AnamnesisResponseDto> {
    const saved = await this.anamnesisService.save(caseId, dto, user.id);
    await this.auditService.record(
      user,
      {
        action: 'anamnesis.save',
        entityType: 'case',
        entityId: caseId,
        metadata: {
          version: saved.version,
          answered: saved.answeredCount,
          applicable: saved.applicableCount,
          complete: saved.complete,
        },
      },
      request,
    );
    return saved;
  }

  @Get('patients/:patientId/anamnesis/latest')
  @Roles(...INTAKE_ROLES)
  @ApiQuery({
    name: 'excludeCaseId',
    required: false,
    description: 'Caso en curso, para no ofrecerse a sí mismo como precarga.',
  })
  // Declared explicitly: the Swagger plugin cannot express `Dto | null` from the return type and
  // would emit an empty schema, which the frontend generator turns into `Record<string, never>`.
  @ApiOkResponse({ type: AnamnesisPrefillDto })
  @ApiOperation({
    summary: 'Última anamnesis del paciente, para precargarla en una visita nueva.',
    description:
      'Devuelve `null` cuando el paciente no tiene visitas previas con anamnesis, que es lo ' +
      'esperable en un primer control y no un error.',
  })
  async latest(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Query('excludeCaseId') excludeCaseId?: string,
  ): Promise<AnamnesisPrefillDto | null> {
    const prefill = await this.anamnesisService.latestForPatient(patientId, excludeCaseId);
    if (prefill !== null) {
      await this.auditService.record(
        user,
        {
          action: 'anamnesis.prefill',
          entityType: 'patient',
          entityId: patientId,
          metadata: { fromCaseId: prefill.caseId },
        },
        request,
      );
    }
    return prefill;
  }
}
