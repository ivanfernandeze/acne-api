import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from 'src/common/decorators';
import { USER_ROLE_LABELS, type UserRole } from 'src/common/domain';
import type { AuthenticatedRequest } from 'src/common/interfaces/authenticated-user';

/** Enforces `@Roles(...)`. Covers: RF-TR-02 (only `admin` exports the raw study datasets). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user === undefined) throw new ForbiddenException('Usuario no autenticado.');
    if (required.includes(user.role)) return true;

    const allowed = required.map((r) => USER_ROLE_LABELS[r]).join(', ');
    throw new ForbiddenException(
      `Su rol (${USER_ROLE_LABELS[user.role]}) no tiene permiso para esta operación. Roles autorizados: ${allowed}.`,
    );
  }
}
