import { ApiProperty } from '@nestjs/swagger';

import { STUDY_MODES, type StudyMode } from 'src/common/domain';

/**
 * One row of the digital Anexo 4 — ficha de registro de tiempo de revisión médica.
 *
 * The fields mirror the paper instrument exactly (RF-OE1-02), so what the researcher transcribes
 * into the thesis annex is field-for-field what the system shows.
 */
export class Anexo4RowDto {
  @ApiProperty({ description: 'N.º correlativo del instrumento.' }) number: number;
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Fecha de la revisión (AAAA-MM-DD).' }) date: string;
  @ApiProperty({ description: 'N.º de caso.' }) caseCode: string;
  @ApiProperty({ description: 'ID anonimizado del paciente.' }) patientCode: string;
  @ApiProperty() professional: string;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ description: 'Hora de inicio de la revisión (t₀).' }) startTime: string;
  @ApiProperty({ nullable: true, type: String, description: 't₁.' }) endTime: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'TRᵢ en minutos, la unidad que declara el instrumento.',
  })
  reviewMinutes: number | null;
  @ApiProperty({ description: 'Las mediciones inválidas se excluyen del cálculo de TRM.' })
  valid: boolean;
  @ApiProperty() isSynthetic: boolean;
}

/** Descripción del diseño experimental y de la condición actual del usuario (RF-TR-01). */
export class StudyDesignDto {
  @ApiProperty() design: string;
  @ApiProperty({ example: 'G: O₁ → X → O₂' }) schema: string;
  @ApiProperty() sampleSize: number;
  @ApiProperty({ enum: STUDY_MODES }) currentStudyMode: StudyMode;
  @ApiProperty() currentStudyModeLabel: string;
  @ApiProperty({ description: 'Variable independiente: 0 sin IA, 1 con IA.' }) iia: number;
  @ApiProperty() aiEnabled: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  generalHypothesis: { h1: string; h0: string };
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  specificHypotheses: Record<string, string>;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) indicators: unknown[];
}
