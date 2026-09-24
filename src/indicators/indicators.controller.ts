import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { ANALYSIS_ROLES, CONTRAST_ROLES, INDICATORS, type ExperimentalMode, type IndicatorKey } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import {
  ClassificationReportDto,
  DashboardDto,
  IndicatorByProfessionalDto,
  IndicatorComparisonDto,
} from './dto/indicator.dto';
import { IndicatorsService } from './indicators.service';

/** Covers: OE1, OE2, OE3, OE4 (RF-OE1-03, RF-OE2-03, RF-OE2-04, RF-OE3-03, RF-OE4-02). */
@ApiTags('indicators')
@ApiBearerAuth()
@Controller('indicators')
export class IndicatorsController {
  constructor(
    private readonly indicatorsService: IndicatorsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('dashboard')
  @Roles(...ANALYSIS_ROLES)
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'TRM, TPD, TSP y TCAD por modo, con comparativa y alertas de meta.',
    description:
      'Los datos sintéticos de demostración quedan fuera salvo que se pidan explícitamente, ' +
      'para que el tablero nunca muestre como evidencia lo que es una semilla.',
  })
  async dashboard(@Query('includeSynthetic') includeSynthetic?: string): Promise<DashboardDto> {
    return this.indicatorsService.dashboard({ includeSynthetic: includeSynthetic === 'true' });
  }

  @Get('comparison/:indicator')
  @Roles(...ANALYSIS_ROLES)
  @ApiParam({ name: 'indicator', enum: INDICATORS })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({ summary: 'Comparativa pretest vs postest de un indicador.' })
  async comparison(
    @Param('indicator') indicator: IndicatorKey,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<IndicatorComparisonDto> {
    return this.indicatorsService.compare(indicator, {
      includeSynthetic: includeSynthetic === 'true',
    });
  }

  @Get('classification/:studyMode')
  @Roles(...ANALYSIS_ROLES)
  @ApiParam({ name: 'studyMode', enum: ['pretest', 'postest'] })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Matriz de confusión y métricas por clase IGA (RF-OE2-04).',
    description: 'Exactitud, sensibilidad, especificidad, F1 por clase y F1 macro sobre 5 clases.',
  })
  async classification(
    @Param('studyMode') studyMode: ExperimentalMode,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<ClassificationReportDto> {
    return this.indicatorsService.classificationReport(studyMode, {
      includeSynthetic: includeSynthetic === 'true',
    });
  }

  @Get('by-professional/:indicator')
  @Roles(...ANALYSIS_ROLES)
  @ApiParam({ name: 'indicator', enum: INDICATORS })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({ summary: 'Desglose por profesional para los boxplots comparativos (RF-OE4-04).' })
  async byProfessional(
    @Param('indicator') indicator: IndicatorKey,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<IndicatorByProfessionalDto[]> {
    return this.indicatorsService.byProfessional(indicator, {
      includeSynthetic: includeSynthetic === 'true',
    });
  }

  @Post('snapshot')
  @Roles(...CONTRAST_ROLES)
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Congela el estado actual de los indicadores como log inmutable (RNF-05).',
    description:
      'Deja constancia de qué valor tenía cada indicador, con qué insumos y en qué momento, para ' +
      'que un evaluador externo pueda reproducir la cifra citada en la tesis.',
  })
  async snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<{ snapshots: number }> {
    const count = await this.indicatorsService.snapshotAll(
      user.id,
      includeSynthetic === 'true',
    );
    await this.auditService.record(
      user,
      { action: 'indicators.snapshot', entityType: 'indicator_snapshot', metadata: { count } },
      request,
    );
    return { snapshots: count };
  }
}
