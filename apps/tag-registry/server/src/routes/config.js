import express from 'express';
import { asyncWrap } from '../middleware/asyncWrap.js';

const router = express.Router();

/**
 * GET /api/v1/config
 * Returns runtime validation configuration derived from server env vars.
 *
 * Parsing rules:
 *   VALIDATE_REQUIRED_PARENT_TYPES — comma-separated, trimmed, empty strings filtered.
 *   VALIDATE_UNIQUE_PARENT_TYPES   — "true" (case-insensitive) → true, else false.
 */
router.get('/', asyncWrap(async (req, res) => {
  const requiredParentTypes = (process.env.VALIDATE_REQUIRED_PARENT_TYPES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const uniqueParentTypes =
    (process.env.VALIDATE_UNIQUE_PARENT_TYPES || '').toLowerCase() === 'true';

  res.json({
    ok: true,
    data: { requiredParentTypes, uniqueParentTypes },
  });
}));

export default router;
