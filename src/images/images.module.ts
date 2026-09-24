import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { AiEngineModule } from 'src/inference/ai-engine.module';

import { CaseImage } from './case-image.entity';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

/** Covers: RNF-02. */
@Module({
  imports: [TypeOrmModule.forFeature([CaseImage]), AuditModule, AiEngineModule],
  controllers: [ImagesController],
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
