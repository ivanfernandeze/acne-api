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
  /**
   * Who to hold responsible when the request carried no principal of its own — a photograph
   * arriving through a mobile capture session, authorised by its QR token rather than by a login.
   * Without it the trail would record an anonymous write to a clinical record, which is exactly the
   * kind of entry RNF-02 exists to prevent.
   */
  actorId?: string | null;
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
          userId: user?.id ?? input.actorId ?? null,
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
      where: action === undefined || action === '' ? {} : { action },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  /**
   * The action names that actually occur in the trail, with how many times each one does.
   *
   * Derived from the rows rather than from a constant on purpose. The catalogue of actions is not
   * declared anywhere — each one is a string literal at its own call site — so a hard-coded list
   * would have gone stale the first time an endpoint was added, and the filter would then hide
   * exactly the events nobody knew to look for.
   */
  async actionSummary(): Promise<Array<{ action: string; count: number }>> {
    const rows = await this.repository
      .createQueryBuilder('log')
      .select('log.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.action')
      .orderBy('log.action', 'ASC')
      .getRawMany<{ action: string; count: string }>();

    return rows.map((row) => ({ action: row.action, count: Number(row.count) }));
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
