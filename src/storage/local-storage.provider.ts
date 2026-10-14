import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import type { StorageProvider } from './storage.provider';

/**
 * Local filesystem backend. Default while MinIO credentials are pending.
 *
 * The stored bytes are ciphertext, so a copy of this directory leaks nothing without the
 * `ENCRYPTION_KEY` (RNF-02, Ley N.º 29733).
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly driver = 'local';
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = resolve(config.storage.localPath);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw new NotFoundException(`No se encontró el objeto "${key}" en el almacenamiento local.`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch {
      // Deleting an already absent object is not an error.
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      return { ok: true, detail: `Disco local en ${this.root}` };
    } catch (error: unknown) {
      return { ok: false, detail: `No se pudo acceder a ${this.root}: ${String(error)}` };
    }
  }

  /** Blocks path traversal: a crafted key must never escape the storage root. */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new NotFoundException('Clave de almacenamiento inválida.');
    }
    return target;
  }
}
