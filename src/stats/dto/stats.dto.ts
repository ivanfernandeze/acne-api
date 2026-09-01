import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

import {
  HYPOTHESES,
  INDICATORS,
  type Alternative,
  type HypothesisKey,
  type IndicatorKey,
  type StatisticalTest,
  type TestDesign,
} from 'src/common/domain';

/**
 * Nested shapes are declared as classes, and every union alias carries an explicit `enum`.
 * The Swagger plugin cannot introspect a union alias imported from another module and would emit
 * a bare `object`, which reaches `acne-web` as `Record<string, never>` — a silently untyped
 * client. See `indicators/dto/indicator.dto.ts` for the same reasoning.
 */
export class NormalityResultDto {
  @ApiProperty({ enum: ['shapiro-wilk'] }) test: string;
  @ApiProperty() statistic: number;
  @ApiProperty() pValue: number;
  @ApiProperty({ description: 'True cuando p > α: no se rechaza la normalidad.' }) normal: boolean;
  @ApiProperty({ description: 'Shapiro-Wilk exige al menos 3 observaciones.' }) applicable: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) note?: string | null;
}

export class EffectSizeDto {
  @ApiProperty({ enum: ['cohens_dz', 'rank_biserial'] }) kind: string;
  @ApiProperty() value: number;
  @ApiProperty({ enum: ['trivial', 'small', 'medium', 'large'] }) magnitude: string;
}

export class PairedObservationDto {
  @ApiProperty({ description: 'Identificador de la unidad pareada (caso o jornada).' })
  pairKey: string;
  @ApiProperty() label: string;
  @ApiProperty() pretest: number;
  @ApiProperty() postest: number;
  @ApiProperty() difference: number;
}

export class HypothesisTestRequestDto {
  @ApiProperty({ enum: HYPOTHESES })
  @IsIn(HYPOTHESES, { message: `La hipótesis debe ser una de: ${HYPOTHESES.join(', ')}.` })
  hypothesis: HypothesisKey;

  @ApiPropertyOptional({ default: 0.05, minimum: 0.001, maximum: 0.2 })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(0.2)
  alpha?: number;

  @ApiPropertyOptional({
    description:
      'Solo HE₃: línea base contra la que contrastar TSP. Por defecto, TSP_BASELINE_PERCENT (60 %).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  baseline?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Incluir datos sintéticos de demostración. Desactivado para no contaminar la evidencia.',
  })
  @IsOptional()
  @IsBoolean()
  includeSynthetic?: boolean;
}

export class HypothesisTestResultDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: HYPOTHESES }) hypothesis: HypothesisKey;
  @ApiProperty({ description: 'Enunciado de la hipótesis alterna.' }) statement: string;
  @ApiProperty({ description: 'Enunciado de la hipótesis nula.' }) nullStatement: string;
  @ApiProperty({ enum: INDICATORS }) indicator: IndicatorKey;
  @ApiProperty({ enum: ['paired', 'one_sample'] }) design: TestDesign;
  @ApiProperty() alpha: number;
  @ApiProperty({ enum: ['two-sided', 'less', 'greater'] }) alternative: Alternative;
  @ApiProperty() nPairs: number;
  @ApiProperty() pretestMean: number;
  @ApiProperty() postestMean: number;
  @ApiProperty() meanDifference: number;
  @ApiProperty({
    type: NormalityResultDto,
    description: 'Shapiro-Wilk sobre las diferencias pareadas.',
  })
  normality: NormalityResultDto;
  @ApiProperty({ enum: ['ttest_rel', 'wilcoxon', 'ttest_1samp', 'wilcoxon_1samp'] })
  testApplied: StatisticalTest;
  @ApiProperty() testLabel: string;
  @ApiProperty() statistic: number;
  @ApiProperty() pValue: number;
  @ApiProperty({ type: EffectSizeDto, nullable: true }) effectSize: EffectSizeDto | null;
  @ApiProperty({ description: 'true si se rechaza H₀ al nivel α.' }) rejectsNull: boolean;
  @ApiProperty() conclusion: string;
  @ApiProperty({ type: [PairedObservationDto] }) pairs: PairedObservationDto[];
  @ApiProperty() seed: number;
  @ApiProperty() functionVersion: string;
  @ApiProperty() inputHash: string;
  @ApiProperty() includesSynthetic: boolean;
  @ApiProperty() executedAt: string;
}

export class GeneralHypothesisResultDto {
  @ApiProperty({ type: [HypothesisTestResultDto] }) results: HypothesisTestResultDto[];
  @ApiProperty() rejectedCount: number;
  @ApiProperty() totalCount: number;
  @ApiProperty() rejectsNull: boolean;
  @ApiProperty() h1: string;
  @ApiProperty() h0: string;
  @ApiProperty() conclusion: string;
}
