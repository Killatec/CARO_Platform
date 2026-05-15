import 'dotenv/config';
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import compression from 'compression';
import type { ErrorRequestHandler } from 'express';
import { errorHandler } from '@caro/server';
import trendsRouter from '../../routes/trends.js';
import { getTrendTile, getTrendExtent, MAX_BUCKET_S, deriveBucketSMs, writeTagSamples, timescalePool } from '@caro/db';
import type { RawTrendTile, AggregateTrendTile } from '@caro/db';

// ── Mock @caro/db, preserving real impl for integration tests ─────────────────

type DbModule = typeof import('@caro/db');

const real = vi.hoisted(() => ({
  getTrendTile:   undefined as DbModule['getTrendTile']   | undefined,
  getTrendExtent: undefined as DbModule['getTrendExtent'] | undefined,
}));

vi.mock('@caro/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  real.getTrendTile   = actual.getTrendTile;
  real.getTrendExtent = actual.getTrendExtent;
  return {
    ...actual,
    getTrendTile:   vi.fn(),
    getTrendExtent: vi.fn(),
  };
});

const mockGet    = vi.mocked(getTrendTile);
const mockExtent = vi.mocked(getTrendExtent);

// ── Helpers ───────────────────────────────────────────────────────────────────

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

function buildApp() {
  const app = express();
  app.use('/api/v1/trends', trendsRouter);
  app.use(errorHandler as ErrorRequestHandler);
  return app;
}

function buildGzipApp() {
  const app = express();
  // threshold: 0 forces compression regardless of response size — ensures the
  // test is deterministic and doesn't depend on payload size hitting the default
  // 1024-byte threshold.
  app.use('/api/v1/trends', compression({ threshold: 0 }));
  app.use('/api/v1/trends', trendsRouter);
  app.use(errorHandler as ErrorRequestHandler);
  return app;
}

// v0.9 fixture: raw tile with bigint startTime/endTime, bigint ts entries, and prev.
// The route serialises bigints to numbers via serializeTile() before res.json(),
// so res.body will contain plain numbers — not bigints.
const RAW_TILE: RawTrendTile = {
  source: 'raw',
  startTime: 3_600_000n,
  endTime:   3_840_000n,
  responseTailTs: 9_000_000,
  series: [{ tagId: 1, ts: [3_601_000n, 3_602_000n], value: [1.5, 2.0], prev: { ts: 3_540_000n, value: 0.5 } }],
};

const RAW_TILE_NO_PREV: RawTrendTile = {
  source: 'raw',
  startTime: 3_600_000n,
  endTime:   3_840_000n,
  responseTailTs: 9_000_000,
  series: [{ tagId: 1, ts: [3_601_000n, 3_602_000n], value: [1.5, 2.0] }],
};

const AGG_TILE: AggregateTrendTile = {
  source: '1s_cagg',
  startTime: 7_200_000n,
  endTime:   10_800_000n,
  bucketSMs: 14_400,
  n:         250,
  responseTailTs: 9_000_000,
  series: [{
    tagId: 1,
    value: new Array(250).fill(1.0),
    min:   new Array(250).fill(0.9),
    max:   new Array(250).fill(1.1),
  }],
};

// ── Unit tests (mocked @caro/db) ──────────────────────────────────────────────

