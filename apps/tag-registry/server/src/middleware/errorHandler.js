import { ERROR_CODES } from '../../../shared/index.js';

/**
 * Error code to HTTP status mapping
 */
const STATUS_MAP = {
  [ERROR_CODES.TEMPLATE_NOT_FOUND]: 404,
  [ERROR_CODES.TEMPLATE_NAME_CONFLICT]: 409,
  [ERROR_CODES.STALE_TEMPLATE]: 409,
  [ERROR_CODES.INVALID_REFERENCE]: 422,
  [ERROR_CODES.CIRCULAR_REFERENCE]: 422,
  [ERROR_CODES.SCHEMA_VALIDATION_ERROR]: 422,
  [ERROR_CODES.INVALID_ASSET_NAME]: 422,
  [ERROR_CODES.DUPLICATE_SIBLING_NAME]: 409,
  [ERROR_CODES.UNKNOWN_FIELD]: 422,
  [ERROR_CODES.TAG_PATH_COLLISION]: 409,
  [ERROR_CODES.TAG_PATH_TOO_LONG]: 422,
  [ERROR_CODES.PARENT_TYPE_MISSING]: 422,
  [ERROR_CODES.DUPLICATE_PARENT_TYPE]: 422,
  [ERROR_CODES.VALIDATION_ERROR]: 422
};

/**
 * Express error handler middleware
 */
export function errorHandler(err, req, res, next) {
  const code = err.code || 'INTERNAL_ERROR';
  const status = STATUS_MAP[code] || 500;
  const message = err.message || 'An unexpected error occurred';

  console.error(`[${code}] ${message}`, err);

  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      details: err.details || undefined
    }
  });
}
