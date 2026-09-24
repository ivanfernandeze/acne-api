import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { ANALYSIS_ROLES } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import { REPORT_FILENAMES, REPORT_NAMES, ReportsService, type ReportName } from './reports.service';

/** Covers: RNF-06 y los entregables de la Sección 11. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(...ANALYSIS_ROLES)
  @ApiOperation({ summary: 'Lista los reportes disponibles.' })
  list(): Array<{ name: ReportName; filename: string; objective: string }> {
    return [
      { name: 'indicadores', filename: REPORT_FILENAMES.indicadores, objective: 'OE1–OE4' },
      {
        name: 'contraste-hipotesis',
        filename: REPORT_FILENAMES['contraste-hipotesis'],
        objective: 'OG · HE₁–HE₄',
      },
      { name: 'usabilidad', filename: REPORT_FILENAMES.usabilidad, objective: 'OE3' },
      {
        name: 'evaluacion-modelo',
        filename: REPORT_FILENAMES['evaluacion-modelo'],
        objective: 'OE2',
      },
    ];
  }

  @Get(':report/preview')
  @Roles(...ANALYSIS_ROLES)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiParam({ name: 'report', enum: REPORT_NAMES })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Vista previa HTML del reporte, sin invocar Chromium.',
    description: 'Útil para revisar contenido y maquetación antes de generar el PDF definitivo.',
  })
  async preview(
    @Param('report') report: ReportName,
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<string> {
    return this.reportsService.buildHtml(report, {
      includeSynthetic: includeSynthetic === 'true',
      generatedBy: user.fullName,
      executedBy: user.id,
    });
  }

  @Get(':report/pdf')
  @Roles(...ANALYSIS_ROLES)
  @ApiParam({ name: 'report', enum: REPORT_NAMES })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Genera el PDF del reporte con el disclaimer regulatorio (RNF-06).',
    description:
      'Los cuatro reportes son entregables de la Sección 11 y se adjuntan como anexos digitales ' +
      'de la tesis.',
  })
  async pdf(
    @Param('report') report: ReportName,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<void> {
    const withSynthetic = includeSynthetic === 'true';
    const pdf = await this.reportsService.generate(report, {
      includeSynthetic: withSynthetic,
      generatedBy: user.fullName,
      executedBy: user.id,
    });

    await this.auditService.record(
      user,
      {
        action: 'report.generate',
        entityType: 'report',
        metadata: { report, includeSynthetic: withSynthetic },
      },
      request,
    );

    const stamp = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${REPORT_FILENAMES[report]}-${stamp}.pdf"`,
    );
    response.send(pdf);
  }
}
