import { Module } from '@nestjs/common';

import { MessagingModule } from 'src/messaging/messaging.module';
import { SignaturesModule } from 'src/signatures/signatures.module';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { CryptoModule } from 'src/common/crypto/crypto.module';

import { MedicationIndication } from './medication-indication.entity';
import { Medication } from './medication.entity';
import { MedicationsService } from './medications.service';
import { PrescriptionDelivery } from './prescription-delivery.entity';
import { PrescriptionItem } from './prescription-item.entity';
import { Prescription } from './prescription.entity';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { PrescriptionsService } from './prescriptions.service';

@Module({
  imports: [
    MessagingModule,
    SignaturesModule,
    TypeOrmModule.forFeature([
      Prescription,
      PrescriptionItem,
      PrescriptionDelivery,
      Medication,
      MedicationIndication,
    ]),
    CryptoModule,
    AuditModule,
  ],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService, MedicationsService, PrescriptionPdfService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
