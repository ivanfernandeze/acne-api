import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, LessThan, Repository } from 'typeorm';

import { ClinicalCase } from 'src/cases/case.entity';
import {
  CAPTURE_DEFAULT_MAX_UPLOADS,
  CLINICAL_DISCLAIMER,
  SHOT_DEFINITIONS,
  type ShotKey,
} from 'src/common/domain';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { ImagesService, type UploadedImage } from 'src/images/images.service';

import { CaptureSession } from './capture-session.entity';
import type {
  CaptureSessionContextDto,
  CaptureSessionCreatedDto,
  CaptureSessionStatusDto,
  CaptureUploadResultDto,
} from './dto/capture.dto';

/**
 * Mobile capture sessions.
 *
 * A session is a short-lived, single-case, upload-only capability handed over as a QR code. The
 * design constraints that shaped it:
 *
 *  - **The upload route is public.** A phone at the clinic has no account and no JWT, and inventing
 *    patient authentication for one photograph is not something the study asked for. What bounds the
 *    damage of a leaked link is therefore the token's short life, the per-session upload cap and the
 *    fact that the capability only ADDS images — it can never read, list or delete one.
 *  - **The token is never stored.** Only its SHA-256 is, so a database dump yields no working link.
 *  - **The session dies when the chronometer starts.** Photographs belong to intake; anything
 *    happening between t₀ and t₁ would inflate the TRM that OE1 measures (RF-OE1-01).
 */
@Injectable()
export class CaptureService {
  constructor(
    @InjectRepository(CaptureSession) private readonly repository: Repository<CaptureSession>,
    @InjectRepository(ClinicalCase) private readonly cases: Repository<ClinicalCase>,
    private readonly images: ImagesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    caseId: string,
    userId: string,
    maxUploads?: number,
  ): Promise<CaptureSessionCreatedDto> {
    const clinicalCase = await this.cases.findOne({ where: { id: caseId } });
    if (clinicalCase === null) throw new NotFoundException(`No existe el caso ${caseId}.`);
    if (clinicalCase.status === 'cerrado') {
      throw new BadRequestException('El caso está cerrado: no admite fotografías nuevas.');
    }

    // One live session per case. Opening a second QR while the first is still valid would leave two
    // working links for the same case and nobody able to say which was handed to whom.
    await this.revokeActiveForCase(caseId);

    // 32 bytes of entropy. Long enough that the token cannot be guessed within its 15-minute life,
    // short enough that the QR stays comfortably scannable on a phone.
    const token = randomBytes(32).toString('base64url');

    const session = this.repository.create({
      caseId,
      tokenHash: hashToken(token),
      createdBy: userId,
      expiresAt: new Date(Date.now() + this.config.security.captureSessionTtlSeconds * 1000),
      maxUploads: maxUploads ?? CAPTURE_DEFAULT_MAX_UPLOADS,
      uploadCount: 0,
    });
    const saved = await this.repository.save(session);

    return {
      id: saved.id,
      caseId,
      caseCode: clinicalCase.caseCode,
      token,
      expiresAt: saved.expiresAt.toISOString(),
      maxUploads: saved.maxUploads,
    };
  }

  /** What the phone is shown. Carries the case code and never the patient's name (RF-TR-03). */
  async context(token: string): Promise<CaptureSessionContextDto> {
    const session = await this.requireLive(token);
    const clinicalCase = await this.cases.findOne({ where: { id: session.caseId } });
    if (clinicalCase === null) throw new NotFoundException('La sesión de captura ya no es válida.');

    const images = await this.images.findByCase(session.caseId);
    const shots = SHOT_DEFINITIONS.map((shot) => ({
      key: shot.key,
      label: shot.label,
      instruction: shot.instruction,
      required: shot.required,
      uploaded: images.filter((image) => image.shotKey === shot.key).length,
    }));

    return {
      caseCode: clinicalCase.caseCode,
      expiresAt: session.expiresAt.toISOString(),
      remainingSeconds: remainingSeconds(session),
      uploadCount: session.uploadCount,
      maxUploads: session.maxUploads,
      shots,
      disclaimer: CLINICAL_DISCLAIMER,
    };
  }

