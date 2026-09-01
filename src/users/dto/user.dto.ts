import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';

import { STUDY_MODES, USER_ROLES, type StudyMode, type UserRole } from 'src/common/domain';

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

  @ApiPropertyOptional({ enum: STUDY_MODES, default: 'produccion' })
  @IsOptional()
  @IsIn(STUDY_MODES)
  studyMode?: StudyMode;

  @ApiPropertyOptional({ example: 'Dermatología clínica' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  specialty?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 160)
  fullName?: string;

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
}

/**
 * RF-TR-01: switching the study mode changes the experimental condition the professional works
 * under, so it is a deliberate, explicit action with its own endpoint and its own audit entry.
 */
export class SetStudyModeDto {
  @ApiProperty({ enum: STUDY_MODES })
  @IsIn(STUDY_MODES, { message: `El modo de estudio debe ser uno de: ${STUDY_MODES.join(', ')}.` })
  studyMode: StudyMode;
}

export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: USER_ROLES }) role: UserRole;
  @ApiProperty({ enum: STUDY_MODES }) studyMode: StudyMode;
  @ApiProperty({ nullable: true, type: String }) specialty: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty({ description: 'Valor de la variable independiente implícito en el modo (0 o 1).' })
  iia: number;
  @ApiProperty({ nullable: true, type: String }) consentAcceptedAt: string | null;
  @ApiProperty() createdAt: string;
}
