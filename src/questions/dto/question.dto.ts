import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  ANAMNESIS_ANSWER_TYPES,
  ANAMNESIS_SCOPES,
  ANAMNESIS_SECTIONS,
  type AnamnesisAnswerType,
  type AnamnesisScope,
  type AnamnesisSection,
} from 'src/common/domain';

export class QuestionDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Clave bajo la que se archivan las respuestas.' }) key: string;
  @ApiProperty() number: number;
  @ApiProperty({ enum: ANAMNESIS_SECTIONS }) section: AnamnesisSection;
  @ApiProperty() sectionLabel: string;
  @ApiProperty() text: string;
  @ApiProperty({ enum: ANAMNESIS_ANSWER_TYPES }) type: AnamnesisAnswerType;
  @ApiProperty({ enum: ANAMNESIS_SCOPES }) scope: AnamnesisScope;
  @ApiProperty({ nullable: true, type: String }) unit: string | null;
  @ApiProperty() required: boolean;
  @ApiProperty({ nullable: true, type: String }) detailPrompt: string | null;
  @ApiProperty({ nullable: true, type: String }) hint: string | null;
  @ApiProperty({ nullable: true, type: [String] }) options: string[] | null;
  @ApiProperty() active: boolean;
  @ApiProperty({ description: 'Cuántas anamnesis la han respondido.' }) answerCount: number;
  @ApiProperty({
    description:
      'true cuando ya tiene respuestas: la clave, el tipo, el ámbito y las opciones quedan fijos ' +
      'porque los valores guardados se interpretan según ellos. La redacción sigue siendo editable.',
  })
  locked: boolean;
  @ApiProperty() updatedAt: string;
}

export class CreateQuestionDto {
  @ApiProperty({
    description:
      'Clave de archivo. Se normaliza a minúsculas sin tildes ni espacios: «Peso Actual» queda ' +
      'como «peso_actual». Es única y no se puede reutilizar.',
    maxLength: 40,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  key: string;

  @ApiProperty({ enum: ANAMNESIS_SECTIONS })
  @IsIn(ANAMNESIS_SECTIONS)
  section: AnamnesisSection;

  @ApiProperty({ description: 'La redacción que ve el paciente.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text: string;

  @ApiProperty({ enum: ANAMNESIS_ANSWER_TYPES })
  @IsIn(ANAMNESIS_ANSWER_TYPES)
  type: AnamnesisAnswerType;

  @ApiProperty({
    enum: ANAMNESIS_SCOPES,
    description: '«mujer_adulta» limita la pregunta al bloque hormonal (mujeres desde los 18).',
  })
  @IsIn(ANAMNESIS_SCOPES)
  scope: AnamnesisScope;

  @ApiPropertyOptional({ description: 'Obligatorias solo para elección única o múltiple.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ maxLength: 16 }) @IsOptional() @IsString() @MaxLength(16) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  detailPrompt?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
  @ApiPropertyOptional({ maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  version?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * Todo es opcional porque se envía solo lo que cambia.
 *
 * Los campos ESTRUCTURALES —clave, tipo, ámbito, opciones— se rechazan si la pregunta ya tiene
 * respuestas: los valores guardados se interpretan según ellos.
 */
export class UpdateQuestionDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  key?: string;

  @ApiPropertyOptional({ enum: ANAMNESIS_SECTIONS })
  @IsOptional()
  @IsIn(ANAMNESIS_SECTIONS)
  section?: AnamnesisSection;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({ enum: ANAMNESIS_ANSWER_TYPES })
  @IsOptional()
  @IsIn(ANAMNESIS_ANSWER_TYPES)
  type?: AnamnesisAnswerType;

  @ApiPropertyOptional({ enum: ANAMNESIS_SCOPES })
  @IsOptional()
  @IsIn(ANAMNESIS_SCOPES)
  scope?: AnamnesisScope;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ maxLength: 16 }) @IsOptional() @IsString() @MaxLength(16) unit?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  detailPrompt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
