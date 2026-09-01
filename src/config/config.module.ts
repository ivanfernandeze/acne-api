import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { APP_CONFIG, loadConfiguration } from './configuration';

/**
 * Loads .env and exposes the validated, fully typed `AppConfig` under the `APP_CONFIG` token.
 * Validation happens eagerly at bootstrap so a misconfigured deployment fails immediately rather
 * than halfway through a clinical session.
 */
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] })],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfiguration }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
