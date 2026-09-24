import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuditService } from 'src/audit/audit.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { ANALYSIS_ROLES, LIKERT_ITEMS, LIKERT_SCALE_LABELS, LIKERT_TOTAL_POINTS, SURVEY_ROLES, SYSTEM_MEASUREMENT_MODE } from 'src/common/domain';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from 'src/common/interfaces/authenticated-user';

import {
  SubmitSurveyDto,
  SurveyResponseSummaryDto,
  SurveyStatusDto,
  SurveySummaryDto,
} from './dto/survey.dto';
import { SurveysService } from './surveys.service';

/** Covers: OE3 (Anexo 6). */
@ApiTags('surveys')
@ApiBearerAuth()
@Controller('surveys')
export class SurveysController {
  constructor(
    private readonly surveysService: SurveysService,
    private readonly auditService: AuditService,
  ) {}

  @Get('instrument')
  // Abierto a quien lo responde Y a quien lo analiza: atarlo a STUDY_ROLES dejaba al técnico sin
  // poder leer el cuestionario que ahora tiene que contestar.
  @Roles(...SURVEY_ROLES, ...ANALYSIS_ROLES)
  @ApiOperation({
    summary: 'Devuelve el instrumento del Anexo 6 tal como fue validado.',
    description:
      'El portal renderiza estos textos; nunca los reescribe. El cuestionario existe una sola ' +
      'vez en el sistema, en `common/domain/survey.ts`.',
  })
  instrument(): {
    items: readonly { number: number; text: string }[];
    scale: Record<number, string>;
    totalPoints: number;
  } {
    return {
      items: LIKERT_ITEMS,
      scale: LIKERT_SCALE_LABELS,
      totalPoints: LIKERT_TOTAL_POINTS,
    };
  }

  @Get('status')
  @Roles(...SURVEY_ROLES, ...ANALYSIS_ROLES)
  @ApiOperation({ summary: 'Indica si corresponde aplicar el cuestionario al usuario (RF-OE3-02).' })
  async status(@CurrentUser() user: AuthenticatedUser): Promise<SurveyStatusDto> {
    return this.surveysService.status(user.id);
  }

  @Post()
  @Roles(...SURVEY_ROLES)
  @ApiOperation({ summary: 'Registra las 8 respuestas Likert y calcula TSP del encuestado.' })
  async submit(
    @Body() dto: SubmitSurveyDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): Promise<SurveyResponseSummaryDto> {
    const response = await this.surveysService.submit(user.id, SYSTEM_MEASUREMENT_MODE, dto);
    await this.auditService.record(
      user,
      {
        action: 'survey.submit',
        entityType: 'survey_response',
        entityId: response.id,
        metadata: { tspPct: response.tspPct, meanLikert: response.meanLikert },
      },
      request,
    );
    return response;
  }

  @Get('summary')
  @Roles(...ANALYSIS_ROLES)
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({ summary: 'TSP por ítem y global, con la alerta de meta (RF-OE3-03, RF-OE3-04).' })
  async summary(@Query('includeSynthetic') includeSynthetic?: string): Promise<SurveySummaryDto> {
    return this.surveysService.summary(includeSynthetic === 'true');
  }

  @Get()
  @Roles(...ANALYSIS_ROLES)
  @ApiQuery({ name: 'includeSynthetic', required: false, type: Boolean })
  @ApiOperation({ summary: 'Lista las respuestas registradas.' })
  async findAll(
    @Query('includeSynthetic') includeSynthetic?: string,
  ): Promise<SurveyResponseSummaryDto[]> {
    return this.surveysService.findAll(includeSynthetic === 'true');
  }
}
