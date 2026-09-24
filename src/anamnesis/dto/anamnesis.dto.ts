import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

import { ANAMNESIS_KEYS, type AnamnesisAnswer } from 'src/common/domain';

/**
 * One answer: the value typed by its question plus the optional free-text follow-up.
 *
 * Declared as a loose object on purpose. `class-validator` cannot express "the shape depends on the
 * question this key belongs to"; that check lives in `AnamnesisService.validate()`, against the
 * catalogue, which is the only place that knows it.
 */
export class AnamnesisAnswerDto {
  @ApiProperty({
    description: 'Valor de la respuesta. Su tipo lo fija la pregunta en el catálogo.',
    oneOf: [
      { type: 'boolean' },
      { type: 'string' },
      { type: 'number' },
      { type: 'array', items: { type: 'string' } },
    ],
    nullable: true,
  })
  value: boolean | string | number | string[] | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Texto libre complementario. No se cifra: no escriba nombres ni documentos.',
  })
  detail?: string | null;
}

@ApiExtraModels(AnamnesisAnswerDto)
export class SaveAnamnesisDto {
  @ApiProperty({
    description: `Mapa clave → respuesta. Claves válidas: ${ANAMNESIS_KEYS.join(', ')}.`,
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(AnamnesisAnswerDto) },
  })
  @IsObject()
  answers: Record<string, AnamnesisAnswer>;

  @ApiPropertyOptional({
    description:
      'Marca la anamnesis como terminada. Es informativo: nunca condiciona crear ni revisar el caso.',
  })
  @IsOptional()
  @IsBoolean()
  complete?: boolean;

  @ApiPropertyOptional({
    description: 'Caso del que se precargaron las respuestas, si se usó una visita anterior.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  prefilledFromCaseId?: string | null;
}

@ApiExtraModels(AnamnesisAnswerDto)
export class AnamnesisResponseDto {
  @ApiProperty() caseId: string;
  @ApiProperty({ description: 'Versión del catálogo contra la que se respondió (RNF-03).' })
  version: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(AnamnesisAnswerDto) },
  })
  answers: Record<string, AnamnesisAnswer>;
  @ApiProperty() complete: boolean;
  @ApiProperty({ description: 'Preguntas respondidas de las aplicables a este paciente.' })
  answeredCount: number;
  @ApiProperty({ description: 'Preguntas aplicables según sexo y edad.' })
  applicableCount: number;
  @ApiProperty({
    description:
      'Embarazo actual declarado. Los retinoides orales son teratógenos, así que la ficha lo ' +
      'muestra de forma permanente. Es una etiqueta para el profesional, no una decisión ' +
      'automatizada (RNF-06).',
  })
  pregnancyFlag: boolean;
  @ApiProperty({ nullable: true, type: String }) prefilledFromCaseId: string | null;
  @ApiProperty({ nullable: true, type: String }) completedBy: string | null;
  @ApiProperty() updatedAt: string;
}

/** Previous visit's anamnesis, offered as a starting point when the patient returns. */
@ApiExtraModels(AnamnesisAnswerDto)
export class AnamnesisPrefillDto {
  @ApiProperty({ description: 'Caso del que proviene.' }) caseId: string;
  @ApiProperty() caseCode: string;
  @ApiProperty({ description: 'Fecha de aquella visita.' }) visitedAt: string;
  @ApiProperty() version: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(AnamnesisAnswerDto) },
  })
  answers: Record<string, AnamnesisAnswer>;
}
