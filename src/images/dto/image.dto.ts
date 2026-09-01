import { ApiProperty } from '@nestjs/swagger';

/**
 * Clinical image as returned to the portal.
 *
 * A class rather than an interface because the OpenAPI document — from which `acne-web` generates
 * its typed client — can only describe what it can introspect. An interface would come out of the
 * generator as an empty object and the frontend would silently lose its types.
 */
export class CaseImageDto {
  @ApiProperty() id: string;
  @ApiProperty() caseId: string;
  @ApiProperty() mimeType: string;
  @ApiProperty({ nullable: true, type: Number }) width: number | null;
  @ApiProperty({ nullable: true, type: Number }) height: number | null;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ description: 'SHA-256 del plaintext, para verificar integridad tras descifrar.' })
  sha256: string;
  @ApiProperty() encrypted: boolean;
  @ApiProperty({ description: 'True para superposiciones Grad-CAM.' }) isHeatmap: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty({ description: 'URL firmada con TTL de 15 minutos (RNF-02).' }) url: string;
}