describe('GET /api/v1/trends/tile — unit (mocked)', () => {
  const app = buildApp();

  beforeEach(() => {
    mockGet.mockReset();
    mockExtent.mockReset();
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('raw happy path: returns 200 with envelope wrapping RawTrendTile', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.source).toBe('raw');
    expect(res.body.data.startTime).toBe(3_600_000);
    expect(res.body.data.endTime).toBe(3_840_000);
    expect(mockGet).toHaveBeenCalledWith([1], 3_600_000n, 3_840_000n, 250, expect.any(Number));
  });

  it('aggregate happy path: returns 200 with envelope wrapping AggregateTrendTile', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=7200000&end_time=10800000&bucket_count=250');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.source).toBe('1s_cagg');
    expect(res.body.data.n).toBe(250);
    expect(res.body.data.bucketSMs).toBe(14_400);
  });

  it('aggregate response carries min and max arrays aligned with value', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=7200000&end_time=10800000&bucket_count=250');
    expect(res.status).toBe(200);
    const s = res.body.data.series[0];
    expect(s.value).toHaveLength(250);
    expect(s.min).toHaveLength(250);
    expect(s.max).toHaveLength(250);
    expect(s.min[0]).toBe(0.9);
    expect(s.max[0]).toBe(1.1);
  });

  it('raw response does not carry min or max on series (discriminated-union invariant)', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.data.series[0]);
    expect(keys).not.toContain('min');
    expect(keys).not.toContain('max');
  });

  it('raw response includes prev with bigint ts serialised to number when present', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    expect(res.status).toBe(200);
    const s = res.body.data.series[0];
    expect(s.prev).toBeDefined();
    expect(s.prev.ts).toBe(3_540_000);
    expect(s.prev.value).toBe(0.5);
    expect(typeof s.prev.ts).toBe('number');
  });

  it('raw response has no prev key when series entry has no prev (v0.8 cache)', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE_NO_PREV);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    expect(res.status).toBe(200);
    expect(res.body.data.series[0].prev).toBeUndefined();
  });

  it('aggregate response has no prev field on series (discriminated-union regression check)', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=7200000&end_time=10800000&bucket_count=250');
    expect(res.status).toBe(200);
    expect(res.body.data.series[0].prev).toBeUndefined();
  });

  it('bigint ts entries in raw response are serialised to JSON numbers', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    const ts = res.body.data.series[0].ts;
    expect(ts).toEqual([3_601_000, 3_602_000]);
    expect(typeof ts[0]).toBe('number');
  });

  // ── Missing params ──────────────────────────────────────────────────────────

  it('missing tag_ids → 400 MISSING_QUERY_PARAM mentioning tag_ids', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?start_time=1000000&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('tag_ids');
  });

  it('missing start_time → 400 MISSING_QUERY_PARAM mentioning start_time', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('start_time');
  });

  it('missing end_time → 400 MISSING_QUERY_PARAM mentioning end_time', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('end_time');
  });

  it('missing bucket_count → 400 MISSING_QUERY_PARAM mentioning bucket_count', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=2000000');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('bucket_count');
  });

  // ── Malformed tag_ids ───────────────────────────────────────────────────────

  it('malformed tag_ids (abc) → 400 INVALID_TAG_IDS', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=abc&start_time=1000000&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TAG_IDS');
  });

  it('negative tag id → 400 INVALID_TAG_IDS', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=-1&start_time=1000000&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TAG_IDS');
  });

  it('more than 8 tag_ids → 400 INVALID_TAG_IDS', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1,2,3,4,5,6,7,8,9&start_time=1000000&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TAG_IDS');
  });

  // ── INVALID_RANGE ───────────────────────────────────────────────────────────

  it('end_time <= start_time → 400 INVALID_RANGE', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=2000000&end_time=1000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RANGE');
  });

  it('start_time = 0 → 400 INVALID_RANGE', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=0&end_time=1000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RANGE');
  });

  it('non-numeric start_time → 400 INVALID_RANGE', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=abc&end_time=1000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RANGE');
  });

  // ── INVALID_RANGE_TOO_NARROW ────────────────────────────────────────────────

  it('sub-MIN_VIEWPORT_SPAN_MS window (500ms) → 400 INVALID_RANGE_TOO_NARROW', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=1000500&bucket_count=1000');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_RANGE_TOO_NARROW');
  });

  it('1ms window → 400 INVALID_RANGE_TOO_NARROW', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=1000001&bucket_count=1000');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RANGE_TOO_NARROW');
  });

  it('exactly MIN_VIEWPORT_SPAN_MS (1000ms) is NOT rejected as too narrow', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000000&end_time=1000001000&bucket_count=1000');
    expect(res.body.error?.code).not.toBe('INVALID_RANGE_TOO_NARROW');
  });

  it('1001ms window is NOT rejected as too narrow', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000000&end_time=1000001001&bucket_count=1000');
    expect(res.body.error?.code).not.toBe('INVALID_RANGE_TOO_NARROW');
  });

  // ── INVALID_BUCKET_COUNT ────────────────────────────────────────────────────

  it('bucket_count = 0 → 400 INVALID_BUCKET_COUNT', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=2000000&bucket_count=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BUCKET_COUNT');
  });

  it('bucket_count = 2501 → 400 INVALID_BUCKET_COUNT', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=2000000&bucket_count=2501');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BUCKET_COUNT');
  });

  // ── Error translation ───────────────────────────────────────────────────────

  it('db throws INVALID_BUCKET_S → 400 with original message', async () => {
    const dbErr = Object.assign(new Error('bad bucket'), { code: 'INVALID_BUCKET_S' });
    mockGet.mockRejectedValueOnce(dbErr);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BUCKET_S');
    expect(res.body.error.message).toBe('bad bucket');
  });

  // ── 205ms window: now rejected by INVALID_RANGE_TOO_NARROW (MIN_VIEWPORT_SPAN_MS = 1000ms) ──
  // Phase 6 removed the old route-level bucketSMs=0 check (INVALID_BUCKET_S).
  // The under-range guard added later rejects all windows < 1s with INVALID_RANGE_TOO_NARROW,
  // which covers the 205ms case (and gives an explicit error rather than a silent bad-data response).

  it('205ms span at bucket_count=1000 is rejected as INVALID_RANGE_TOO_NARROW (below MIN_VIEWPORT_SPAN_MS)', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1778861359020&end_time=1778861359225&bucket_count=1000');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RANGE_TOO_NARROW');
    // Rejected at route level before reaching DB layer.
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('db throws unknown error → 500 INTERNAL_ERROR, console.error called', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGet.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=1000000&end_time=2000000&bucket_count=250');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ── JSON round-trip (BigInt guard) ──────────────────────────────────────────

  it('responseTailTs present on raw response — is a number close to Date.now()', async () => {
    mockGet.mockImplementationOnce(async (_t, _s, _e, _bc, nowMs) => ({
      ...RAW_TILE, responseTailTs: nowMs ?? Date.now(),
    }));
    const before = Date.now();
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(typeof res.body.data.responseTailTs).toBe('number');
    expect(res.body.data.responseTailTs).toBeGreaterThanOrEqual(before);
    expect(res.body.data.responseTailTs).toBeLessThanOrEqual(after);
  });

  it('responseTailTs present on aggregate response — is a number close to Date.now()', async () => {
    mockGet.mockImplementationOnce(async (_t, _s, _e, _bc, nowMs) => ({
      ...AGG_TILE, responseTailTs: nowMs ?? Date.now(),
    }));
    const before = Date.now();
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=7200000&end_time=10800000&bucket_count=250');
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(typeof res.body.data.responseTailTs).toBe('number');
    expect(res.body.data.responseTailTs).toBeGreaterThanOrEqual(before);
    expect(res.body.data.responseTailTs).toBeLessThanOrEqual(after);
  });

  it('responseTailTs is captured before getTrendTile resolves (pre-SQL timestamp)', async () => {
    let capturedInsideMock = 0;
    mockGet.mockImplementationOnce(async (_t, _s, _e, _bc, nowMs) => {
      // Record when getTrendTile body executes — nowMs was captured before this
      capturedInsideMock = Date.now();
      await new Promise(r => setTimeout(r, 80));
      return { ...RAW_TILE, responseTailTs: nowMs ?? Date.now() };
    });
    const before = Date.now();
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    expect(res.status).toBe(200);
    // nowMs (= responseTailTs) was captured at route entry, before getTrendTile was called
    expect(res.body.data.responseTailTs).toBeLessThanOrEqual(capturedInsideMock);
    expect(res.body.data.responseTailTs).toBeGreaterThanOrEqual(before);
  });

  it('response body is JSON-serialisable (bigints converted to numbers by serializeTile)', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250');
    expect(() => JSON.stringify(res.body)).not.toThrow();
    expect(JSON.parse(JSON.stringify(res.body))).toMatchObject(res.body);
  });
});

