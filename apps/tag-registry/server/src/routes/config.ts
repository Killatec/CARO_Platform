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
 *   databaseName                  — POSTGRES_DATABASE, mirroring @caro/db pool.ts's own
 *                                    fallback so an unset var doesn't render as blank.
 *   projectRoot                   — PROJECT_ROOT verbatim (unset/empty → null).
 *
 * Fields are hand-picked, not spread from process.env — POSTGRES_PASSWORD (and
 * everything else) must never reach the client.
 */
router.get('/', asyncWrap(async (_req, res) => {
  const requiredParentTypes = (process.env.VALIDATE_REQUIRED_PARENT_TYPES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const uniqueParentTypes =
    (process.env.VALIDATE_UNIQUE_PARENT_TYPES || '').toLowerCase() === 'true';

  const databaseName = process.env.POSTGRES_DATABASE ?? 'caro_dev';
  const projectRoot = process.env.PROJECT_ROOT?.trim() || null;

  const response: ApiResponse<{
    requiredParentTypes: string[];
    uniqueParentTypes: boolean;
    databaseName: string;
    projectRoot: string | null;
  }> = {
    ok: true,
    data: { requiredParentTypes, uniqueParentTypes, databaseName, projectRoot },
  };
  res.json(response);
}));

export default router;
