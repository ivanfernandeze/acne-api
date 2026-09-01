import { Global, Module } from '@nestjs/common';

import { EncryptionService } from './encryption.service';
import { SignedUrlService } from './signed-url.service';

/** Covers: RNF-02, RF-TR-03. */
@Global()
@Module({
  providers: [EncryptionService, SignedUrlService],
  exports: [EncryptionService, SignedUrlService],
})
export class CryptoModule {}
