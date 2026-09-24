import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';

import { USER_ROLES, type UserRole } from 'src/common/domain';

export class CreateUserDto {
  @ApiProperty({ example: 'dermatologo@centro.pe' })
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  email: string;

  @ApiProperty({ minLength: 8, example: 'ClaveSegura123' })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password: string;

  @ApiProperty({ example: 'Dra. Ana Torres' })
  @IsString()
  @Length(3, 160)
  fullName: string;

  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES, { message: `El rol debe ser uno de: ${USER_ROLES.join(', ')}.` })
  role: UserRole;

  /*
   * Aquí quedaban los decoradores de `studyMode` sin su propiedad, tras retirarla.
   *
   * No era cosmético: un decorador suelto se aplica a la SIGUIENTE propiedad declarada, de modo
   * que `specialty` heredó un `@IsIn(STUDY_MODES)` y toda especialidad que no fuera «pretest» o
   * «postest» era rechazada con un 400. Es decir, crear un dermatólogo con su especialidad escrita
   * fallaba, y el mensaje hablaba de modos de estudio.
   */

  @ApiPropertyOptional({ example: 'Dermatología clínica' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  specialty?: string;

  @ApiPropertyOptional({
    description:
      'Teléfono de contacto del profesional. Se guarda cifrado, como el del paciente: el número ' +
      'de quien atiende identifica a una persona igual que el de quien es atendido.',
    example: '+51987654321',
  })
  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;
}

/**
 * What an administrator may correct on someone else's account.
 *
 * `studyMode` is ABSENT ON PURPOSE, and its absence is the enforcement, not a comment: the global
 * `ValidationPipe` runs with `forbidNonWhitelisted: true`, so a client that sends it gets a 400.
 * Moving a professional from pretest to postest is applying the intervention X of the
 * pre-experimental design (RF-TR-01) — it must be that professional's own deliberate act, through
 * `PATCH /users/me/study-mode`, with its own audit entry. An administrator flipping the condition
 * of someone who does not know it changed would contaminate the very measurement OE1 takes.
 *
 * `password` is absent for a different reason: resetting a credential is not editing a field, and
 * it has its own endpoint so it can be audited as what it is.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 160)
  fullName?: string;

  @ApiPropertyOptional({ example: 'dermatologo@centro.pe' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @Length(5, 180)
  email?: string;

  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  specialty?: string;

  @ApiPropertyOptional({ example: '+51987654321' })
  @IsOptional()
  @IsString()
  @Length(0, 20)
  phone?: string;
}

/** Self-service credential change. Nobody could change their own password before this existed. */
export class ChangePasswordDto {
  @ApiProperty({ description: 'La contraseña vigente, para confirmar que es su propia cuenta.' })
  @IsString()
  @MinLength(1, { message: 'Escriba su contraseña actual.' })
  currentPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  newPassword: string;
}

/**
 * A password an administrator generated for someone else.
 *
 * Returned ONCE and never stored in the clear, exactly like the accounts the seeder creates. It
 * also never reaches the audit trail: `audit_logs.metadata` is plain `jsonb`, and a credential
 * written there would outlive the reset it was meant to be part of.
 */
export class TemporaryPasswordDto {
  @ApiProperty({ description: 'Se muestra una sola vez. No se almacena en claro ni se audita.' })
  password: string;
}

export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: USER_ROLES }) role: UserRole;
  @ApiProperty({ nullable: true, type: String }) specialty: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Teléfono de contacto, descifrado. Cada lectura del listado queda auditada.',
  })
  phone: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty({
    description:
      'Profesional inventado por seed:study para poblar el censo de demostración. No es personal ' +
      'del centro y queda fuera del recuento de participantes del estudio.',
  })
  isSynthetic: boolean;
  @ApiProperty({ nullable: true, type: String }) consentAcceptedAt: string | null;
  @ApiProperty() createdAt: string;
}
