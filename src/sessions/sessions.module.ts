import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';

import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { WorkSession } from './work-session.entity';

/** Covers: OE4. */
@Module({
  imports: [TypeOrmModule.forFeature([WorkSession]), AuditModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
