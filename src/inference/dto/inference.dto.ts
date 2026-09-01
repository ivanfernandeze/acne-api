import { ApiProperty } from '@nestjs/swagger';

import { GAGS_GRADES, IGA_CLASSES, type GagsGrade, type IgaClass } from 'src/common/domain';

/** One CNN prediction, as returned to the portal. Covers: OE2 (RF-OE2-01). */
export class AiInferenceDto {
  @ApiProperty() id: string;
  @ApiProperty() caseId: string;
  @ApiProperty() imageId: string;
  @ApiProperty({ enum: ['pending', 'running', 'succeeded', 'failed'] })
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  @ApiProperty({ nullable: true, enum: IGA_CLASSES }) igaClass: IgaClass | null;
  @ApiProperty({ nullable: true, type: Number }) confidence: number | null;
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Vector de probabilidades sobre las cinco clases IGA.',
  })
  classProbs: Record<string, number> | null;
  @ApiProperty({ nullable: true, enum: GAGS_GRADES }) gagsGrade: GagsGrade | null;
  @ApiProperty({ nullable: true, type: Number }) gagsScore: number | null;
  @ApiProperty({ nullable: true, type: String }) heatmapImageId: string | null;
  @ApiProperty({ nullable: true, type: Number }) latencyMs: number | null;
  @ApiProperty() modelVersion: string;
  @ApiProperty({
    description: '`stub` indica que la predicción NO proviene de una CNN entrenada.',
  })
  modelBackend: string;
  @ApiProperty({ nullable: true, type: String }) weightsChecksum: string | null;
  @ApiProperty() seed: number;
  @ApiProperty({ nullable: true, type: String }) errorMessage: string | null;
  @ApiProperty() createdAt: string;
}
