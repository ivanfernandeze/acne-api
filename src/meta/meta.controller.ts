import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

import { PrescriptionsService } from 'src/prescriptions/prescriptions.service';
import { QuestionsService } from 'src/questions/questions.service';

import { Public } from 'src/common/decorators';
import {
  ANAMNESIS_SECTIONS,
  ANAMNESIS_SECTION_LABELS,
  ANAMNESIS_VERSION,
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
  SHOT_DEFINITIONS,
  SHOT_KEYS,
  STATISTICAL_TEST_LABELS,
  DELIVERY_CHANNELS,
  DELIVERY_CHANNEL_LABELS,
  PRESCRIPTION_STATUSES,
  PRESCRIPTION_STATUS_LABELS,
  STUDY_MODES,
  STUDY_MODE_LABELS,
  THESIS_METADATA,
  USER_ROLES,
  USER_ROLE_GROUPS,
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly questions: QuestionsService,
    private readonly prescriptions: PrescriptionsService,
  ) {}

  /**
   * El catálogo CIE-10 se lee de la BASE y no de una constante.
   *
   * Es el único catálogo del sistema que un mantenedor puede ampliar sin desplegar: la sección 3
   * confina el prototipo al acné, pero el conjunto de diferenciales que una clínica necesita
   * emitir cambia con la práctica, y obligar a una migración por cada código nuevo garantizaría
   * que nadie los agregue.
   */
  private async icd10Codes(): Promise<Array<{ code: string; name: string }>> {
    const rows = await this.dataSource.query<Array<{ codigo: string; nombre: string }>>(
      `SELECT "codigo", "nombre" FROM "cie10" ORDER BY "orden" ASC`,
    );
    return rows.map((row) => ({ code: row.codigo, name: row.nombre }));
  }

  @Public()
  @Get('catalogs')
  @ApiOperation({ summary: 'Catálogos del dominio: escalas, roles, indicadores e instrumentos.' })
  async catalogs(): Promise<Record<string, unknown>> {
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
      // Proceso clínico. No alimenta ningún indicador: el portal los necesita para pintar la
      // validación y la receta sin duplicar las listas del dominio.
      prescriptionStatuses: {
        values: PRESCRIPTION_STATUSES,
        labels: PRESCRIPTION_STATUS_LABELS,
      },
      deliveryChannels: {
        values: DELIVERY_CHANNELS,
        labels: DELIVERY_CHANNEL_LABELS,
        simulated: this.prescriptions.simulatedChannels(),
      },
      icd10: await this.icd10Codes(),
      roles: { values: USER_ROLES, labels: USER_ROLE_LABELS, groups: USER_ROLE_GROUPS },

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

      // Intake instruments. Served here for the same reason as the Likert: the wording is the one
      // the clinic uses with patients, and the portal must render it rather than paraphrase it.
      anamnesis: {
        version: ANAMNESIS_VERSION,
        sections: ANAMNESIS_SECTIONS,
        sectionLabels: ANAMNESIS_SECTION_LABELS,
        questions: await this.questions.catalogue(),
      },
      shots: {
        keys: SHOT_KEYS,
        definitions: SHOT_DEFINITIONS,
      },
    };
  }
}
