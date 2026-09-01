import { ApiProperty } from '@nestjs/swagger';

import { STUDY_MODES, WORK_SHIFTS, type StudyMode, type WorkShift } from 'src/common/domain';

/**
 * One row of the digital Anexo 7 — ficha de registro de capacidad de atención (RF-OE4-01).
 */
export class Anexo7RowDto {
  @ApiProperty({ description: 'N.º correlativo del instrumento.' }) number: number;
  @ApiProperty() id: string;
  @ApiProperty() date: string;
  @ApiProperty() professional: string;
  @ApiProperty({ enum: WORK_SHIFTS, description: 'Jornada / turno.' }) shift: WorkShift;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ description: 'NCR — número de casos revisados, contado por el sistema.' })
  casesReviewed: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'TJ — duración de la jornada en horas, declarada por el profesional.',
  })
  durationHours: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'TCAD = NCR / TJ.' })
  tcad: number | null;
  @ApiProperty() isSynthetic: boolean;
}
