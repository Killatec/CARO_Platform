/**
 * Async error wrapper for Express route handlers
 * Catches async errors and forwards to error handler
 */
export function asyncWrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
