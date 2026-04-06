import { Request, Response, NextFunction } from 'express';

/**
 * Shape of errors thrown by CARO route handlers.
 * Extends the base Error with the platform-envelope fields
 * read by errorHandler: code (error key), status (HTTP code), details (optional payload).
 */
export interface CaroError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

/**
 * Generic Express error handler — formats errors into the platform envelope.
 * Throw errors with err.status (HTTP code), err.code (string), and optionally err.details.
 */
export function errorHandler(
  err: CaroError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const code    = err.code    || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred';
  const status  = err.status  || 500;

  console.error(`[${code}] ${message}`, err);

  res.status(status).json({
    ok: false,
    error: { code, message, details: err.details || undefined },
  });
}
