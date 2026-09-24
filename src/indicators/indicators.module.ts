import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { SurveysModule } from 'src/surveys/surveys.module';

import { IndicatorObservation } from './indicator-observation.entity';
import { IndicatorSnapshot } from './indicator-snapshot.entity';
import { IndicatorsController } from './indicators.controller';
import { IndicatorsService } from './indicators.service';

/** Covers: OE1, OE2, OE3, OE4, RNF-05. */
@Module({
  imports: [TypeOrmModule.forFeature([IndicatorSnapshot, IndicatorObservation]), SurveysModule, AuditModule],
  controllers: [IndicatorsController],
  providers: [IndicatorsService],
  exports: [IndicatorsService],
})
export class IndicatorsModule {}
