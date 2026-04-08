import type { Request, Response, NextFunction } from 'express';

/** Phase 2 dev stub — attaches hardcoded dev user. Replaced by real session auth in Phase 4. */
export function authStub(req: Request, _res: Response, next: NextFunction): void {
  req.user = { user_id: 'dev', username: 'dev', role: 'supervisor' };
  next();
}
