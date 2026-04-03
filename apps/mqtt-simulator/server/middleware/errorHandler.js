export function errorHandler(err, req, res, next) {
  const code    = err.code    || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred';
  const status  = err.status  || 500;

  console.error(`[${code}] ${message}`, err);

  res.status(status).json({
    ok: false,
    error: { code, message },
  });
}
