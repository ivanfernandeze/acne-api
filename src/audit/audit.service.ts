import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthenticatedRequest, AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

import { AuditLog } from './audit-log.entity';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append-only audit trail. Covers: RNF-02 ("logs de auditoría por acceso a caso").
 *
 * Failures to write an audit row are logged but never propagated: losing the trail of one read is
 * bad, but blocking a physician mid-consultation because of it is worse.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  async record(
    user: AuthenticatedUser | null | undefined,
    input: AuditInput,
    request?: AuthenticatedRequest,
  ): Promise<void> {
    try {
      await this.repository.save(
        this.repository.create({
          userId: user?.id ?? null,
          userEmail: user?.email ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          ipAddress: request === undefined ? null : this.resolveIp(request),
          userAgent: this.truncate(request?.headers['user-agent'], 255),
          metadata: input.metadata ?? null,
        }),
      );
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo registrar la auditoría de "${input.action}": ${String(error)}`,
      );
    }
  }

  async findRecent(limit = 100, action?: string): Promise<AuditLog[]> {
    return this.repository.find({
      where: action === undefined ? {} : { action },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  private resolveIp(request: AuthenticatedRequest): string | null {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return this.truncate(forwarded.split(',')[0]?.trim(), 64);
    }
    return this.truncate(request.ip, 64);
  }

  private truncate(value: string | undefined | null, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    return value.length > max ? value.slice(0, max) : value;
  }
}
