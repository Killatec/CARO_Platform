import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { CaroError } from '@caro/server';
import { getTrendTile, getTrendExtent } from '@caro/db';
import type { TrendTile } from '@caro/db';
import type { DbPipeline } from '../db-pipeline.js';

// HTTP status for known @caro/db error codes; anything else → 500.
const DB_CODE_STATUS: Record<string, number> = {
  INVALID_TAG_IDS:      400,
  INVALID_RANGE:        400,
  INVALID_BUCKET_COUNT: 400,
  INVALID_BUCKET_S:     400,
};

// ── Validation helpers ────────────────────────────────────────────────────────

function bad(code: string, message: string, status = 400): never {
  const err = new Error(message) as CaroError;
  err.status = status;
  err.code   = code;
  throw err;
}

function parseIntStrict(raw: string, code: string, message: string): number {
  const n = Number(raw.trim());
  if (!Number.isInteger(n)) bad(code, message);
  return n;
}

export function createTrendsRouter(dbPipeline: DbPipeline): Router {
const router = Router();

// Converts bigint fields to Number before JSON serialisation.
// Safe for epoch-ms up to year ~285,000 (well below Number.MAX_SAFE_INTEGER = 2^53-1).
// Conversion happens here, not globally, to avoid monkey-patching JSON.stringify.
function serializeTile(tile: TrendTile): unknown {
  if (tile.source === 'raw') {
    return {
      source:             tile.source,
      startTime:          Number(tile.startTime),
      endTime:            Number(tile.endTime),
      committedThroughTs: tile.committedThroughTs,
      series: tile.series.map(s => ({
        tagId:  s.tagId,
        ts:     s.ts.map(t => Number(t)),
        value:  s.value,
        ...(s.prev ? { prev: { ts: Number(s.prev.ts), value: s.prev.value } } : {}),
      })),
    };
  }
  return {
    source:             tile.source,
    startTime:          Number(tile.startTime),
    endTime:            Number(tile.endTime),
    bucketSMs:          tile.bucketSMs,
    n:                  tile.n,
    committedThroughTs: tile.committedThroughTs,
    series: tile.series.map(s => ({
      tagId: s.tagId,
      value: s.value,
      min:   s.min,
      max:   s.max,
    })),
  };
}

router.get('/tile', asyncWrap(async (req, res) => {
  // Use DbPipeline's commit watermark as nowMs — tells getTrendTile how far raw tag_samples
  // is actually committed. Falls back to Date.now() only on startup before first flush tick.
  const nowMs = dbPipeline.committedThroughMs || Date.now();


  const q = req.query as Record<string, string | undefined>;

  // Presence-check helper. bad() returns `never`, so TS narrows v to `string`
  // and callers get a non-undefined return without an explicit cast.
  // Self-contained per call site → safe against future refactors that might
  // move or relax the previous loop-based presence check.
  function requireParam(name: 'tag_ids' | 'start_time' | 'end_time' | 'bucket_count'): string {
    const v = q[name];
    if (typeof v !== 'string' || v === '') {
      bad('MISSING_QUERY_PARAM', `Missing required query parameter: ${name}`);
    }
    return v;
  }

  const tagIdsRaw      = requireParam('tag_ids');
  const startTimeRaw   = requireParam('start_time');
  const endTimeRaw     = requireParam('end_time');
  const bucketCountRaw = requireParam('bucket_count');

  // Truncate echoed raw values in error messages to a safe length.
  const echo = (s: string): string => s.length > 32 ? `${s.slice(0, 32)}…` : s;

  // tag_ids — comma-separated, 1–8 positive integers (§6.6 cap is enforced by @caro/db).
  const tagIds = tagIdsRaw.split(',').map(s =>
    parseIntStrict(s, 'INVALID_TAG_IDS', 'tag_ids must be 1–8 comma-separated positive integers'),
  );
  if (
    tagIds.length === 0 ||
    tagIds.length > 8 ||
    tagIds.some(id => id <= 0)
  ) {
    bad('INVALID_TAG_IDS', 'tag_ids must be 1–8 comma-separated positive integers');
  }

  // start_time — positive integer string → BigInt.
  let startTime: bigint;
  try {
    startTime = BigInt(startTimeRaw.trim());
  } catch {
    bad('INVALID_RANGE', `start_time must be a positive integer (ms since epoch); got "${echo(startTimeRaw)}"`);
  }
  if (startTime! <= 0n) {
    bad('INVALID_RANGE', `start_time must be a positive integer (ms since epoch); got "${echo(startTimeRaw)}"`);
  }

  // end_time — positive integer string → BigInt, must exceed start_time.
  let endTime: bigint;
  try {
    endTime = BigInt(endTimeRaw.trim());
  } catch {
    bad('INVALID_RANGE', `end_time must be a positive integer (ms since epoch); got "${echo(endTimeRaw)}"`);
  }
  if (endTime! <= startTime!) {
    bad('INVALID_RANGE', `end_time must be greater than start_time; got start=${startTime!}, end="${echo(endTimeRaw)}"`);
  }

  // bucket_count — integer in 1..2500.
  const bucketCount = parseIntStrict(
    bucketCountRaw,
    'INVALID_BUCKET_COUNT',
    'bucket_count must be an integer in 1..2500',
  );
  if (bucketCount < 1 || bucketCount > 2500) {
    bad('INVALID_BUCKET_COUNT', `bucket_count must be an integer in 1..2500; got ${bucketCount}`);
  }

  try {
    const { tile } = await getTrendTile(tagIds, startTime!, endTime!, bucketCount, nowMs);
    res.json({ ok: true, data: serializeTile(tile) });
  } catch (e: unknown) {
    const raw = e as Error & { code?: string };
    if (typeof raw.code === 'string' && raw.code in DB_CODE_STATUS) {
      bad(raw.code, raw.message, DB_CODE_STATUS[raw.code]);
    }
    console.error('[trends/tile] internal error', raw);
    throw raw;
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

return router;
}
