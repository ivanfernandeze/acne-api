import { ApiProperty } from '@nestjs/swagger';

import {
  IGA_CLASSES,
  INDICATORS,
  STUDY_MODES,
  type IgaClass,
  type IndicatorKey,
  type StudyMode,
} from 'src/common/domain';

/**
 * Response contracts of the indicators domain.
 *
 * Union type aliases (`IndicatorKey`, `StudyMode`, `IgaClass`) are declared with an explicit
 * `enum` on every property. The Swagger CLI plugin cannot resolve a union alias imported from
 * another module and would emit a bare `object`, which reaches `acne-web` as
 * `Record<string, never>` and quietly erases the type. Being explicit here is what keeps the
 * generated client honest.
 */

export class DescriptiveStatsDto {
  @ApiProperty() n: number;
  @ApiProperty() mean: number;
  @ApiProperty({ description: 'Desviación estándar muestral (n − 1).' }) sd: number;
  @ApiProperty() min: number;
  @ApiProperty() q1: number;
  @ApiProperty() median: number;
  @ApiProperty() q3: number;
  @ApiProperty() max: number;
}

export class IndicatorDefinitionDto {
  @ApiProperty({ enum: INDICATORS }) key: IndicatorKey;
  @ApiProperty({ enum: ['OE1', 'OE2', 'OE3', 'OE4'] }) objective: string;
  @ApiProperty({ enum: ['HE1', 'HE2', 'HE3', 'HE4'] }) hypothesis: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 'TRM = (Σ TRᵢ) / n' }) formula: string;
  @ApiProperty({ example: 'min/caso' }) unit: string;
  @ApiProperty({ description: 'Instrumento de la tesis que lo operacionaliza.' })
  instrument: string;
  @ApiProperty({
    enum: ['lower', 'higher'],
    description: '`lower` significa que un valor menor es mejor (TRM).',
  })
  direction: string;
  @ApiProperty() target: string;
}

export class IndicatorValueDto {
  @ApiProperty({ enum: INDICATORS }) indicator: IndicatorKey;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ description: 'Valor del indicador según su fórmula.' }) value: number;
  @ApiProperty() unit: string;
  @ApiProperty({
    type: [Number],
    description: 'Observaciones individuales que sustentan el valor; alimentan los boxplots.',
  })
  observations: number[];
  @ApiProperty({ type: DescriptiveStatsDto }) descriptive: DescriptiveStatsDto;
  @ApiProperty({ description: 'SHA-256 de los insumos ordenados (RNF-05).' }) inputHash: string;
  @ApiProperty() computedAt: string;
}

export class IndicatorComparisonDto {
  @ApiProperty({ enum: INDICATORS }) indicator: IndicatorKey;
  @ApiProperty({ type: IndicatorDefinitionDto }) definition: IndicatorDefinitionDto;
  @ApiProperty({ type: IndicatorValueDto, nullable: true }) pretest: IndicatorValueDto | null;
  @ApiProperty({ type: IndicatorValueDto, nullable: true }) postest: IndicatorValueDto | null;
  @ApiProperty({ nullable: true, type: Number }) absoluteChange: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Cambio relativo en %, positivo si el postest es mayor.',
  })
  relativeChangePct: number | null;
  @ApiProperty({ nullable: true, type: Boolean }) targetMet: boolean | null;
  @ApiProperty({ nullable: true, type: String }) alert: string | null;
}

export class PerClassMetricsDto {
  @ApiProperty({ enum: IGA_CLASSES }) igaClass: IgaClass;
  @ApiProperty() support: number;
  @ApiProperty() precision: number;
  @ApiProperty({ description: 'Sensibilidad (recall).' }) recall: number;
  @ApiProperty() specificity: number;
  @ApiProperty() f1: number;
}

export class ClassificationReportDto {
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ description: 'TPD = (DC / DT) × 100.' }) accuracyPct: number;
  @ApiProperty() correct: number;
  @ApiProperty() total: number;
  @ApiProperty() f1Macro: number;
  @ApiProperty({ nullable: true, type: Number }) aucRocMacro: number | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'number' } },
    description: 'Fila = referencia, columna = predicción, en el orden de las clases IGA.',
  })
  confusionMatrix: number[][];
  @ApiProperty({ type: [PerClassMetricsDto] }) perClass: PerClassMetricsDto[];
  @ApiProperty({
    enum: ['ground_truth', 'especialista', 'sin_patron'],
    description: 'Patrón contra el que se evaluó.',
  })
  standard: string;
}

export class IndicatorByProfessionalDto {
  @ApiProperty() userId: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: [Number] }) pretest: number[];
  @ApiProperty({ type: [Number] }) postest: number[];
  @ApiProperty({ type: DescriptiveStatsDto, nullable: true })
  pretestStats: DescriptiveStatsDto | null;
  @ApiProperty({ type: DescriptiveStatsDto, nullable: true })
  postestStats: DescriptiveStatsDto | null;
}

export class DashboardDto {
  @ApiProperty({ type: [IndicatorComparisonDto] }) indicators: IndicatorComparisonDto[];
  @ApiProperty({ description: 'Si las cifras incluyen datos sintéticos de demostración.' })
  includesSynthetic: boolean;
  @ApiProperty() generatedAt: string;
}
