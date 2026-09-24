import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { CAPTURE_MAX_UPLOADS_LIMIT, SHOT_KEYS, type ShotKey } from 'src/common/domain';

export class CreateCaptureSessionDto {
  @ApiProperty({ description: 'Caso al que se atarán las fotografías.' })
  @IsUUID('4')
  caseId: string;

  @ApiPropertyOptional({
    description:
      'Tope de fotografías de la sesión. La ruta de subida es pública, así que este número —y no ' +
      'la autenticación— es lo que acota el alcance de un enlace filtrado.',
    minimum: 1,
    maximum: CAPTURE_MAX_UPLOADS_LIMIT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CAPTURE_MAX_UPLOADS_LIMIT)
  maxUploads?: number;
}

/** Returned once, at creation. The plaintext token never appears in any other response. */
export class CaptureSessionCreatedDto {
  @ApiProperty() id: string;
  @ApiProperty() caseId: string;
  @ApiProperty() caseCode: string;
  @ApiProperty({
    description:
      'Token en claro. Se devuelve UNA sola vez: la base guarda solo su SHA-256. Es lo que se ' +
      'codifica en el QR.',
  })
  token: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty() maxUploads: number;
}

export class ShotDefinitionDto {
  @ApiProperty({ enum: SHOT_KEYS }) key: ShotKey;
  @ApiProperty() label: string;
  @ApiProperty() instruction: string;
  @ApiProperty() required: boolean;
  @ApiProperty({ description: 'Cuántas fotografías de esta toma ya se subieron.' })
  uploaded: number;
}

/**
 * What the phone is told about the session.
 *
 * Deliberately minimal: it carries the case CODE and never the patient's name, because the endpoint
 * is public and anyone holding the link would otherwise be handed an identity (RF-TR-03).
 */
export class CaptureSessionContextDto {
  @ApiProperty() caseCode: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty() remainingSeconds: number;
  @ApiProperty() uploadCount: number;
  @ApiProperty() maxUploads: number;
  @ApiProperty({ type: [ShotDefinitionDto] }) shots: ShotDefinitionDto[];
  @ApiProperty({ description: 'Aviso regulatorio que la página móvil debe mostrar (RNF-06).' })
  disclaimer: string;
}

/** The phone only needs to know the upload landed; it never gets a link back to the image. */
export class CaptureUploadedImageDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true, enum: SHOT_KEYS }) shotKey: ShotKey | null;
  @ApiProperty() createdAt: string;
}

export class CaptureUploadResultDto {
  @ApiProperty({
    type: CaptureUploadedImageDto,
    description: 'Sin URL firmada: el móvil sube fotografías, nunca las lee.',
  })
  image: CaptureUploadedImageDto;
  @ApiProperty() uploadCount: number;
  @ApiProperty() maxUploads: number;
  @ApiProperty({
    type: [String],
    description:
      'Avisos de calidad de la fotografía aceptada — encuadre, enfoque, luz. No bloquean nada; ' +
      'sirven para que quien sostiene el teléfono mejore la siguiente toma.',
  })
  warnings: string[];
}

export class CaptureSessionStatusDto {
  @ApiProperty() id: string;
  @ApiProperty() caseId: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty() remainingSeconds: number;
  @ApiProperty() uploadCount: number;
  @ApiProperty() maxUploads: number;
  @ApiProperty({ nullable: true, type: String }) revokedAt: string | null;
  @ApiProperty() active: boolean;
}

export class CaptureShotKeyDto {
  @ApiPropertyOptional({ enum: SHOT_KEYS })
  @IsOptional()
  @IsIn(SHOT_KEYS)
  shotKey?: ShotKey;
}
