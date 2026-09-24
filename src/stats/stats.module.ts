import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { IndicatorsModule } from 'src/indicators/indicators.module';
import { InferenceModule } from 'src/inference/inference.module';

import { DatasetExportService } from './dataset-export.service';
import { HypothesisPair } from './hypothesis-pair.entity';
import { HypothesisRun } from './hypothesis-run.entity';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/** Covers: HE₁–HE₄, OG, RNF-05, RF-TR-02. */
@Module({
  imports: [
    TypeOrmModule.forFeature([HypothesisRun, HypothesisPair]),
    IndicatorsModule,
    InferenceModule,
    AuditModule,
  ],
  controllers: [StatsController],
  providers: [StatsService, DatasetExportService],
  exports: [StatsService, DatasetExportService],
})
export class StatsModule {}
