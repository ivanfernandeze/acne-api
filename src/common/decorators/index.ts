import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { UserRole } from 'src/common/domain';
import type { AuthenticatedRequest, AuthenticatedUser } from 'src/common/interfaces/authenticated-user';

/** Marks a route as reachable without a JWT (login, health, OpenAPI). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the listed roles. Covers: RF-TR-02. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Marks a route as part of the AI module.
 *
 * `StudyModeGuard` rejects these with 403 whenever the caller's `study_mode` is `pretest`.
 * This is the server-side half of RF-TR-01: hiding the AI in the UI is not enough to protect the
 * internal validity of the pretest observation.
 */
export const REQUIRES_AI_KEY = 'requiresAi';
export const RequiresAiEnabled = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_AI_KEY, true);

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (user === undefined) return undefined;
    return data === undefined ? user : user[data];
  },
);
