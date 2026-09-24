import { ApiProperty } from '@nestjs/swagger';

import { COVERAGE_STATUSES, type CoverageStatus } from 'src/common/domain';

/** Covers: RNF-04 (`/audit/thesis-coverage`) and RF-TR-04 (`/audit/iia-check`). */

export class CoverageEntryDto {
  @ApiProperty({ enum: ['OG', 'OE1', 'OE2', 'OE3', 'OE4', 'IIA'] }) objective: string;
  @ApiProperty() description: string;
  @ApiProperty({ nullable: true, type: String }) indicator: string | null;
  @ApiProperty({ nullable: true, type: String }) formula: string | null;
  @ApiProperty({ nullable: true, type: String }) target: string | null;
  @ApiProperty({ enum: COVERAGE_STATUSES }) status: CoverageStatus;
  @ApiProperty({ description: 'Nombre legible del estado, para pintarlo sin traducir en el portal.' })
  statusLabel: string;
  @ApiProperty({ type: [String] }) modules: string[];
  @ApiProperty({ type: [String] }) requirements: string[];
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
}

export class ThesisCoverageDto {
  @ApiProperty() generatedAt: string;
  @ApiProperty({ description: 'Porcentaje de objetivos con cobertura completa.' })
  coveragePct: number;
  @ApiProperty({ type: [CoverageEntryDto] }) entries: CoverageEntryDto[];
  @ApiProperty({
    type: [String],
    description: 'Motivos concretos por los que la cobertura no está completa.',
  })
  blockers: string[];
  @ApiProperty() traceabilityDocument: string;
}

export class IiaCheckDto {
  @ApiProperty({
    description:
      'Solo es `true` con una CNN entrenada activa. Es la condición que permite declarar IIA = 1.',
  })
  operational: boolean;
  @ApiProperty() modelBackend: string;
  @ApiProperty({
    enum: ['stub', 'cnn', 'llm_externo'],
    description:
      'Por qué la verificación pasa o falla. Un stub y un LLM externo la fallan por razones que ' +
      'no son equivalentes, y `operational` por sí solo no las distingue.',
  })
  modelKind: string;
  @ApiProperty() version: string;
  @ApiProperty({ nullable: true, type: String }) weightsChecksum: string | null;
  @ApiProperty({ nullable: true, type: Number }) engineLatencyMedian24hMs: number | null;
  @ApiProperty({ nullable: true, type: Number }) engineLatencyP95_24hMs: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Latencia de extremo a extremo medida por el orquestador; es la que acota RNF-01.',
  })
  orchestratorLatencyMedian24hMs: number | null;
  @ApiProperty({ nullable: true, type: Number }) orchestratorLatencyP95_24hMs: number | null;
  @ApiProperty() errorRate24h: number;
  @ApiProperty() uptimeHours: number;
  @ApiProperty() inferences24h: number;
  @ApiProperty() seed: number;
  @ApiProperty({ nullable: true, type: Boolean }) meetsRnf01: boolean | null;
  @ApiProperty({ type: [String] }) warnings: string[];
  @ApiProperty() checkedAt: string;
}

export class AuditLogDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true, type: String }) userId: string | null;
  @ApiProperty({ nullable: true, type: String }) userEmail: string | null;
  @ApiProperty({ description: 'Código de la acción. Es por lo que se filtra y lo que se cita.' })
  action: string;
  @ApiProperty({ description: 'Nombre legible de la acción, para pintarlo sin traducir.' })
  actionLabel: string;
  @ApiProperty() entityType: string;
  @ApiProperty({ description: 'Nombre legible de la entidad tocada.' }) entityLabel: string;
  @ApiProperty({ nullable: true, type: String }) entityId: string | null;
  @ApiProperty({ nullable: true, type: String }) ipAddress: string | null;
  @ApiProperty({ nullable: true, type: String }) userAgent: string | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  metadata: Record<string, unknown> | null;
  @ApiProperty() createdAt: string;
}

/** One action name as it occurs in the trail, with how often. Feeds the filter of the audit view. */
export class AuditActionCountDto {
  @ApiProperty({ example: 'patient.identity.read' }) action: string;
  @ApiProperty({ example: 'Descifrado de identidad del paciente' }) actionLabel: string;
  @ApiProperty({ description: 'Veces que aparece en toda la traza.' }) count: number;
}
