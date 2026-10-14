import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import type { StorageProvider } from './storage.provider';

/**
 * MinIO / S3-compatible backend — the storage mandated by section 5 of the specification.
 *
 * Activated with `STORAGE_DRIVER=minio`. The objects written here are AES-256-GCM ciphertext, so
 * the bucket never holds readable clinical imagery even if the MinIO instance were exposed.
 * That is also why images are served through `GET /images/:id/content` with a signed token
 * instead of a MinIO presigned URL: a presigned URL would hand the browser the ciphertext.
 */
@Injectable()
export class MinioStorageProvider implements StorageProvider, OnModuleInit {
  readonly driver = 'minio';
  private readonly logger = new Logger(MinioStorageProvider.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const { minio } = config.storage;
    this.bucket = minio.bucket;
    this.client = new Client({
      endPoint: minio.endPoint,
      port: minio.port,
      useSSL: minio.useSSL,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Bucket "${this.bucket}" creado en MinIO.`);
      }
    } catch (error: unknown) {
      // Do not crash the API: the rest of the study (timings, surveys, statistics) must keep
      // working even if the object store is temporarily unreachable.
      this.logger.error(`No se pudo inicializar el bucket "${this.bucket}": ${String(error)}`);
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, data, data.length, {
      'Content-Type': contentType,
    });
  }

  async get(key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      return Buffer.concat(chunks);
    } catch {
      throw new NotFoundException(`No se encontró el objeto "${key}" en MinIO.`);
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      return exists
        ? { ok: true, detail: `MinIO, bucket "${this.bucket}"` }
        : { ok: false, detail: `El bucket "${this.bucket}" no existe.` };
    } catch (error: unknown) {
      return { ok: false, detail: `MinIO inaccesible: ${String(error)}` };
    }
  }
}
