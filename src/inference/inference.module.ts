import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnamnesisModule } from 'src/anamnesis/anamnesis.module';
import { AuditModule } from 'src/audit/audit.module';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { ImagesModule } from 'src/images/images.module';
import { QuestionsModule } from 'src/questions/questions.module';

import { AiEngineModule } from './ai-engine.module';
import { AiInference } from './ai-inference.entity';
import { AssessmentDetail } from './assessment-detail.entity';
import { InferenceAssessment } from './inference-assessment.entity';
import { InferenceMember } from './inference-member.entity';
import { InferenceProbability } from './inference-probability.entity';
import { InferenceController } from './inference.controller';
import { InferenceJob } from './inference-job.entity';
import { InferenceService } from './inference.service';
import { PostgresQueueProvider } from './queue/postgres-queue.provider';
import { ChosenReading } from './chosen-reading.entity';
import { QUEUE_PROVIDER, type QueueProvider } from './queue/queue.provider';

/** Covers: OE2, RF-TR-01, RF-TR-04. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiInference,
      InferenceJob,
      InferenceProbability,
      InferenceAssessment,
      AssessmentDetail,
      InferenceMember,
      ChosenReading,
    ]),
    ImagesModule,
    AuditModule,
    AiEngineModule,
    // Por `AnamnesisAnswerRepository`: la lectura del modelo se contextualiza con la anamnesis del
    // caso, anonimizada, y esas respuestas viven ahora en filas y no en una columna jsonb.
    AnamnesisModule,
    // Por `QuestionsService.catalogue()`: el enunciado que lee el modelo sale de la tabla de
    // preguntas, que es quien manda desde que el cuestionario es administrable.
    QuestionsModule,
  ],
  controllers: [InferenceController],
  providers: [
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
  exports: [InferenceService, AiEngineModule],
})
export class InferenceModule {}