// ── F9: deriveBucketSMs helper parity ────────────────────────────────────────
// Verifies that deriveBucketSMs produces integer ms (Math.round semantics) and
// that bucketS === bucketSMs / 1000 exactly. Both the route and getTrendTile use
// this identical helper so there can be no precision-boundary disagreement.

describe('deriveBucketSMs — F9 parity', () => {
  it('produces integer bucketSMs via Math.round', () => {
    // 1_555_250 ms / 250 = 6221 ms exactly
    const { bucketSMs, bucketS } = deriveBucketSMs(1_000_000n, 2_555_250n, 250);
    expect(Number.isInteger(bucketSMs)).toBe(true);
    expect(bucketSMs).toBe(6221);
    expect(bucketS).toBe(6.221);
  });

  it('bucketS === bucketSMs / 1000 exactly', () => {
    const { bucketSMs, bucketS } = deriveBucketSMs(0n, 3_600_000n, 250);
    expect(bucketS).toBe(bucketSMs / 1000);
  });

  it('standard 1h preset at 500 buckets → bucketSMs = 7200', () => {
    const { bucketSMs, bucketS } = deriveBucketSMs(0n, 3_600_000n, 500);
    expect(bucketSMs).toBe(7200);
    expect(bucketS).toBe(7.2);
  });

  it('MAX_BUCKET_S boundary: spanMs = MAX_BUCKET_S × 1000 × 250 → bucketS = MAX_BUCKET_S', () => {
    const spanMs = BigInt(MAX_BUCKET_S) * 1000n * 250n;
    const { bucketSMs, bucketS } = deriveBucketSMs(1_000_000n, 1_000_000n + spanMs, 250);
    expect(bucketSMs).toBe(MAX_BUCKET_S * 1000);
    expect(bucketS).toBe(MAX_BUCKET_S);
  });
});

