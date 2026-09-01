import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the value recommended for GCM.
const AUTH_TAG_LENGTH = 16;

/**
 * Application-level AES-256-GCM encryption.
 *
 * Covers: RNF-02 (images and identifiable patient data encrypted at rest) and RF-TR-03
 * (patient names stay encrypted; only the treating dermatologist decrypts them).
 *
 * Encrypting in the application rather than relying on storage-side encryption is what lets the
 * same guarantee hold for the local disk driver and for MinIO alike.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.security.encryptionKey, 'hex');
  }

  /** Encrypts binary data. Output layout: iv | authTag | ciphertext. */
  encryptBuffer(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  /** Reverses `encryptBuffer`. Throws if the payload was tampered with (GCM auth tag). */
  decryptBuffer(payload: Buffer): Buffer {
    if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Payload cifrado inválido: longitud insuficiente.');
    }
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Encrypts a UTF-8 string into a base64 payload, for storage in a text column. */
  encryptString(plaintext: string): string {
    return this.encryptBuffer(Buffer.from(plaintext, 'utf8')).toString('base64');
  }

  decryptString(payload: string): string {
    return this.decryptBuffer(Buffer.from(payload, 'base64')).toString('utf8');
  }

  /** Null-tolerant variants, since most identifiable fields are optional. */
  encryptOptional(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    return this.encryptString(plaintext);
  }

  decryptOptional(payload: string | null | undefined): string | null {
    if (payload === null || payload === undefined || payload === '') return null;
    return this.decryptString(payload);
  }

  /** SHA-256 of a buffer, hex encoded. Used as the integrity fingerprint of stored images. */
  sha256(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  // --- Password hashing -----------------------------------------------------
  // scrypt from node:crypto: memory-hard, no native build step, and therefore no compilation
  // risk on the examiner's machine during the thesis defence.

  hashPassword(password: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split('$');
    const saltHex = parts[1];
    const hashHex = parts[2];
    if (parts[0] !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;

    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Keyed HMAC-SHA256, used to sign the short-lived image access tokens. */
  hmac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
