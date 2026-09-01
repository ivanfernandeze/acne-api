import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReviewTiming } from './review-timing.entity';
import { ReviewTimingService } from './review-timing.service';
import { StudyController } from './study.controller';

/** Covers: OE1 (cronometraje) and RF-TR-01 (control de la variable independiente). */
@Module({
  imports: [TypeOrmModule.forFeature([ReviewTiming])],
  controllers: [StudyController],
  providers: [ReviewTimingService],
  exports: [ReviewTimingService],
})
export class StudyModule {}
