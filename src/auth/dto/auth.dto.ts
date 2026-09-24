import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

import { USER_ROLES, type UserRole } from 'src/common/domain';

export class LoginDto {
  @ApiProperty({ example: 'admin@unt.edu.pe' })
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  email: string;

  @ApiProperty({ example: 'ClaveSegura123' })
  @IsString()
  @MinLength(1, { message: 'La contraseña es obligatoria.' })
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class AuthUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: USER_ROLES }) role: UserRole;
}

export class LoginResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ description: 'Vigencia del token de acceso, en segundos.' }) expiresIn: number;
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
}
