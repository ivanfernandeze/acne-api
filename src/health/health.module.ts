import { Module } from '@nestjs/common';

import { InferenceModule } from 'src/inference/inference.module';

import { HealthController } from './health.controller';

@Module({
  imports: [InferenceModule],
  controllers: [HealthController],
})
export class HealthModule {}
