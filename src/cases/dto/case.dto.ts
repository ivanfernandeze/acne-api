import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

import {
  CASE_STATUSES,
  IGA_CLASSES,
  STUDY_MODES,
  type CaseStatus,
  type IgaClass,
  type StudyMode,
} from 'src/common/domain';
import { DiagnosisDto } from 'src/diagnoses/dto/diagnosis.dto';
import { CaseImageDto } from 'src/images/dto/image.dto';
import { AiInferenceDto } from 'src/inference/dto/inference.dto';

export class CreateCaseDto {
  @ApiProperty()
  @IsUUID('4', { message: 'El identificador de paciente no es válido.' })
  patientId: string;

  @ApiPropertyOptional({ description: 'Profesional asignado. Por defecto, quien crea el caso.' })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @ApiPropertyOptional({
    enum: IGA_CLASSES,
    description:
      'Patrón de consenso del lote retrospectivo. Es lo que hace comparables pretest y postest ' +
      'en RF-OE2-05; sin él, la fila del Anexo 5 se evalúa contra el juicio del especialista.',
  })
  @IsOptional()
  @IsIn(IGA_CLASSES)
  groundTruthIga?: IgaClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Marca el caso como dato de demostración. Se excluye de la evidencia de la tesis.',
  })
  @IsOptional()
  @IsBoolean()
  isSynthetic?: boolean;
}

export class UpdateCaseDto {
  @ApiPropertyOptional({ enum: IGA_CLASSES })
  @IsOptional()
  @IsIn(IGA_CLASSES)
  groundTruthIga?: IgaClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CaseSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() caseCode: string;
  @ApiProperty() patientId: string;
  @ApiProperty() patientCode: string;
  @ApiProperty({ nullable: true, type: String }) assignedUserId: string | null;
  @ApiProperty({ nullable: true, type: String }) assignedUserName: string | null;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ enum: CASE_STATUSES }) status: CaseStatus;
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) groundTruthIga: IgaClass | null;
  @ApiProperty() isSynthetic: boolean;
  @ApiProperty() imageCount: number;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: String }) closedAt: string | null;
}

export class CaseTimingDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Instante en que se abrió la ficha (RF-OE1-01).' }) t0: string;
  @ApiProperty({ nullable: true, type: String, description: 'Instante del diagnóstico definitivo.' })
  t1: string | null;
  @ApiProperty({ nullable: true, type: Number }) durationSeconds: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'TRᵢ en minutos.' })
  durationMinutes: number | null;
  @ApiProperty({ description: 'Las mediciones inválidas se excluyen de TRM.' }) valid: boolean;
}

export class CaseDetailDto extends CaseSummaryDto {
  @ApiProperty({ type: [CaseImageDto] }) images: CaseImageDto[];
  @ApiProperty({
    type: AiInferenceDto,
    nullable: true,
    description:
      'Sugerencia de la CNN. SIEMPRE null cuando el solicitante opera en modo pretest (RF-TR-01).',
  })
  inference: AiInferenceDto | null;
  @ApiProperty({ type: [DiagnosisDto] }) diagnoses: DiagnosisDto[];
  @ApiProperty({ type: CaseTimingDto, nullable: true }) timing: CaseTimingDto | null;
  @ApiProperty({
    description: 'Si el portal debe mostrar el módulo de IA para este usuario y este caso.',
  })
  aiVisible: boolean;
}
