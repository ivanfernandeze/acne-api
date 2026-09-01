import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

/**
 * Only the service is exported here. The audit CONTROLLER (thesis coverage and IIA check) lives
 * in `AuditApiModule` to avoid a dependency cycle: half the domain modules need `AuditService`,
 * and the audit controller in turn needs the inference module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
