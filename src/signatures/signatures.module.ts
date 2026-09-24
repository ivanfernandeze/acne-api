import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from 'src/audit/audit.module';
import { CryptoModule } from 'src/common/crypto/crypto.module';
import { StorageModule } from 'src/storage/storage.module';
import { User } from 'src/users/user.entity';

import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), StorageModule, CryptoModule, AuditModule],
  controllers: [SignaturesController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
