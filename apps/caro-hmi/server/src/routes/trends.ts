import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { CaroError } from '@caro/server';
import { getTrendTile } from '@caro/db';

// HTTP status for known @caro/db error codes; anything else → 500.
const DB_CODE_STATUS: Record<string, number> = {
  INVALID_TAG_IDS:    400,
  INVALID_BUCKET_S:   400,
  INVALID_TILE_INDEX: 400,
};

const router = Router();

router.get('/tile', asyncWrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;

  // Presence check — all three params are required.
  for (const name of ['tag_ids', 'bucket_s', 'tile_index'] as const) {
    if (!q[name]) {
      const err = new Error(`Missing required query parameter: ${name}`) as CaroError;
      err.status = 400;
      err.code   = 'MISSING_QUERY_PARAM';
      throw err;
    }
  }

  // tag_ids — comma-separated, 1–20 positive integers.
  const tagIds = (q.tag_ids as string).split(',').map(s => parseInt(s.trim(), 10));
  if (
    tagIds.length === 0 ||
    tagIds.length > 20 ||
    tagIds.some(id => !Number.isInteger(id) || id <= 0)
  ) {
    const err = new Error('tag_ids must be 1–20 comma-separated positive integers') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_TAG_IDS';
    throw err;
  }

  // bucket_s — non-negative integer (allowed-set check delegated to @caro/db).
  const bucketS = parseInt((q.bucket_s as string).trim(), 10);
  if (!Number.isInteger(bucketS) || bucketS < 0) {
    const err = new Error('bucket_s must be a non-negative integer') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_BUCKET_S';
    throw err;
  }

  // tile_index — non-negative integer.
  const tileIndex = parseInt((q.tile_index as string).trim(), 10);
  if (!Number.isInteger(tileIndex) || tileIndex < 0) {
    const err = new Error('tile_index must be a non-negative integer') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_TILE_INDEX';
    throw err;
  }

  try {
    const tile = await getTrendTile(tagIds, bucketS, tileIndex);
    res.json({ ok: true, data: tile });
  } catch (e: unknown) {
    const raw    = e as Error & { code?: string };
    const status = raw.code !== undefined ? (DB_CODE_STATUS[raw.code] ?? 500) : 500;
    const caroErr = raw as CaroError;
    caroErr.status = status;
    if (!caroErr.code) caroErr.code = 'INTERNAL_ERROR';
    // errorHandler logs all errors; console.error here ensures the stack is captured
    // before re-throw for the 500 path where the stack is most useful.
    if (status >= 500) console.error('[trends/tile] internal error', raw);
    throw caroErr;
  }
}));

export default router;
