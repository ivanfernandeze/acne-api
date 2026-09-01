import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { STUDY_MODES, WORK_SHIFTS, type StudyMode, type WorkShift } from 'src/common/domain';

export class OpenSessionDto {
  @ApiProperty({ enum: WORK_SHIFTS })
  @IsIn(WORK_SHIFTS, { message: `El turno debe ser uno de: ${WORK_SHIFTS.join(', ')}.` })
  shift: WorkShift;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CloseSessionDto {
  @ApiProperty({
    description: 'TJ — duración declarada de la jornada, en horas (RF-OE4-02).',
    minimum: 0.25,
    maximum: 24,
    example: 6,
  })
  @IsNumber({}, { message: 'La duración de la jornada debe ser numérica.' })
  @Min(0.25, { message: 'La jornada debe durar al menos 15 minutos.' })
  @Max(24, { message: 'La jornada no puede exceder 24 horas.' })
  declaredDurationHours: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class WorkSessionDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() userFullName: string;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ enum: WORK_SHIFTS }) shift: WorkShift;
  @ApiProperty() startedAt: string;
  @ApiProperty({ nullable: true, type: String }) endedAt: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'TJ en horas.' })
  declaredDurationHours: number | null;
  @ApiProperty({ description: 'NCR — casos revisados, contados por el sistema.' })
  casesReviewed: number;
  @ApiProperty({ nullable: true, type: Number, description: 'TCAD = NCR / TJ, en casos/hora.' })
  tcad: number | null;
  @ApiProperty() isSynthetic: boolean;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
}
