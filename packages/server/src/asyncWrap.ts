import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Async Express handler — accepts either a sync or async route handler.
 * Used as the parameter type for asyncWrap.
 */
export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

/**
 * Async error wrapper for Express route handlers.
 * Catches async errors and forwards to the next error handler.
 */
export function asyncWrap(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
