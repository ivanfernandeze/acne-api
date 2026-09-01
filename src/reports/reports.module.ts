import { Module } from '@nestjs/common';

import { AuditModule } from 'src/audit/audit.module';
import { IndicatorsModule } from 'src/indicators/indicators.module';
import { InferenceModule } from 'src/inference/inference.module';
import { StatsModule } from 'src/stats/stats.module';
import { SurveysModule } from 'src/surveys/surveys.module';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Covers: RNF-06 y entregables de la Sección 11. */
@Module({
  imports: [IndicatorsModule, StatsModule, SurveysModule, InferenceModule, AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
