import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

import { Public } from 'src/common/decorators';
import { AiEngineClient } from 'src/inference/ai-engine.client';
import { STORAGE_PROVIDER, type StorageProvider } from 'src/storage/storage.provider';

interface HealthCheck {
  ok: boolean;
  detail: string;
}

/** Liveness and dependency check. Demo requirement of Phase 1 of CRISP-DM. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly aiEngine: AiEngineClient,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado del servicio y de sus dependencias.' })
  async health(): Promise<{
    status: 'ok' | 'degraded';
    service: string;
    version: string;
    checks: Record<string, HealthCheck>;
    timestamp: string;
  }> {
    const [database, storage, aiEngine] = await Promise.all([
      this.checkDatabase(),
      this.storage.healthCheck(),
      this.aiEngine.health(),
    ]);

    const checks = { database, storage, aiEngine };
    // The API is only "ok" if the clinical database answers. A missing AI engine degrades the
    // service but does not stop timings, surveys or statistics from being recorded.
    return {
      status: database.ok ? 'ok' : 'degraded',
      service: 'acne-api',
      version: '0.1.0',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true, detail: 'PostgreSQL accesible' };
    } catch (error: unknown) {
      return { ok: false, detail: `PostgreSQL inaccesible: ${String(error)}` };
    }
  }
}
