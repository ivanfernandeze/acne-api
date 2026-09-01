import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRES_AI_KEY } from 'src/common/decorators';
import { STUDY_MODE_LABELS, aiAllowedIn } from 'src/common/domain';
import type { AuthenticatedRequest } from 'src/common/interfaces/authenticated-user';

/**
 * Logical lock of the independent variable.
 *
 * Covers: RF-TR-01 and section 2 of the specification — "Bloqueo lógico del módulo de IA cuando
 * study_mode = 'pretest'".
 *
 * Why a server-side guard and not just a hidden button: the pretest observation (O1) is only
 * valid if the physician truly diagnosed without AI assistance. If the endpoint stayed reachable,
 * a stray client call — a cached page, a retried request, a curious tester — would contaminate
 * the measurement and there would be no way to tell afterwards which of the 30 cases were
 * affected. Returning 403 makes the experimental condition an enforceable invariant rather than a
 * UI convention.
 */
@Injectable()
export class StudyModeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresAi = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRES_AI_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresAi !== true) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user === undefined) throw new ForbiddenException('Usuario no autenticado.');

    if (!aiAllowedIn(user.studyMode)) {
      throw new ForbiddenException({
        message:
          'El módulo de inteligencia artificial está bloqueado en modo pretest (IIA = 0). ' +
          'Este bloqueo protege la validez interna de la observación O₁ del diseño ' +
          'preexperimental: en pretest el diagnóstico debe emitirse sin asistencia de la IA.',
        studyMode: user.studyMode,
        studyModeLabel: STUDY_MODE_LABELS[user.studyMode],
        requirement: 'RF-TR-01',
      });
    }
    return true;
  }
}
