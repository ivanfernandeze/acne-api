import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { ClinicalCase } from 'src/cases/case.entity';
import { AnamnesisModule } from 'src/anamnesis/anamnesis.module';
import { ImagesModule } from 'src/images/images.module';
import { InferenceModule } from 'src/inference/inference.module';
import { AiInference } from 'src/inference/ai-inference.entity';
import { SessionsModule } from 'src/sessions/sessions.module';
import { StudyModule } from 'src/study/study.module';

import { DiagnosesController } from './diagnoses.controller';
import { DiagnosesService } from './diagnoses.service';
import { Diagnosis } from './diagnosis.entity';

/** Covers: OE2, OE1 (cierre de TRᵢ), OE4 (conteo de NCR). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Diagnosis, ClinicalCase, AiInference]),
    StudyModule,
    SessionsModule,
    ImagesModule,
    AnamnesisModule,
    InferenceModule,
    AuditModule,
  ],
  controllers: [DiagnosesController],
  providers: [DiagnosesService],
  exports: [DiagnosesService],
})
export class DiagnosesModule {}
