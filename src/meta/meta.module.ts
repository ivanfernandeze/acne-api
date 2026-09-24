import { Module } from '@nestjs/common';

import { PrescriptionsModule } from 'src/prescriptions/prescriptions.module';
import { QuestionsModule } from 'src/questions/questions.module';

import { MetaController } from './meta.controller';

@Module({
  imports: [QuestionsModule, PrescriptionsModule],
  controllers: [MetaController],
})
export class MetaModule {}
