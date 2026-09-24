import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
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

/**
 * Corrections to a record that already exists.
 *
 * Deliberately narrower than `CreatePatientDto`. `patientCode` is absent because it is the anchor
 * of the anonymisation — every case, image and measurement in the study refers to the patient by
 * that code, and renaming it would silently detach a whole longitudinal series. `consentAccepted`
 * and the withdrawal are absent because each has its own endpoint and its own append-only row in
 * `consents`: consent is a sequence of events, not a field to overwrite.
 *
 * WHO may write WHICH field is decided in the controller, not here: `class-validator` cannot see
 * the caller's role, and the identity fields are the ones RF-TR-03 reserves.
 */
export class UpdatePatientDto {
  @ApiPropertyOptional({ description: 'Se re-cifra con AES-256-GCM (RF-TR-03).' })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Se re-cifra. Solo quien diagnostica puede tocarlo.' })
  @IsOptional()
  @IsString()
  @Length(4, 32)
  documentId?: string;

  @ApiPropertyOptional({ example: '1998-04-11' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener formato AAAA-MM-DD.' })
  birthDate?: string;

  @ApiPropertyOptional({ enum: SEXES })
  @IsOptional()
  @IsIn(SEXES)
  sex?: Sex;

  @ApiPropertyOptional({
    description:
      'Teléfono del paciente, por donde se le hace llegar la receta. Se re-cifra (RF-TR-03).',
    example: '+51987654321',
  })
  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Correo del paciente. También se re-cifra.' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @Length(5, 120)
  email?: string;

  @ApiPropertyOptional({ enum: FITZPATRICK_TYPES })
  @IsOptional()
  @IsIn(FITZPATRICK_TYPES)
  fitzpatrickPhototype?: FitzpatrickType;
}

/**
 * Body of the withdrawal (RNF-07).
 *
 * It exists so the body is VALIDATED at all: the route used to read `@Body('notes')`, and a
 * parameter without a metatype is invisible to the `ValidationPipe` — `forbidNonWhitelisted` did
 * not apply and any payload was accepted.
 */
export class WithdrawPatientDto {
  @ApiPropertyOptional({ description: 'Motivo declarado. No escriba datos personales.' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}

/**
 * Body of the reinstatement.
 *
 * The reason is REQUIRED here while it is optional for the withdrawal, and the asymmetry is the
 * point: reinstating puts the patient's cases back into the datasets, so an indicator snapshot
 * taken earlier will no longer match a later recomputation. It is meant to correct a withdrawal
 * recorded by mistake — never to reverse the patient's wishes — and the record has to say which.
 */
export class ReinstatePatientDto {
  @ApiProperty({ description: 'Por qué se reincorpora. Queda en el historial de consentimientos.' })
  @IsString()
  @Length(10, 500, { message: 'Explique el motivo de la reincorporación (10 a 500 caracteres).' })
  notes: string;
}

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

  @ApiPropertyOptional({
    description:
      'Teléfono del paciente. Es por donde se le envía la receta, así que pedirlo en el ingreso ' +
      'evita tener que teclearlo —y equivocarse— en cada envío. Se almacena cifrado.',
    example: '+51987654321',
  })
  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Correo del paciente, canal alterno. También cifrado.' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @Length(5, 120)
  email?: string;

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
      'Nombre descifrado. Solo se rellena para los roles que pueden ver la identidad; para el resto de ' +
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
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Teléfono por el que se le hace llegar la receta.',
  })
  phone: string | null;
  @ApiProperty({ nullable: true, type: String }) email: string | null;
}
