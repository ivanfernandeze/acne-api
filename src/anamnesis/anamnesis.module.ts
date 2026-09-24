import { Module } from '@nestjs/common';

import { QuestionsModule } from 'src/questions/questions.module';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';

import { AnamnesisAnswerOption } from './anamnesis-answer-option.entity';
import { AnamnesisAnswerRepository } from './anamnesis-answer.repository';
import { AnamnesisAnswerRow } from './anamnesis-answer.entity';
import { AnamnesisController } from './anamnesis.controller';
import { AnamnesisService } from './anamnesis.service';
import { CaseAnamnesis } from './case-anamnesis.entity';

/** Covers: extension requested by the research team, feeding RF-OE2-01. See TRACEABILITY.md. */
@Module({
  imports: [
    QuestionsModule,TypeOrmModule.forFeature([CaseAnamnesis, AnamnesisAnswerRow, AnamnesisAnswerOption]), AuditModule],
  controllers: [AnamnesisController],
  providers: [AnamnesisService, AnamnesisAnswerRepository],
  exports: [AnamnesisService, AnamnesisAnswerRepository],
})
export class AnamnesisModule {}
