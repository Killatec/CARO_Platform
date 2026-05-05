import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { CaroError } from '@caro/server';
import { getTrendTile, getTrendExtent } from '@caro/db';
import type { TrendTile } from '@caro/db';

// HTTP status for known @caro/db error codes; anything else → 500.
const DB_CODE_STATUS: Record<string, number> = {
  INVALID_TAG_IDS:      400,
  INVALID_RANGE:        400,
  INVALID_BUCKET_COUNT: 400,
  INVALID_BUCKET_S:     400,
};

const router = Router();

// Converts bigint fields to Number before JSON serialisation.
// Safe for epoch-ms up to year ~285,000 (well below Number.MAX_SAFE_INTEGER = 2^53-1).
// Conversion happens here, not globally, to avoid monkey-patching JSON.stringify.
function serializeTile(tile: TrendTile): unknown {
  if (tile.source === 'raw') {
    return {
      source: tile.source,
      startTime: Number(tile.startTime),
      endTime:   Number(tile.endTime),
      series: tile.series.map(s => ({
        tagId:  s.tagId,
        ts:     s.ts.map(t => Number(t)),
        value:  s.value,
      })),
    };
  }
  return {
    source:    tile.source,
    startTime: Number(tile.startTime),
    endTime:   Number(tile.endTime),
    bucketSMs: tile.bucketSMs,
    n:         tile.n,
    series: tile.series.map(s => ({ tagId: s.tagId, value: s.value })),
  };
}

router.get('/tile', asyncWrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;

  // Presence check — all four params are required.
  for (const name of ['tag_ids', 'start_time', 'end_time', 'bucket_count'] as const) {
    if (!q[name]) {
      const err = new Error(`Missing required query parameter: ${name}`) as CaroError;
      err.status = 400;
      err.code   = 'MISSING_QUERY_PARAM';
      throw err;
    }
  }

  // tag_ids — comma-separated, 1–8 positive integers (§6.6 cap is enforced by @caro/db).
  const tagIds = (q.tag_ids as string).split(',').map(s => parseInt(s.trim(), 10));
  if (
    tagIds.length === 0 ||
    tagIds.length > 8 ||
    tagIds.some(id => !Number.isInteger(id) || id <= 0)
  ) {
    const err = new Error('tag_ids must be 1–8 comma-separated positive integers') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_TAG_IDS';
    throw err;
  }

  // start_time — positive integer string → BigInt.
  let startTime: bigint;
  try {
    startTime = BigInt((q.start_time as string).trim());
  } catch {
    const err = new Error('start_time must be a positive integer (ms since epoch)') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_RANGE';
    throw err;
  }
  if (startTime <= 0n) {
    const err = new Error('start_time must be a positive integer (ms since epoch)') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_RANGE';
    throw err;
  }

  // end_time — positive integer string → BigInt, must exceed start_time.
  let endTime: bigint;
  try {
    endTime = BigInt((q.end_time as string).trim());
  } catch {
    const err = new Error('end_time must be a positive integer (ms since epoch)') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_RANGE';
    throw err;
  }
  if (endTime <= startTime) {
    const err = new Error('end_time must be greater than start_time') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_RANGE';
    throw err;
  }

  // bucket_count — integer in 1..2500.
  const bucketCount = parseInt((q.bucket_count as string).trim(), 10);
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 2500) {
    const err = new Error('bucket_count must be an integer in 1..2500') as CaroError;
    err.status = 400;
    err.code   = 'INVALID_BUCKET_COUNT';
    throw err;
  }

  try {
    const tile = await getTrendTile(tagIds, startTime, endTime, bucketCount);
    res.json({ ok: true, data: serializeTile(tile) });
  } catch (e: unknown) {
    const raw    = e as Error & { code?: string };
    const status = raw.code !== undefined ? (DB_CODE_STATUS[raw.code] ?? 500) : 500;
    const caroErr = raw as CaroError;
    caroErr.status = status;
    if (!caroErr.code) caroErr.code = 'INTERNAL_ERROR';
    if (status >= 500) console.error('[trends/tile] internal error', raw);
    throw caroErr;
  }
}));

router.get('/extent', asyncWrap(async (_req, res) => {
  const { oldestMs, newestMs } = await getTrendExtent();
  res.json({
    ok: true,
    data: {
      oldestTs: oldestMs !== null ? Number(oldestMs) : null,
      newestTs: newestMs !== null ? Number(newestMs) : null,
    },
  });
}));

export default router;
