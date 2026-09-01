import { Module } from '@nestjs/common';

import { InferenceModule } from 'src/inference/inference.module';

import { AuditApiController } from './audit-api.controller';
import { AuditModule } from './audit.module';

/**
 * HTTP surface of the audit domain. Kept separate from `AuditModule` (which only provides
 * `AuditService`) so that the many domain modules depending on the service do not transitively
 * pull in the inference module and create a cycle.
 *
 * Covers: RNF-04, RF-TR-04, RNF-02.
 */
@Module({
  imports: [AuditModule, InferenceModule],
  controllers: [AuditApiController],
})
export class AuditApiModule {}
