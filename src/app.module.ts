import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditApiModule } from 'src/audit/audit-api.module';
import { AuditModule } from 'src/audit/audit.module';
import { AnamnesisModule } from 'src/anamnesis/anamnesis.module';
import { AuthModule } from 'src/auth/auth.module';
import { CaptureModule } from 'src/capture/capture.module';
import { CasesModule } from 'src/cases/cases.module';
import { CryptoModule } from 'src/common/crypto/crypto.module';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AppConfigModule } from 'src/config/config.module';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { CatalogConsistencyService } from 'src/database/catalog-consistency.service';
import { ENTITIES } from 'src/database/entities';
import { DiagnosesModule } from 'src/diagnoses/diagnoses.module';
import { HealthModule } from 'src/health/health.module';
import { ImagesModule } from 'src/images/images.module';
import { IndicatorsModule } from 'src/indicators/indicators.module';
import { InferenceModule } from 'src/inference/inference.module';
import { MetaModule } from 'src/meta/meta.module';
import { PatientsModule } from 'src/patients/patients.module';
import { PrescriptionsModule } from 'src/prescriptions/prescriptions.module';
import { QuestionsModule } from 'src/questions/questions.module';
import { SignaturesModule } from 'src/signatures/signatures.module';
import { ReportsModule } from 'src/reports/reports.module';
import { SessionsModule } from 'src/sessions/sessions.module';
import { StatsModule } from 'src/stats/stats.module';
import { StorageModule } from 'src/storage/storage.module';
import { StudyModule } from 'src/study/study.module';
import { SurveysModule } from 'src/surveys/surveys.module';
import { UsersModule } from 'src/users/users.module';

/**
 * Clinical orchestration API of the acne AI diagnosis prototype — Tesis UNT 2026.
 *
 * The three global guards run in order and each one protects a different invariant:
 *   1. JwtAuthGuard   — identity (RF-TR-02).
 *   2. RolesGuard     — authorisation (RF-TR-02); only `admin` exports raw datasets.
 *
 * Registering them globally means a new endpoint is protected by default: forgetting a decorator
 * can only ever make a route MORE restrictive, never accidentally expose the AI during pretest.
 */
@Module({
  imports: [
    AppConfigModule,
    CryptoModule,
    StorageModule,

    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres' as const,
        url: config.database.url,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
        entities: ENTITIES,
        synchronize: false,
        autoLoadEntities: false,
        /**
         * Ninguna consulta espera para siempre.
         *
         * La base vive en otra máquina, y un enlace que se cae a media consulta deja el socket
         * medio abierto: sin plazo, la promesa nunca se resuelve. Costó ver por qué: el obrero de
         * inferencia tomó un trabajo, su primera consulta se quedó colgada, y como el guardia
         * `draining` solo se suelta al terminar, la cola quedó muerta hasta reiniciar la API —
         * mientras la pantalla seguía diciendo «el modelo está leyendo el caso».
         *
         * `statement_timeout` lo corta en el servidor y `query_timeout` en el cliente, porque una
         * conexión rota no llega a enterarse de lo que decida el servidor. El `keepAlive` es lo
         * que hace que un enlace caído se note en segundos en vez de en el tiempo que tarde el
         * sistema operativo en rendirse.
         */
        connectTimeoutMS: config.database.connectTimeoutMs,
        extra: {
          statement_timeout: config.database.statementTimeoutMs,
          query_timeout: config.database.statementTimeoutMs,
          connectionTimeoutMillis: config.database.connectTimeoutMs,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
        },
        logging: config.nodeEnv === 'development' ? (['error', 'warn'] as const) : (['error'] as const),
      }),
    }),

    AuditModule,
    UsersModule,
    AuthModule,
    PatientsModule,
    PrescriptionsModule,
    QuestionsModule,
    SignaturesModule,
    ImagesModule,
    InferenceModule,
    StudyModule,
    SessionsModule,
    DiagnosesModule,
    CasesModule,
    AnamnesisModule,
    CaptureModule,
    SurveysModule,
    IndicatorsModule,
    StatsModule,
    ReportsModule,
    AuditApiModule,
    MetaModule,
    HealthModule,
  ],
  providers: [
    // Refuses to boot if the catalogue tables and `common/domain/` have drifted apart. See the
    // service for why both copies exist rather than one.
    CatalogConsistencyService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
