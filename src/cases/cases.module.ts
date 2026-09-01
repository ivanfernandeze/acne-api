import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { DiagnosesModule } from 'src/diagnoses/diagnoses.module';
import { ImagesModule } from 'src/images/images.module';
import { InferenceModule } from 'src/inference/inference.module';
import { StudyModule } from 'src/study/study.module';

import { ClinicalCase } from './case.entity';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

/** Covers: RF-TR-01, RF-TR-03, OE1. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ClinicalCase]),
    ImagesModule,
    InferenceModule,
    StudyModule,
    DiagnosesModule,
    AuditModule,
  ],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
