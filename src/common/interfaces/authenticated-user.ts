import type { Request } from 'express';

import type { UserRole } from 'src/common/domain';

/** The authenticated principal, resolved from the JWT on every protected request. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
  fullName: string;
  role: UserRole;
  type: 'access' | 'refresh';
}
