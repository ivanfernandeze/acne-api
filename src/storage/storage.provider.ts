/**
 * Storage abstraction for clinical images.
 *
 * Covers: RNF-02. The mandated stack is MinIO; with no MinIO credentials provisioned yet the
 * default implementation writes to local disk. Both receive bytes that are ALREADY encrypted with
 * AES-256-GCM by `ImagesService`, so the confidentiality guarantee does not depend on which
 * backend is active. Switching is one environment variable: `STORAGE_DRIVER=minio`.
 *
 * Declared as a deviation in TRACEABILITY.md section 4.
 */
export interface StorageProvider {
  /** Identifier persisted on each image row, so a file can always be traced to its backend. */
  readonly driver: string;

  put(key: string, data: Buffer, contentType: string): Promise<void>;

  get(key: string): Promise<Buffer>;

  remove(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /** Reports whether the backend is reachable; surfaced by `GET /health`. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
