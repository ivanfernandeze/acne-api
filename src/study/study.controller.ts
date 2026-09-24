import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from 'src/common/decorators';
import { ANALYSIS_ROLES, DIAGNOSING_ROLES, GENERAL_HYPOTHESIS, HYPOTHESIS_STATEMENTS, INDICATOR_DEFINITIONS, STUDY_MODE_LABELS, SYSTEM_MEASUREMENT_MODE, STUDY_ROLES, iiaValue, type StudyMode } from 'src/common/domain';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import { Anexo4RowDto, StudyDesignDto } from './dto/anexo4.dto';
import { ReviewTimingService } from './review-timing.service';

/** Covers: OE1 (RF-OE1-02) and RF-TR-01. */
@ApiTags('study')
@ApiBearerAuth()
@Controller('study')
export class StudyController {
  constructor(private readonly reviewTimingService: ReviewTimingService) {}

  @Get('design')
  @Roles(...STUDY_ROLES)
  @ApiOperation({
    summary: 'Describe el diseño experimental y la condición actual del usuario.',
    description:
      'Diseño preexperimental pretest-postest de un solo grupo (G: O₁ → X → O₂). El portal usa ' +
      'esta respuesta para decidir si muestra u oculta el módulo de IA.',
  })
  design(@CurrentUser() _user: AuthenticatedUser): StudyDesignDto {
    return {
      design: 'preexperimental_pretest_postest_un_grupo',
      schema: 'G: O₁ → X → O₂',
      sampleSize: 30,
      // El pretest es la evaluación MANUAL de la clínica y no ocurre aquí dentro, de modo que
      // toda medición que este sistema produce es postest y la IA está siempre disponible.
      currentStudyMode: SYSTEM_MEASUREMENT_MODE,
      currentStudyModeLabel: STUDY_MODE_LABELS[SYSTEM_MEASUREMENT_MODE],
      iia: iiaValue(SYSTEM_MEASUREMENT_MODE),
      aiEnabled: true,
      generalHypothesis: GENERAL_HYPOTHESIS,
      specificHypotheses: HYPOTHESIS_STATEMENTS,
      indicators: Object.values(INDICATOR_DEFINITIONS),
    };
  }

  @Get('anexo-4')
  @Roles(...ANALYSIS_ROLES)
  @ApiQuery({ name: 'studyMode', required: false, enum: ['pretest', 'postest', 'produccion'] })
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Anexo 4 digitalizado — ficha de registro de tiempo de revisión médica.',
    description:
      'Devuelve exactamente los campos del instrumento en papel: N.º, fecha, N.º de caso / ID de ' +
      'paciente, hora de inicio de revisión y tiempo de revisión en minutos (RF-OE1-02).',
  })
  async anexo4(
    @Query('studyMode') studyMode?: StudyMode,
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<Anexo4RowDto[]> {
    return this.reviewTimingService.anexo4Rows(
      studyMode ?? null,
      includeSynthetic === 'true',
    );
  }

  @Patch('timings/:id/invalidate')
  @Roles(...DIAGNOSING_ROLES, 'admin')
  @ApiOperation({
    summary: 'Marca una medición de tiempo como inválida.',
    description:
      'Una revisión abandonada o interrumpida no representa el tiempo real de diagnóstico. ' +
      'Invalidarla la excluye del cálculo de TRM sin borrar el registro, que se conserva como ' +
      'evidencia auditable.',
  })
  async invalidate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('notes') notes?: string,
  ): Promise<{ id: string; valid: boolean }> {
    const timing = await this.reviewTimingService.invalidate(
      id,
      notes ?? 'Revisión interrumpida; excluida del cálculo de TRM.',
    );
    return { id: timing.id, valid: timing.valid };
  }
}

