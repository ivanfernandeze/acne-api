import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { Diagnosis } from 'src/diagnoses/diagnosis.entity';

import { SurveyAnswer } from './survey-answer.entity';
import { SurveyResponse } from './survey-response.entity';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

/** Covers: OE3. */
@Module({
  imports: [TypeOrmModule.forFeature([SurveyResponse, SurveyAnswer, Diagnosis]), AuditModule],
  controllers: [SurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
