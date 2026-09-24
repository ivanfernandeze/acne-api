import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import {
  GAGS_MAX_SCORE,
  GAGS_MIN_SCORE,
  IGA_CLASSES,
  STUDY_MODES,
  type IgaClass,
  type StudyMode,
} from 'src/common/domain';

export class SubmitDiagnosisDto {
  @ApiProperty({
    enum: IGA_CLASSES,
    description: 'Clase IGA emitida por el especialista. Es el diagnóstico clínicamente vinculante.',
  })
  @IsIn(IGA_CLASSES, { message: `La clase IGA debe ser una de: ${IGA_CLASSES.join(', ')}.` })
  igaClass: IgaClass;

  @ApiPropertyOptional({ minimum: GAGS_MIN_SCORE, maximum: GAGS_MAX_SCORE })
  @IsOptional()
  @IsInt({ message: 'El puntaje GAGS debe ser entero.' })
  @Min(GAGS_MIN_SCORE)
  @Max(GAGS_MAX_SCORE)
  gagsScore?: number;

  @ApiPropertyOptional({
    description:
      'El diagnóstico redactado, aparte de la clase IGA. La clase sigue siendo obligatoria: TPD la ' +
      'compara contra el patrón de referencia y un texto libre no es comparable con nada.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  definitiveDiagnosis?: string;

  @ApiPropertyOptional({
    description:
      'Obligatorio cuando la ficha muestra una incongruencia entre la anamnesis y la imagen: el ' +
      'especialista declara que revisó la fotografía y que corresponde al paciente y a la zona ' +
      'afectada. Sin esto, el diagnóstico se rechaza mientras la incongruencia exista.',
  })
  @IsOptional()
  @IsBoolean()
  mismatchAcknowledged?: boolean;

  @ApiPropertyOptional({
    description: 'Por qué se mantiene el diagnóstico pese a la incongruencia. Queda en la auditoría.',
    minLength: 10,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Explique en al menos 10 caracteres por qué mantiene el diagnóstico.' })
  @MaxLength(500)
  mismatchReason?: string;

  @ApiPropertyOptional({ description: 'Código CIE-10 del catálogo servido en `/meta/catalogs`.' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  icd10Code?: string;

  @ApiPropertyOptional({
    description: 'Lo que se le dice al paciente; viaja impreso en la receta.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  patientNotes?: string;

  @ApiPropertyOptional({
    description:
      'Texto que el paciente NUNCA ve. Sin cifrar: no escriba aquí nombres ni documentos ' +
      '(Ley N.º 29733).',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @ApiPropertyOptional({
    description:
      'Solo aplica en postest: si el profesional mantuvo la sugerencia de la IA. Si se omite, ' +
      'el sistema lo deduce comparando la clase emitida con la predicha.',
  })
  @IsOptional()
  @IsBoolean()
  aiSuggestionAccepted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class DiagnosisDto {
  @ApiProperty() id: string;
  @ApiProperty() caseId: string;
  @ApiProperty() caseCode: string;
  @ApiProperty() userId: string;
  @ApiProperty() userFullName: string;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ enum: IGA_CLASSES }) igaClass: IgaClass;
  @ApiProperty({ nullable: true, type: Number }) gagsScore: number | null;
  @ApiProperty({
    nullable: true,
    enum: ['correcto', 'incorrecto'],
    description: 'Concordancia del juicio del especialista con cases.ground_truth_iga.',
  })
  agreement: 'correcto' | 'incorrecto' | null;
  @ApiProperty({ nullable: true, type: Boolean }) aiSuggestionAccepted: boolean | null;
  @ApiProperty({ nullable: true, type: String }) aiInferenceId: string | null;
  @ApiProperty({ nullable: true, type: String }) definitiveDiagnosis: string | null;
  @ApiProperty({ nullable: true, type: String }) icd10Code: string | null;
  @ApiProperty({ nullable: true, type: String }) patientNotes: string | null;
  @ApiProperty({ nullable: true, type: String }) internalNotes: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'TRᵢ del caso en minutos, congelado al enviar el diagnóstico (OE1).',
  })
  reviewMinutes: number | null;
}

/** One row of the digital Anexo 5 (RF-OE2-02). */
export class Anexo5RowDto {
  @ApiProperty() number: number;
  @ApiProperty() date: string;
  @ApiProperty() caseCode: string;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ nullable: true, enum: IGA_CLASSES, description: 'Diagnóstico de la IA.' })
  aiDiagnosis: IgaClass | null;
  @ApiProperty({ nullable: true, type: Number }) aiConfidence: number | null;
  @ApiProperty({ enum: IGA_CLASSES, description: 'Diagnóstico de referencia del especialista.' })
  referenceDiagnosis: IgaClass;
  @ApiProperty({
    nullable: true,
    enum: IGA_CLASSES,
    description: 'Patrón de consenso del lote, cuando existe (base de RF-OE2-05).',
  })
  groundTruth: IgaClass | null;
  @ApiProperty({
    nullable: true,
    enum: ['correcto', 'incorrecto'],
    description: 'Resultado según el patrón declarado en `standard`.',
  })
  result: 'correcto' | 'incorrecto' | null;
  @ApiProperty({
    enum: ['ground_truth', 'especialista', 'sin_patron'],
    description: 'Contra qué se evaluó el resultado.',
  })
  standard: 'ground_truth' | 'especialista' | 'sin_patron';
  @ApiProperty() professional: string;
  @ApiProperty() isSynthetic: boolean;
}
