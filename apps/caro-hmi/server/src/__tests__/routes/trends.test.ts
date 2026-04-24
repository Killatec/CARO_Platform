import 'dotenv/config';
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import compression from 'compression';
import type { ErrorRequestHandler } from 'express';
import { errorHandler } from '@caro/server';
import trendsRouter from '../../routes/trends.js';
import { getTrendTile, writeTagSamples, timescalePool } from '@caro/db';
import type { RawTrendTile, AggregateTrendTile } from '@caro/db';

// ── Mock @caro/db, preserving real impl for integration tests ─────────────────
// vi.hoisted() creates a container that's available inside the hoisted vi.mock
// factory — the only safe way to capture the real implementation.

type DbModule = typeof import('@caro/db');

const real = vi.hoisted(() => ({
  getTrendTile: undefined as DbModule['getTrendTile'] | undefined,
}));

vi.mock('@caro/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  real.getTrendTile = actual.getTrendTile;
  return {
    ...actual,
    getTrendTile: vi.fn(),
  };
});

const mockGet = vi.mocked(getTrendTile);

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
  app.use('/api/v1/trends', compression());
  app.use('/api/v1/trends', trendsRouter);
  app.use(errorHandler as ErrorRequestHandler);
  return app;
}

const RAW_TILE: RawTrendTile = {
  bucketS: 0,
  tileIndex: 0,
  tileSpanMs: 3_600_000,
  series: [{ tagId: 1, ts: [1000, 2000], value: [1.5, 2.0] }],
};

const AGG_TILE: AggregateTrendTile = {
  bucketS: 1,
  tileIndex: 0,
  tileSpanMs: 600_000,
  tsStart: 0,
  n: 600,
  series: [{ tagId: 1, value: new Array(600).fill(1.0) }],
};

// ── Unit tests (mocked @caro/db) ──────────────────────────────────────────────

describe('GET /api/v1/trends/tile — unit (mocked)', () => {
  const app = buildApp();

  beforeEach(() => {
    mockGet.mockReset();
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('raw happy path: returns 200 with envelope wrapping RawTrendTile', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=0&tile_index=0');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ bucketS: 0, tileIndex: 0 });
    expect(mockGet).toHaveBeenCalledWith([1], 0, 0);
  });

  it('aggregate happy path: returns 200 with envelope wrapping AggregateTrendTile', async () => {
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=1&tile_index=0');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ bucketS: 1, n: 600 });
  });

  // ── Missing params ──────────────────────────────────────────────────────────

  it('missing tag_ids → 400 MISSING_QUERY_PARAM mentioning tag_ids', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?bucket_s=0&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('tag_ids');
  });

  it('missing bucket_s → 400 MISSING_QUERY_PARAM mentioning bucket_s', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('bucket_s');
  });

  it('missing tile_index → 400 MISSING_QUERY_PARAM mentioning tile_index', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    expect(res.body.error.message).toContain('tile_index');
  });

  // ── Malformed tag_ids ───────────────────────────────────────────────────────

  it('malformed tag_ids (abc) → 400 INVALID_TAG_IDS', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=abc&bucket_s=0&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TAG_IDS');
  });

  it('empty tag_ids → 400 INVALID_TAG_IDS', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=&bucket_s=0&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
  });

  it('negative tag id → 400 INVALID_TAG_IDS', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=-1&bucket_s=0&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TAG_IDS');
  });

  // ── Malformed bucket_s / tile_index ─────────────────────────────────────────

  it('negative bucket_s → 400 INVALID_BUCKET_S', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=-1&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BUCKET_S');
  });

  it('negative tile_index → 400 INVALID_TILE_INDEX', async () => {
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=0&tile_index=-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TILE_INDEX');
  });

  // ── Error translation ───────────────────────────────────────────────────────

  it('db throws INVALID_BUCKET_S → 400 with original message', async () => {
    const dbErr = Object.assign(new Error('bad bucket'), { code: 'INVALID_BUCKET_S' });
    mockGet.mockRejectedValueOnce(dbErr);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=5&tile_index=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BUCKET_S');
    expect(res.body.error.message).toBe('bad bucket');
  });

  it('db throws unknown error → 500 INTERNAL_ERROR, console.error called', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGet.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=0&tile_index=0');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ── JSON round-trip (BigInt guard) ──────────────────────────────────────────

  it('response body is JSON-serialisable (no BigInt leak)', async () => {
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=0&tile_index=0');
    expect(() => JSON.stringify(res.body)).not.toThrow();
    expect(JSON.parse(JSON.stringify(res.body))).toMatchObject(res.body);
  });
});

// ── Integration tests (live Timescale, gated) ─────────────────────────────────

describe.skipIf(!HAVE_TIMESCALE)('GET /api/v1/trends/tile — integration (live Timescale)', () => {
  const TEST_TAG    = 9901;
  const TILE_INDEX  = 1;
  const TILE_SPAN   = 3_600_000; // raw tile span
  const TILE_START  = TILE_INDEX * TILE_SPAN; // 3_600_000 ms

  // Restore real getTrendTile for all integration tests.
  // writeTagSamples and timescalePool come from the mock spread (actual impl).
  beforeEach(() => {
    mockGet.mockImplementation(
      (tagIds: number[], bucketS: number, tileIndex: number) =>
        real.getTrendTile!(tagIds, bucketS, tileIndex),
    );
  });

  afterAll(async () => {
    // Clean up test samples.
    await timescalePool.query(
      `DELETE FROM tag_samples WHERE tag_id = $1`,
      [TEST_TAG],
    );
    await timescalePool.end();
  });

  it('raw tile end-to-end: writes 5 samples, GET returns envelope + data', async () => {
    const app = buildApp();
    const samples = [0, 1000, 2000, 3000, 4000].map(offset => ({
      tagId: TEST_TAG,
      ts: TILE_START + offset,
      value: offset / 1000,
    }));
    await writeTagSamples(samples);

    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=${TEST_TAG}&bucket_s=0&tile_index=${TILE_INDEX}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const data = res.body.data as RawTrendTile;
    expect(data.bucketS).toBe(0);
    const series = data.series.find((s: { tagId: number }) => s.tagId === TEST_TAG);
    expect(series).toBeDefined();
    expect(series!.ts.length).toBe(5);
  });

  it('aggregate tile end-to-end: writes sparse samples, GET returns 600-bucket series', async () => {
    const app = buildApp();
    // A single sample in the aggregate tile.
    await writeTagSamples([{ tagId: TEST_TAG, ts: TILE_START + 5000, value: 42 }]);

    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=${TEST_TAG}&bucket_s=1&tile_index=${TILE_INDEX}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const data = res.body.data as AggregateTrendTile;
    expect(data.bucketS).toBe(1);
    const series = data.series.find((s: { tagId: number }) => s.tagId === TEST_TAG);
    expect(series).toBeDefined();
    expect(series!.value.length).toBe(600);
  });

  it('gzip off (default): response does not have content-encoding: gzip', async () => {
    const app = buildApp();
    mockGet.mockResolvedValueOnce(RAW_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=0&tile_index=0')
      .set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).not.toBe('gzip');
  });

  it('gzip on: compression middleware produces content-encoding: gzip', async () => {
    const app = buildGzipApp();
    mockGet.mockResolvedValueOnce(AGG_TILE);
    const res = await request(app)
      .get('/api/v1/trends/tile?tag_ids=1&bucket_s=1&tile_index=0')
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
