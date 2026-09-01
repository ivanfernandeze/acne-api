import type { Request } from 'express';

import type { StudyMode, UserRole } from 'src/common/domain';

/** The authenticated principal, resolved from the JWT on every protected request. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** RF-TR-01: the experimental condition this user is currently operating under. */
  studyMode: StudyMode;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
  fullName: string;
  role: UserRole;
  studyMode: StudyMode;
  type: 'access' | 'refresh';
}
