import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditApiModule } from 'src/audit/audit-api.module';
import { AuditModule } from 'src/audit/audit.module';
import { AuthModule } from 'src/auth/auth.module';
import { CasesModule } from 'src/cases/cases.module';
import { CryptoModule } from 'src/common/crypto/crypto.module';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AppConfigModule } from 'src/config/config.module';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { ENTITIES } from 'src/database/entities';
import { DiagnosesModule } from 'src/diagnoses/diagnoses.module';
import { HealthModule } from 'src/health/health.module';
import { ImagesModule } from 'src/images/images.module';
import { IndicatorsModule } from 'src/indicators/indicators.module';
import { InferenceModule } from 'src/inference/inference.module';
import { MetaModule } from 'src/meta/meta.module';
import { PatientsModule } from 'src/patients/patients.module';
import { ReportsModule } from 'src/reports/reports.module';
import { SessionsModule } from 'src/sessions/sessions.module';
import { StatsModule } from 'src/stats/stats.module';
import { StorageModule } from 'src/storage/storage.module';
import { StudyModeGuard } from 'src/study/study-mode.guard';
import { StudyModule } from 'src/study/study.module';
import { SurveysModule } from 'src/surveys/surveys.module';
import { UsersModule } from 'src/users/users.module';

/**
 * Clinical orchestration API of the acne AI diagnosis prototype — Tesis UNT 2026.
 *
 * The three global guards run in order and each one protects a different invariant:
 *   1. JwtAuthGuard   — identity (RF-TR-02).
 *   2. RolesGuard     — authorisation (RF-TR-02); only `admin` exports raw datasets.
 *   3. StudyModeGuard — the independent variable (RF-TR-01); 403 on AI routes in pretest.
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
        logging: config.nodeEnv === 'development' ? (['error', 'warn'] as const) : (['error'] as const),
      }),
    }),

    AuditModule,
    UsersModule,
    AuthModule,
    PatientsModule,
    ImagesModule,
    InferenceModule,
    StudyModule,
    SessionsModule,
    DiagnosesModule,
    CasesModule,
    SurveysModule,
    IndicatorsModule,
    StatsModule,
    ReportsModule,
    AuditApiModule,
    MetaModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: StudyModeGuard },
  ],
})
export class AppModule {}
