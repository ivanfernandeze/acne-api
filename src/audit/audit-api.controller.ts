import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public, Roles } from 'src/common/decorators';
import { InferenceService } from 'src/inference/inference.service';
import { AiEngineClient } from 'src/inference/ai-engine.client';

import { AuditLogDto, IiaCheckDto, ThesisCoverageDto } from './dto/audit.dto';
import { AuditService } from './audit.service';
import { COVERAGE_REGISTRY, type CoverageEntry, type CoverageStatus } from './thesis-coverage.registry';

/**
 * Thesis traceability and verification of the independent variable.
 *
 * Covers: RNF-04 (`/audit/thesis-coverage`) and RF-TR-04 (`/audit/iia-check`).
 */
@ApiTags('audit')
@Controller('audit')
export class AuditApiController {
  constructor(
    private readonly auditService: AuditService,
    private readonly aiEngine: AiEngineClient,
    private readonly inferenceService: InferenceService,
  ) {}

  @Public()
  @Get('thesis-coverage')
  @ApiOperation({
    summary: 'Matriz de cobertura OG · OE1 · OE2 · OE3 · OE4 (RNF-04).',
    description:
      'La cobertura se calcula, no se declara: si el motor opera con el clasificador stub, OE2 y ' +
      'OG bajan automáticamente a `partial` y se listan los bloqueantes. La tesis no puede ' +
      'afirmar IIA = 1 mientras no exista un modelo entrenado.',
  })
  async thesisCoverage(): Promise<ThesisCoverageDto> {
    const blockers: string[] = [];
    let modelOperational = false;
    let modelBackend = 'desconocido';

    try {
      const iia = await this.aiEngine.iiaCheck();
      modelOperational = iia.operational;
      modelBackend = iia.model_backend;
      if (!iia.operational) blockers.push(...iia.warnings);
    } catch (error: unknown) {
      blockers.push(
        `El motor de IA no responde, por lo que no puede verificarse IIA: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const entries: CoverageEntry[] = COVERAGE_REGISTRY.map((entry) => {
      if (modelOperational) return entry;
      if (entry.objective === 'OE2') {
        return {
          ...entry,
          status: 'partial' as CoverageStatus,
          notes:
            `${entry.notes ?? ''} La tubería está implementada y verificada, pero el motor opera ` +
            `con backend "${modelBackend}": falta sustituir el stub por pesos entrenados.`,
        };
      }
      if (entry.objective === 'OG') {
        return {
          ...entry,
          status: 'partial' as CoverageStatus,
          notes: `${entry.notes ?? ''} Bloqueado por OE2.`,
        };
      }
      if (entry.objective === 'IIA') {
        return {
          ...entry,
          status: 'partial' as CoverageStatus,
          notes: `${entry.notes ?? ''} /audit/iia-check reporta operational = false.`,
        };
      }
      return entry;
    });

    if (!modelOperational && blockers.length === 0) {
      blockers.push('No hay un modelo CNN entrenado: el motor responde con el stub determinista.');
    }

    const covered = entries.filter((e) => e.status === 'covered').length;

    return {
      generatedAt: new Date().toISOString(),
      coveragePct: Math.round((covered / entries.length) * 10000) / 100,
      entries,
      blockers,
      traceabilityDocument: 'acne-infra/TRACEABILITY.md',
    };
  }

  @Public()
  @Get('iia-check')
  @ApiOperation({
    summary: 'Ficha técnica de operatividad del modelo — instrumento que valida IIA = 1 (RF-TR-04).',
    description:
      'Combina lo que reporta el motor con la latencia medida de extremo a extremo por el ' +
      'orquestador, que es la que el paciente y el médico realmente experimentan y la que RNF-01 ' +
      'acota (p95 ≤ 2 s en GPU, ≤ 8 s en CPU).',
  })
  async iiaCheck(): Promise<IiaCheckDto> {
    const [engine, orchestrator] = await Promise.all([
      this.aiEngine.iiaCheck(),
      this.inferenceService.latencyStats24h(),
    ]);

    const warnings = [...engine.warnings];
    const p95 = orchestrator.p95Ms;
    // RNF-01 uses the CPU budget as the ceiling any deployment must meet.
    const meetsRnf01 = p95 === null ? null : p95 <= 8000;
    if (meetsRnf01 === false) {
      warnings.push(
        `La latencia p95 medida por el orquestador es de ${p95} ms y excede el máximo de 8000 ms ` +
          'que fija RNF-01 para CPU.',
      );
    }

    return {
      operational: engine.operational,
      modelBackend: engine.model_backend,
      version: engine.version,
      weightsChecksum: engine.weights_checksum,
      engineLatencyMedian24hMs: engine.latency_median_24h_ms,
      engineLatencyP95_24hMs: engine.latency_p95_24h_ms,
      orchestratorLatencyMedian24hMs: orchestrator.medianMs,
      orchestratorLatencyP95_24hMs: orchestrator.p95Ms,
      errorRate24h: orchestrator.errorRate,
      uptimeHours: Math.round(orchestrator.uptimeHours * 100) / 100,
      inferences24h: orchestrator.count,
      seed: engine.seed,
      meetsRnf01,
      warnings,
      checkedAt: new Date().toISOString(),
    };
  }

  @Get('logs')
  @ApiBearerAuth()
  @Roles('admin', 'evaluador_estadistico')
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({ summary: 'Traza de auditoría append-only (RNF-02).' })
  async logs(
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditLogDto[]> {
    const logs = await this.auditService.findRecent(
      limit === undefined ? 100 : Number(limit),
      action,
    );
    return logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() }));
  }
}
