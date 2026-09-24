import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { ClinicalCase } from 'src/cases/case.entity';
import { ImagesModule } from 'src/images/images.module';

import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';
import { CaptureSession } from './capture-session.entity';

/** Covers: section 9.3 of the specification (photograph intake from the phone) and RNF-02. */
@Module({
  imports: [TypeOrmModule.forFeature([CaptureSession, ClinicalCase]), ImagesModule, AuditModule],
  controllers: [CaptureController],
  providers: [CaptureService],
  exports: [CaptureService],
})
export class CaptureModule {}
