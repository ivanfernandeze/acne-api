import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';

import { Consent } from './consent.entity';
import { Patient } from './patient.entity';
import { PatientHistoryService } from './patient-history.service';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, Consent]), AuditModule],
  controllers: [PatientsController],
  providers: [PatientsService, PatientHistoryService],
  exports: [PatientsService, PatientHistoryService],
})
export class PatientsModule {}
