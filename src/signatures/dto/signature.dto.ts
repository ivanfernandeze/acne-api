import { ApiProperty } from '@nestjs/swagger';

export class SignatureDto {
  @ApiProperty({ description: 'Si el profesional tiene una rúbrica registrada.' })
  hasSignature: boolean;
  @ApiProperty({ nullable: true, type: String }) updatedAt: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'URL firmada de la imagen, con la misma vida corta que las fotografías clínicas. Va firmada ' +
      'porque una etiqueta <img> no puede adjuntar la cabecera Authorization: una ruta protegida ' +
      'por rol devolvería 401 y el navegador pintaría una imagen rota.',
  })
  imageUrl: string | null;
}
