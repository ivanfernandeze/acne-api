import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import {
  FITZPATRICK_TYPES,
  IGA_CLASSES,
  SEXES,
  type FitzpatrickType,
  type IgaClass,
  type Sex,
} from 'src/common/domain';

export class CreatePatientDto {
  @ApiProperty({ description: 'Se almacena cifrado con AES-256-GCM (RF-TR-03).' })
  @IsString()
  @Length(2, 160)
  fullName: string;

  @ApiPropertyOptional({ description: 'DNI u otro documento. También se almacena cifrado.' })
  @IsOptional()
  @IsString()
  @Length(4, 32)
  documentId?: string;

  @ApiPropertyOptional({ example: '2004-05-17' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener formato AAAA-MM-DD.' })
  birthDate?: string;

  @ApiPropertyOptional({ enum: SEXES })
  @IsOptional()
  @IsIn(SEXES)
  sex?: Sex;

  @ApiPropertyOptional({
    enum: FITZPATRICK_TYPES,
    description: 'Fototipo Fitzpatrick, para la auditoría de equidad de la sección 8.2.',
  })
  @IsOptional()
  @IsIn(FITZPATRICK_TYPES)
  fitzpatrickPhototype?: FitzpatrickType;

  @ApiProperty({ description: 'Consentimiento informado del paciente (RNF-07).' })
  @IsBoolean()
  consentAccepted: boolean;

  @ApiPropertyOptional({ default: '1.0' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  consentVersion?: string;
}

export class PatientResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Identificador anonimizado, p. ej. PAC-2026-0001.' })
  patientCode: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Nombre descifrado. Solo se rellena para `dermatologo` y `residente`; para el resto de ' +
      'roles llega en `null`, de modo que la anonimización de RF-TR-03 se mantiene.',
  })
  fullName: string | null;
  @ApiProperty({ nullable: true, type: String }) birthDate: string | null;
  @ApiProperty({ nullable: true, type: Number }) ageYears: number | null;
  @ApiProperty({ nullable: true, enum: SEXES }) sex: Sex | null;
  @ApiProperty({ nullable: true, enum: FITZPATRICK_TYPES })
  fitzpatrickPhototype: FitzpatrickType | null;
  @ApiProperty({ nullable: true, type: String }) consentAcceptedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) withdrawnAt: string | null;
  @ApiProperty() createdAt: string;

  // --- Longitudinal summary, for the patient list -----------------------------
  @ApiProperty({ description: 'Número de casos clínicos registrados para este paciente.' })
  caseCount: number;
  @ApiProperty({ nullable: true, type: String }) lastVisitAt: string | null;
  @ApiProperty({
    nullable: true,
    enum: IGA_CLASSES,
    description: 'Severidad más reciente según el juicio del especialista.',
  })
  lastSeverity: IgaClass | null;
}

/** Returned only to the treating dermatologist, and every read is audited (RF-TR-03, RNF-02). */
export class PatientIdentityDto {
  @ApiProperty({ nullable: true, type: String }) fullName: string | null;
  @ApiProperty({ nullable: true, type: String }) documentId: string | null;
}
