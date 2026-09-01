import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from 'src/common/decorators';
import {
  APA_REFERENCES,
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  CLINICAL_DISCLAIMER,
  FITZPATRICK_TYPES,
  GAGS_GRADES,
  GAGS_LABELS,
  GENERAL_HYPOTHESIS,
  HYPOTHESES,
  HYPOTHESIS_ALTERNATIVE,
  HYPOTHESIS_INDICATOR,
  HYPOTHESIS_NULL_STATEMENTS,
  HYPOTHESIS_STATEMENTS,
  IGA_CLASSES,
  IGA_LABELS,
  IGA_ORDINAL,
  INDICATORS,
  INDICATOR_DEFINITIONS,
  INDICATOR_TARGETS,
  LIKERT_ITEMS,
  LIKERT_SCALE_LABELS,
  LIKERT_TOTAL_POINTS,
  SEXES,
  STATISTICAL_TEST_LABELS,
  STUDY_MODES,
  STUDY_MODE_LABELS,
  THESIS_METADATA,
  USER_ROLES,
  USER_ROLE_LABELS,
  WORK_SHIFTS,
  WORK_SHIFT_LABELS,
} from 'src/common/domain';

/**
 * Runtime catalogues of the domain.
 *
 * Covers the gap that OpenAPI code generation cannot: `openapi-typescript` gives `acne-web` the
 * TYPES, but not the VALUES — the Spanish labels, the verbatim Likert wording, the indicator
 * formulas and targets. Serving them from here means the frontend never keeps a second copy of
 * the validated instruments, which is the contract rule of section 4 applied to constants.
 */
@ApiTags('meta')
@Controller('meta')
export class MetaController {
  @Public()
  @Get('catalogs')
  @ApiOperation({ summary: 'Catálogos del dominio: escalas, roles, indicadores e instrumentos.' })
  catalogs(): Record<string, unknown> {
    return {
      thesis: THESIS_METADATA,
      disclaimer: CLINICAL_DISCLAIMER,
      references: APA_REFERENCES,

      iga: {
        classes: IGA_CLASSES,
        labels: IGA_LABELS,
        ordinal: IGA_ORDINAL,
      },
      gags: {
        grades: GAGS_GRADES,
        labels: GAGS_LABELS,
      },
      fitzpatrick: FITZPATRICK_TYPES,
      sexes: SEXES,

      studyModes: { values: STUDY_MODES, labels: STUDY_MODE_LABELS },
      caseStatuses: { values: CASE_STATUSES, labels: CASE_STATUS_LABELS },
      workShifts: { values: WORK_SHIFTS, labels: WORK_SHIFT_LABELS },
      roles: { values: USER_ROLES, labels: USER_ROLE_LABELS },

      indicators: {
        keys: INDICATORS,
        definitions: INDICATOR_DEFINITIONS,
        targets: INDICATOR_TARGETS,
      },

      hypotheses: {
        keys: HYPOTHESES,
        statements: HYPOTHESIS_STATEMENTS,
        nullStatements: HYPOTHESIS_NULL_STATEMENTS,
        indicator: HYPOTHESIS_INDICATOR,
        alternative: HYPOTHESIS_ALTERNATIVE,
        general: GENERAL_HYPOTHESIS,
        testLabels: STATISTICAL_TEST_LABELS,
      },

      survey: {
        items: LIKERT_ITEMS,
        scale: LIKERT_SCALE_LABELS,
        totalPoints: LIKERT_TOTAL_POINTS,
      },
    };
  }
}
