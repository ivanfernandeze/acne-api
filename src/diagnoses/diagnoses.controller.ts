import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import type { StudyMode } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import { DiagnosesService } from './diagnoses.service';
import { Anexo5RowDto, DiagnosisDto, SubmitDiagnosisDto } from './dto/diagnosis.dto';

/** Covers: OE2 (RF-OE2-01, RF-OE2-02) and OE1 (cierre del cronómetro). */
@ApiTags('diagnoses')
@ApiBearerAuth()
@Controller('diagnoses')
export class DiagnosesController {
  constructor(
    private readonly diagnosesService: DiagnosesService,
    private readonly auditService: AuditService,
  ) {}

  @Post('case/:caseId')
  @Roles('dermatologo', 'residente')
  @ApiOperation({
    summary: 'Emite el diagnóstico definitivo del especialista y cierra la medición.',
    description:
      'En una sola operación: registra el juicio de referencia, sella t₁ del cronómetro (OE1), ' +
      'congela la concordancia contra el patrón del lote (OE2) y suma el caso a NCR de la ' +
      'jornada abierta (OE4).',
  })
  async submit(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: SubmitDiagnosisDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<DiagnosisDto> {
    const diagnosis = await this.diagnosesService.submit(caseId, dto, user.id, user.studyMode);
    await this.auditService.record(
      user,
      {
        action: 'diagnosis.submit',
        entityType: 'diagnosis',
        entityId: diagnosis.id,
        metadata: {
          caseId,
          igaClass: dto.igaClass,
          studyMode: user.studyMode,
          reviewMinutes: diagnosis.reviewMinutes,
        },
      },
      request,
    );
    return diagnosis;
  }

  @Get('case/:caseId')
  @ApiOperation({ summary: 'Lista los diagnósticos emitidos sobre un caso.' })
  async findByCase(@Param('caseId', ParseUUIDPipe) caseId: string): Promise<DiagnosisDto[]> {
    const diagnoses = await this.diagnosesService.findByCase(caseId);
    return diagnoses.map((d) => this.diagnosesService.toDto(d, '', '', null));
  }

  @Get('anexo-5')
  @ApiQuery({ name: 'studyMode', required: false })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Anexo 5 digitalizado — ficha de registro de precisión del diagnóstico.',
    description:
      'N.º, fecha, diagnóstico IA, diagnóstico de referencia y resultado. El campo `standard` ' +
      'declara explícitamente contra qué patrón se evaluó cada fila.',
  })
  async anexo5(
    @Query('studyMode') studyMode?: StudyMode,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<Anexo5RowDto[]> {
    return this.diagnosesService.anexo5Rows(studyMode ?? null, includeSynthetic === 'true');
  }
}
