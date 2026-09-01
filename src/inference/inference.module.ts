import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { ImagesModule } from 'src/images/images.module';

import { AiEngineClient } from './ai-engine.client';
import { AiInference } from './ai-inference.entity';
import { InferenceController } from './inference.controller';
import { InferenceJob } from './inference-job.entity';
import { InferenceService } from './inference.service';
import { PostgresQueueProvider } from './queue/postgres-queue.provider';
import { QUEUE_PROVIDER, type QueueProvider } from './queue/queue.provider';

/** Covers: OE2, RF-TR-01, RF-TR-04. */
@Module({
  imports: [
    TypeOrmModule.forFeature([AiInference, InferenceJob]),
    ImagesModule,
    AuditModule,
  ],
  controllers: [InferenceController],
  providers: [
    AiEngineClient,
    PostgresQueueProvider,
    {
      provide: QUEUE_PROVIDER,
      inject: [APP_CONFIG, PostgresQueueProvider],
      useFactory: (config: AppConfig, postgres: PostgresQueueProvider): QueueProvider => {
        const logger = new Logger('InferenceModule');
        if (config.queue.driver === 'bullmq') {
          // Fail loudly rather than silently downgrading: if the deployment declares BullMQ, the
          // operator expects Redis-backed semantics and must know it is not what they got.
          throw new Error(
            'QUEUE_DRIVER=bullmq todavía no tiene implementación registrada. La interfaz ' +
              'QueueProvider está lista; falta añadir BullMqQueueProvider e instalar "bullmq" e ' +
              '"ioredis" cuando Redis esté disponible. Mientras tanto use QUEUE_DRIVER=postgres. ' +
              'Ver TRACEABILITY.md sección 4.',
          );
        }
        logger.log('QueueProvider: cola respaldada por PostgreSQL (QUEUE_DRIVER=postgres).');
        return postgres;
      },
    },
    InferenceService,
  ],
  exports: [InferenceService, AiEngineClient],
})
export class InferenceModule {}
