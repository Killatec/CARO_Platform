import express, { Router } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

const router: Router = express.Router();

/**
 * GET /api/v1/config
 * Returns runtime validation configuration derived from server env vars.
 *
 * Parsing rules:
 *   VALIDATE_REQUIRED_PARENT_TYPES — comma-separated, trimmed, empty strings filtered.
 *   VALIDATE_UNIQUE_PARENT_TYPES   — "true" (case-insensitive) → true, else false.
 */
router.get('/', asyncWrap(async (_req, res) => {
  const requiredParentTypes = (process.env.VALIDATE_REQUIRED_PARENT_TYPES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const uniqueParentTypes =
    (process.env.VALIDATE_UNIQUE_PARENT_TYPES || '').toLowerCase() === 'true';

  const response: ApiResponse<{ requiredParentTypes: string[]; uniqueParentTypes: boolean }> = {
    ok: true,
    data: { requiredParentTypes, uniqueParentTypes },
  };
  res.json(response);
}));

export default router;
