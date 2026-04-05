/**
 * Generic Express error handler — formats errors into the platform envelope.
 * Throw errors with err.status (HTTP code), err.code (string), and optionally err.details.
 */
export function errorHandler(err, req, res, next) {
  const code    = err.code    || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred';
  const status  = err.status  || 500;

  console.error(`[${code}] ${message}`, err);

  res.status(status).json({
    ok: false,
    error: { code, message, details: err.details || undefined },
  });
}