// ── GET /api/v1/trends/extent — unit (mocked) ────────────────────────────────

describe('GET /api/v1/trends/extent — unit (mocked)', () => {
  const app = buildApp();

  beforeEach(() => {
    mockGet.mockReset();
    mockExtent.mockReset();
  });

  it('200 with numeric oldestTs/newestTs when table has data', async () => {
    mockExtent.mockResolvedValueOnce({ oldestMs: 1_000_000n, newestMs: 2_000_000n });
    const res = await request(app).get('/api/v1/trends/extent');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.oldestTs).toBe(1_000_000);
    expect(res.body.data.newestTs).toBe(2_000_000);
    expect(typeof res.body.data.oldestTs).toBe('number');
    expect(typeof res.body.data.newestTs).toBe('number');
  });

  it('200 with both null when getTrendExtent returns null fields', async () => {
    mockExtent.mockResolvedValueOnce({ oldestMs: null, newestMs: null });
    const res = await request(app).get('/api/v1/trends/extent');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.oldestTs).toBeNull();
    expect(res.body.data.newestTs).toBeNull();
  });

  it('500 when getTrendExtent throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockExtent.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/v1/trends/extent');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    errSpy.mockRestore();
  });
});

// ── Integration tests (live Timescale, gated) ─────────────────────────────────
// Uses the raw COV path: 20-second window with 250 buckets.
// dispatchShape: expectedPoints = 20 × 10 = 200 ≤ 250 → raw COV.

describe.skipIf(!HAVE_TIMESCALE)('GET /api/v1/trends/tile — integration (live Timescale)', () => {
  const TEST_TAG   = 9901;
  // Raw COV window: start=3_600_000 ms (1h past epoch), end=3_620_000 ms (+20s), 250 buckets.
  // expectedPoints = 20 × 10 = 200 ≤ 250 → raw COV (Phase 6 dispatch).
  const START_MS   = 3_600_000;
  const END_MS     = 3_620_000;

  beforeEach(() => {
    mockGet.mockImplementation(
      (tagIds: number[], startTime: bigint, endTime: bigint, bucketCount: number, nowMs?: number) =>
        real.getTrendTile!(tagIds, startTime, endTime, bucketCount, nowMs),
    );
  });

  afterAll(async () => {
    await timescalePool.query(`DELETE FROM tag_samples WHERE tag_id = $1`, [TEST_TAG]);
    await timescalePool.end();
  });

  it('raw tile end-to-end: writes 3 samples, GET returns envelope + data', async () => {
    const app = express();
    app.use('/api/v1/trends', trendsRouter);
    app.use(errorHandler as ErrorRequestHandler);

    await writeTagSamples([
      { tagId: TEST_TAG, ts: START_MS + 1_000, value: 1.0 },
      { tagId: TEST_TAG, ts: START_MS + 2_000, value: 2.0 },
      { tagId: TEST_TAG, ts: START_MS + 3_000, value: 3.0 },
    ]);

    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=${TEST_TAG}&start_time=${START_MS}&end_time=${END_MS}&bucket_count=250`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.source).toBe('raw');
    const series = res.body.data.series.find((s: { tagId: number }) => s.tagId === TEST_TAG);
    expect(series).toBeDefined();
    expect(series!.ts.length).toBe(3);
  });

  it('gzip off (default): response does not have content-encoding: gzip', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=3600000&end_time=3840000&bucket_count=250')
      .set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).not.toBe('gzip');
  });

  it('gzip on: compression middleware produces content-encoding: gzip', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const app = buildGzipApp();
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&start_time=7200000&end_time=10800000&bucket_count=250')
      .set('Accept-Encoding', 'gzip')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});
