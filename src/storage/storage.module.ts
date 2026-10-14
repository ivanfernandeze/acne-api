import { Global, Logger, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import { LocalStorageProvider } from './local-storage.provider';
import { MinioStorageProvider } from './minio-storage.provider';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.provider';

/**
 * Resolves the storage backend from `STORAGE_DRIVER`.
 *
 * If `minio` is selected but no credentials are set, the module falls back to local disk and says
 * so loudly rather than failing at the first image upload during a clinical session.
 */
@Global()
@Module({
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [APP_CONFIG, LocalStorageProvider],
      useFactory: (config: AppConfig, local: LocalStorageProvider): StorageProvider => {
        const logger = new Logger('StorageModule');
        if (config.storage.driver !== 'minio') {
          logger.log('StorageProvider: disco local (STORAGE_DRIVER=local).');
          return local;
        }
        const { accessKey, secretKey } = config.storage.minio;
        if (accessKey === '' || secretKey === '') {
          logger.warn(
            'STORAGE_DRIVER=minio pero faltan MINIO_ACCESS_KEY / MINIO_SECRET_KEY. ' +
              'Se usa disco local como respaldo.',
          );
          return local;
        }
        logger.log(`StorageProvider: MinIO, bucket "${config.storage.minio.bucket}".`);
        return new MinioStorageProvider(config);
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
