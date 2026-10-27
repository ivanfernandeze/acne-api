import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import {
  ANALYSIS_ROLES,
  CONTRAST_ROLES,
  HYPOTHESES,
  RAW_EXPORT_ROLES,
  type HypothesisKey,
} from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import {
  DATASET_NAMES,
  DatasetExportService,
  EXPORT_MODES,
  type DatasetName,
  type ExportMode,
} from './dataset-export.service';
import {
  GeneralHypothesisResultDto,
  HypothesisTestRequestDto,
  HypothesisTestResultDto,
} from './dto/stats.dto';
import { StatsService } from './stats.service';

/** Covers: RF-OE1-04, RF-OE2-05, RF-OE3-05, RF-OE4-03, RF-TR-02, RNF-05. */
@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly datasetExport: DatasetExportService,
    private readonly auditService: AuditService,
  ) {}

  @Post('hypothesis')
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRAST_ROLES)
  @ApiOperation({
    summary: 'Contrasta una hipótesis específica (Shapiro-Wilk → t pareada o Wilcoxon).',
    description:
      'Aplica la regla de decisión declarada en la tesis: Shapiro-Wilk sobre las diferencias ' +
      'pareadas y, según el resultado, t de Student para muestras relacionadas o Wilcoxon, al ' +
      'α = 0,05. Cada ejecución deja un registro inmutable en `hypothesis_runs` con los datos ' +
      'exactos, la semilla y la versión de la función (RNF-05).',
  })
  async hypothesis(
    @Body() dto: HypothesisTestRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<HypothesisTestResultDto> {
    const result = await this.statsService.run(dto, user.id);
    await this.auditService.record(
      user,
      {
        action: 'hypothesis.run',
        entityType: 'hypothesis_run',
        entityId: result.id,
        metadata: {
          hypothesis: result.hypothesis,
          testApplied: result.testApplied,
          pValue: result.pValue,
          rejectsNull: result.rejectsNull,
        },
      },
      request,
    );
    return result;
  }

  @Post('hypothesis/all')
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRAST_ROLES)
  @ApiOperation({
    summary: 'Ejecuta HE₁–HE₄ y concluye sobre la hipótesis general H₁ (OG).',
    description: 'Es el "análisis estadístico en un clic" del panel del portal (Sección 9.3).',
  })
  async hypothesisAll(
    @Body() dto: Omit<HypothesisTestRequestDto, 'hypothesis'>,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<GeneralHypothesisResultDto> {
    const result = await this.statsService.runAll(dto, user.id);
    await this.auditService.record(
      user,
      {
        action: 'hypothesis.run_all',
        entityType: 'hypothesis_run',
        metadata: { rejected: result.rejectedCount, total: result.totalCount },
      },
      request,
    );
    return result;
  }

  @Get('hypothesis/history')
  @Roles(...ANALYSIS_ROLES)
  @ApiQuery({ name: 'hypothesis', required: false, enum: HYPOTHESES })
  @ApiOperation({
    summary: 'Historial inmutable de contrastes ejecutados (RNF-05).',
  })
  async history(
    @Query('hypothesis') hypothesis?: HypothesisKey,
  ): Promise<HypothesisTestResultDto[]> {
    return this.statsService.history(hypothesis);
  }

  @Get('dataset-export')
  @Roles(...RAW_EXPORT_ROLES)
  @ApiQuery({ name: 'dataset', required: false, enum: DATASET_NAMES })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: EXPORT_MODES,
    description:
      'Solo tiempos, diagnosticos, jornadas y encuestas. Sin valor, entrega ambas condiciones.',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'xlsx'],
    description: 'xlsx solo para tiempos: la ficha del Anexo 4 con t₀ y t₁ en hora de Lima.',
  })
  @ApiOperation({
    summary: 'Descarga en CSV las mediciones del estudio (solo admin, RF-TR-02).',
    description:
      '`mediciones` entrega el formato ancho, con pretest y postest del mismo caso en una fila: ' +
      'es el que consume directamente un análisis pareado en SPSS o R.',
  })
  async exportDataset(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Query('dataset') dataset?: DatasetName,
    @Query('includeSynthetic') includeSynthetic?: string,
    @Query('mode') mode?: string,
    @Query('format') format?: string,
  ): Promise<void> {
    const name = dataset ?? 'mediciones';
    if (mode !== undefined && mode !== '' && !EXPORT_MODES.includes(mode as ExportMode)) {
      throw new BadRequestException(
        `«${mode}» no es una condición. Use: ${EXPORT_MODES.join(', ')}.`,
      );
    }
    const exportMode = mode === undefined || mode === '' ? null : (mode as ExportMode);
    // Un nombre desconocido dejaba a `queryFor` sin rama que devolver y el driver recibia una
    // consulta indefinida: 500 y un stack trace donde correspondia decir cuales son los datasets.
    if (!DATASET_NAMES.includes(name)) {
      throw new BadRequestException(
        `«${name}» no es un dataset del estudio. Disponibles: ${DATASET_NAMES.join(', ')}.`,
      );
    }
    const asWorkbook = format === 'xlsx';
    if (format !== undefined && format !== '' && format !== 'csv' && !asWorkbook) {
      throw new BadRequestException(`«${format}» no es un formato. Use: csv, xlsx.`);
    }
    // El .xlsx reproduce la ficha del Anexo 4; los demás datasets no tienen un instrumento impreso.
    if (asWorkbook && name !== 'tiempos') {
      throw new BadRequestException(
        'El formato xlsx solo está disponible para el dataset tiempos (Anexo 4).',
      );
    }

    const synthetic = includeSynthetic === 'true';
    const suffix = exportMode === null ? '' : `-${exportMode}`;
    const stamp = new Date().toISOString().slice(0, 10);
    const file = asWorkbook
      ? {
          body: await this.datasetExport.anexo4Workbook(synthetic, exportMode),
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          name: `anexo4-tiempos${suffix}-${stamp}.xlsx`,
        }
      : {
          body: await this.datasetExport.export(name, synthetic, exportMode),
          type: 'text/csv; charset=utf-8',
          name: `dataset-${name}${suffix}-${stamp}.csv`,
        };

    await this.auditService.record(
      user,
      {
        action: 'dataset.export',
        entityType: 'dataset',
        metadata: {
          dataset: name,
          includeSynthetic: synthetic,
          mode: exportMode,
          format: asWorkbook ? 'xlsx' : 'csv',
        },
      },
      request,
    );

    response.setHeader('Content-Type', file.type);
    response.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    response.send(file.body);
  }
}
