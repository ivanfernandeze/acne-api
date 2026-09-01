import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

import { EncryptionService } from './encryption.service';

/**
 * Short-lived signed access tokens for clinical images.
 *
 * Covers: RNF-02 — "URLs firmadas de acceso (TTL 15 min)".
 *
 * Why not MinIO presigned URLs: images are encrypted with AES-256-GCM before they reach the
 * object store, so a presigned URL would hand the browser ciphertext. Instead the API issues a
 * signed token, and `GET /images/:id/content?token=...` verifies it, decrypts and streams. That
 * satisfies both "encrypted at rest" and "signed URL with a 15 minute TTL" at the same time, and
 * keeps every access auditable (RNF-02 log de auditoría por acceso a caso).
 */
@Injectable()
export class SignedUrlService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly encryption: EncryptionService,
  ) {
    this.ttlSeconds = config.security.signedUrlTtlSeconds;
  }

  /** Issues a token bound to one resource and one user, valid for `ttlSeconds`. */
  sign(resourceId: string, userId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const payload = `${resourceId}.${userId}.${expiresAt}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.encryption.hmac(payload)}`;
  }

  /**
   * Verifies a token against the resource it claims to unlock.
   * Returns the user id it was issued to, or `null` when invalid or expired.
   */
  verify(token: string, resourceId: string): string | null {
    const separator = token.lastIndexOf('.');
    if (separator <= 0) return null;

    const encodedPayload = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    let payload: string;
    try {
      payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    if (this.encryption.hmac(payload) !== signature) return null;

    const [tokenResourceId, userId, expiresAtRaw] = payload.split('.');
    if (tokenResourceId === undefined || userId === undefined || expiresAtRaw === undefined) {
      return null;
    }
    if (tokenResourceId !== resourceId) return null;

    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

    return userId;
  }

  /** Relative URL the frontend can use directly. */
  buildUrl(prefix: string, resourceId: string, userId: string, suffix = 'content'): string {
    return `${prefix}/images/${resourceId}/${suffix}?token=${this.sign(resourceId, userId)}`;
  }
}
