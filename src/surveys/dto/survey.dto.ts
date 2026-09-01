import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { LIKERT_ITEMS, LIKERT_MAX_SCORE, LIKERT_MIN_SCORE } from 'src/common/domain';

export class SurveyAnswerDto {
  @ApiProperty({ minimum: 1, maximum: LIKERT_ITEMS.length })
  @IsInt()
  @Min(1)
  @Max(LIKERT_ITEMS.length)
  itemNumber: number;

  @ApiProperty({
    minimum: LIKERT_MIN_SCORE,
    maximum: LIKERT_MAX_SCORE,
    description: '1 = Muy bajo · 2 = Bajo · 3 = Normal · 4 = Alto · 5 = Muy alto.',
  })
  @IsInt({ message: 'La puntuación debe ser un entero de 1 a 5.' })
  @Min(LIKERT_MIN_SCORE)
  @Max(LIKERT_MAX_SCORE)
  score: number;
}

export class SubmitSurveyDto {
  @ApiProperty({ type: [SurveyAnswerDto], description: 'Las 8 respuestas del Anexo 6.' })
  @IsArray()
  @ArrayMinSize(LIKERT_ITEMS.length, { message: 'Debe responder los 8 ítems del cuestionario.' })
  @ArrayMaxSize(LIKERT_ITEMS.length, { message: 'El cuestionario tiene exactamente 8 ítems.' })
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerDto)
  answers: SurveyAnswerDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comments?: string;
}

export class SurveyStatusDto {
  @ApiProperty({ description: 'Si corresponde mostrar el cuestionario ahora (RF-OE3-02).' })
  due: boolean;
  @ApiProperty() completed: boolean;
  @ApiProperty() postestCasesCompleted: number;
  @ApiProperty() triggerThreshold: number;
}

export class SurveyItemSummaryDto {
  @ApiProperty() itemNumber: number;
  @ApiProperty() text: string;
  @ApiProperty() mean: number;
  @ApiProperty() sd: number;
  @ApiProperty({ description: 'TSP del ítem: (Σ puntajes / (n × 5)) × 100.' }) tspPct: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  distribution: Record<number, number>;
}

export class SurveySummaryDto {
  @ApiProperty() respondents: number;
  @ApiProperty({ description: 'TSP = (Σ PO / PT) × 100 sobre todos los encuestados.' })
  tspPct: number;
  @ApiProperty() meanLikert: number;
  @ApiProperty({ type: [SurveyItemSummaryDto] }) items: SurveyItemSummaryDto[];
  @ApiProperty({ nullable: true, type: Boolean }) targetMet: boolean | null;
  @ApiProperty({ nullable: true, type: String }) alert: string | null;
}

export class SurveyResponseSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() userFullName: string;
  @ApiProperty() studyMode: string;
  @ApiProperty() pointsObtained: number;
  @ApiProperty() totalPoints: number;
  @ApiProperty() tspPct: number;
  @ApiProperty() meanLikert: number;
  @ApiProperty() submittedAt: string;
  @ApiProperty() isSynthetic: boolean;
}