  /**
   * Accepts one photograph from the phone.
   *
   * The upload is credited to the user who opened the session, not to nobody: the audit trail has to
   * name a responsible person even though the request itself carried no identity (RNF-02).
   */
  async upload(
    token: string,
    file: UploadedImage,
    shotKey: ShotKey | null,
  ): Promise<{ result: CaptureUploadResultDto; session: CaptureSession }> {
    const session = await this.requireLive(token);

    if (session.uploadCount >= session.maxUploads) {
      throw new BadRequestException(
        `Esta sesión alcanzó su límite de ${session.maxUploads} fotografías. Pida al centro un código nuevo.`,
      );
    }

    const { image, warnings } = await this.images.upload(
      session.caseId,
      file,
      session.createdBy,
      shotKey,
    );

    session.uploadCount += 1;
    session.lastUsedAt = new Date();
    const updated = await this.repository.save(session);

    return {
      result: {
        image: {
          id: image.id,
          shotKey: image.shotKey,
          createdAt: image.createdAt.toISOString(),
        },
        uploadCount: updated.uploadCount,
        maxUploads: updated.maxUploads,
        // The photograph was accepted; these are things worth doing better on the next shot. They
        // reach the phone so the person holding it can fix them while the patient is still there.
        warnings,
      },
      session: updated,
    };
  }

  /** The live session of a case, so the desktop can reopen the QR after a reload. */
  async activeForCase(caseId: string): Promise<CaptureSessionStatusDto | null> {
    const session = await this.repository.findOne({
      where: { caseId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (session === null || remainingSeconds(session) <= 0) return null;
    return this.toStatus(session);
  }

  async status(id: string): Promise<CaptureSessionStatusDto> {
    const session = await this.repository.findOne({ where: { id } });
    if (session === null) throw new NotFoundException(`No existe la sesión de captura ${id}.`);
    return this.toStatus(session);
  }

  async revoke(id: string): Promise<CaptureSessionStatusDto> {
    const session = await this.repository.findOne({ where: { id } });
    if (session === null) throw new NotFoundException(`No existe la sesión de captura ${id}.`);
    if (session.revokedAt === null) {
      session.revokedAt = new Date();
      await this.repository.save(session);
    }
    return this.toStatus(session);
  }

  /**
   * Revokes every live session of a case.
   *
   * Called when the case file is opened for review: t₀ has been stamped and the measured window has
   * begun, so a phone must no longer be able to add images to it.
   */
  async revokeActiveForCase(caseId: string): Promise<number> {
    const result = await this.repository.update(
      { caseId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /** Housekeeping: sessions that ran out of time and were never used again. */
  async purgeExpired(olderThan: Date): Promise<number> {
    const result = await this.repository.delete({ expiresAt: LessThan(olderThan) });
    return result.affected ?? 0;
  }

  /**
   * Resolves a plaintext token to a session that may still be used.
   *
   * Expired, revoked and non-existent all answer the same 404. Distinguishing them would let a
   * caller probe which case codes exist by watching the error change.
   */
  private async requireLive(token: string): Promise<CaptureSession> {
    if (typeof token !== 'string' || token.length < 16) {
      throw new NotFoundException('El enlace de captura no es válido.');
    }

    const session = await this.repository.findOne({ where: { tokenHash: hashToken(token) } });
    if (session === null || session.revokedAt !== null || remainingSeconds(session) <= 0) {
      throw new NotFoundException(
        'El enlace de captura no es válido o ya caducó. Pida al centro un código QR nuevo.',
      );
    }
    return session;
  }

  private toStatus(session: CaptureSession): CaptureSessionStatusDto {
    const remaining = remainingSeconds(session);
    return {
      id: session.id,
      caseId: session.caseId,
      expiresAt: session.expiresAt.toISOString(),
      remainingSeconds: remaining,
      uploadCount: session.uploadCount,
      maxUploads: session.maxUploads,
      revokedAt: session.revokedAt?.toISOString() ?? null,
      active: session.revokedAt === null && remaining > 0,
    };
  }

}

/** Lookup is by digest, so the plaintext token never has to exist in the database. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function remainingSeconds(session: CaptureSession): number {
  return Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
}
