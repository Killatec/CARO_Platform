import 'dotenv/config';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { errorHandler } from '@caro/server';
import { createTrendsRouter } from '../../routes/trends.js';
import { DbPipeline } from '../../db-pipeline.js';
import {
  writeTagSamples,
  timescalePool,
  __test_watermarkOverride,
  __test_clearWatermarkCache,
} from '@caro/db';

// ── Guard: skip all integration tests if TimescaleDB is not configured ─────────

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

if (HAVE_TIMESCALE) {
  afterAll(async () => {
    __test_watermarkOverride.current = null;
    await timescalePool.end();
  });
}

// ── Sandbox helpers (inlined to avoid cross-package test dependency) ───────────

const TEST_RANGE_START = 0n;
const TEST_RANGE_END   = 946_684_799_000n; // 1999-12-31T23:59:59Z

async function resetTestRange(): Promise<number> {
  const res = await timescalePool.query(
    `DELETE FROM tag_samples
     WHERE ts >= to_timestamp($1::bigint / 1000.0)
       AND ts <= to_timestamp($2::bigint / 1000.0)`,
    [TEST_RANGE_START, TEST_RANGE_END],
  );
  return res.rowCount ?? 0;
}

async function resetTestRangeExpectClean(): Promise<number> {
  const deleted = await resetTestRange();
  if (deleted > 0) {
    console.warn(
      `[trends-test-range] beforeEach cleanup deleted ${deleted} sandbox rows — prior test did not clean up properly`,
    );
  }
  return deleted;
}

async function writeTestSamples(
  samples: Array<{ ts: bigint; tagId: number; value: number | null }>,
): Promise<void> {
  await writeTagSamples(samples.map(s => ({
    ts:    Number(s.ts),
    tagId: s.tagId,
    value: s.value,
  })));
}

async function refreshTestCagg(
  viewName: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg',
): Promise<void> {
  const fullName = `tag_samples_${viewName}`;
  await timescalePool.query(
    `CALL refresh_continuous_aggregate(
       $1,
       to_timestamp($2::bigint / 1000.0),
       to_timestamp($3::bigint / 1000.0)
     )`,
    [fullName, TEST_RANGE_START, TEST_RANGE_END],
  );
}

// ── App factory (real @caro/db, no mock) ──────────────────────────────────────

function buildApp() {
  const app = express();
  app.use('/api/v1/trends', createTrendsRouter(new DbPipeline()));
  app.use(errorHandler as ErrorRequestHandler);
  return app;
}

const app = buildApp();

// ── Sandbox constants (shared across DB-touching tests) ────────────────────────
//
// Tag IDs 7001–7099 are reserved for E2E tests to avoid conflicts with
// the @caro/db unit test tag ranges (1001–6099).
//
// 1s_cagg dispatch window: 2h–3h past epoch, 250 buckets.
// bucketS = 3_600_000 / 250_000 = 14.4 → 1s_cagg; bucketSMs = 14_400.

const AGG_START  = 7_200_000n;   // 2h past epoch
const AGG_END    = 10_800_000n;  // 3h past epoch
const COUNT      = 250;
const BUCKET_MS  = 14_400;       // Math.round(14.4 * 1000)

// Raw window: 20-second span at 250 buckets → expectedPoints=200 ≤ 250 → raw COV (Phase 6 dispatch).
// Old constant was 3_840_000n (4-minute window) which dispatches to bucketed after Phase 6.
const RAW_START  = 3_600_000n;
const RAW_END    = 3_620_000n;

// ── E2E tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!HAVE_TIMESCALE)('GET /api/v1/trends/tile — E2E (real DB, no mock)', () => {

  // ── 1. Happy path: aligned 1s_cagg request ──────────────────────────────────

  describe('200 happy path: aligned 1s_cagg request', () => {
    beforeEach(async () => {
      await resetTestRangeExpectClean();
      await refreshTestCagg('1s_cagg');
    });
    afterEach(async () => {
      await resetTestRange();
      await refreshTestCagg('1s_cagg');
    });

    it('returns expected shape with source=1s_cagg and n=250', async () => {
      await writeTestSamples([{ ts: AGG_START + 1_000n, tagId: 7001, value: 3.5 }]);
      await refreshTestCagg('1s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7001` +
        `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.source).toBe('1s_cagg');
      expect(res.body.data.n).toBe(COUNT);
      // BigInt fields serialized as plain numbers.
      expect(typeof res.body.data.startTime).toBe('number');
      expect(typeof res.body.data.endTime).toBe('number');
      expect(res.body.data.startTime).toBe(Number(AGG_START));
      expect(res.body.data.endTime).toBe(Number(AGG_END));
      // Series shape.
      expect(res.body.data.series).toHaveLength(1);
      expect(res.body.data.series[0].value).toHaveLength(COUNT);
    });
  });

  // ── 2. Raw path: unaligned range, exact round-trip ──────────────────────────

  describe('200 raw path: unaligned range, exact range round-trip', () => {
    beforeEach(async () => { await resetTestRangeExpectClean(); });
    afterEach(async () => { await resetTestRange(); });

    it('returns source=raw with startTime/endTime matching request exactly', async () => {
      // Deliberately unaligned timestamps (+ 123 ms offset).
      const rawStart = RAW_START + 123n;
      const rawEnd   = RAW_END   + 123n;

      await writeTestSamples([{ ts: rawStart + 1_000n, tagId: 7002, value: 9.9 }]);

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7002` +
        `&start_time=${rawStart}&end_time=${rawEnd}&bucket_count=${COUNT}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.source).toBe('raw');
      // Raw path echoes the request bounds exactly.
      expect(res.body.data.startTime).toBe(Number(rawStart));
      expect(res.body.data.endTime).toBe(Number(rawEnd));
      // ts array contains numbers (bigints serialized).
      expect(res.body.data.series[0].ts).toBeInstanceOf(Array);
      expect(typeof res.body.data.series[0].ts[0]).toBe('number');
    });
  });

  // ── 3. Unaligned aggregate: served grid wraps request, n === bucketCount + 1 ─

  describe('200 unaligned aggregate: served grid wraps the request', () => {
    beforeEach(async () => {
      await resetTestRangeExpectClean();
      await refreshTestCagg('1s_cagg');
    });
    afterEach(async () => {
      await resetTestRange();
      await refreshTestCagg('1s_cagg');
    });

    it('returns n=251, startTime before request, endTime after request', async () => {
      // Shift by 100 ms — not a bucket boundary (7_200_100 % 14_400 = 100).
      const unalignedStart = AGG_START + 100n;
      const unalignedEnd   = unalignedStart + BigInt(COUNT * BUCKET_MS);

      await writeTestSamples([{ ts: unalignedStart + 1_000n, tagId: 7003, value: 5.0 }]);
      await refreshTestCagg('1s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7003` +
        `&start_time=${unalignedStart}&end_time=${unalignedEnd}&bucket_count=${COUNT}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('1s_cagg');
      expect(res.body.data.n).toBe(COUNT + 1);
      // Served grid snaps back to the natural boundary before unalignedStart.
      expect(res.body.data.startTime).toBeLessThan(Number(unalignedStart));
      expect(res.body.data.endTime).toBeGreaterThan(Number(unalignedEnd));
    });
  });

  // ── 4. 400 INVALID_TAG_IDS: 9-element list ───────────────────────────────────

  it('400 INVALID_TAG_IDS: 9-element tag_ids list', async () => {
    const res = await request(app).get(
      '/api/v1/trends/tile?tag_ids=1,2,3,4,5,6,7,8,9' +
      `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TAG_IDS');
    expect(res.body.error.message).toBeTruthy();
  });

  // ── 5. 400 INVALID_RANGE: end ≤ start ───────────────────────────────────────

  it('400 INVALID_RANGE: end_time equals start_time', async () => {
    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=1&start_time=${AGG_START}&end_time=${AGG_START}&bucket_count=${COUNT}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_RANGE');
  });

  it('400 INVALID_RANGE: end_time less than start_time', async () => {
    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=1&start_time=${AGG_END}&end_time=${AGG_START}&bucket_count=${COUNT}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_RANGE');
  });

  // ── 6. 400 INVALID_BUCKET_COUNT: 2501 ───────────────────────────────────────

  it('400 INVALID_BUCKET_COUNT: bucket_count=2501', async () => {
    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=1&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=2501`,
    );
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_BUCKET_COUNT');
  });

  // ── 7. 400 INVALID_BUCKET_S: range × count exceeds 14746 ────────────────────

  it('400 INVALID_BUCKET_S: derived bucketS > 14746', async () => {
    // bucketS = 3_700_000_000 / (250 * 1000) = 14_800 > 14_746.
    const start = 1n;
    const end   = start + 3_700_000_000n;
    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=1&start_time=${start}&end_time=${end}&bucket_count=${COUNT}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_BUCKET_S');
  });

  // ── 8. 400 MISSING_QUERY_PARAM: each required param omitted individually ─────

  it.each(['tag_ids', 'start_time', 'end_time', 'bucket_count'] as const)(
    '400 MISSING_QUERY_PARAM: missing %s',
    async (missingParam) => {
      const params: Record<string, string> = {
        tag_ids:      '1',
        start_time:   String(AGG_START),
        end_time:     String(AGG_END),
        bucket_count: String(COUNT),
      };
      delete params[missingParam];
      const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
      const res = await request(app).get(`/api/v1/trends/tile?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('MISSING_QUERY_PARAM');
    },
  );

  // ── 9. BigInt round-trip: large timestamps survive serialization ─────────────
  //
  // Uses a 60-second raw window near now (bucketS = 0.24 < 1.0) so the route
  // echoes startTime/endTime unchanged. Validates that 13-digit ms timestamps
  // survive the BigInt→Number serialization path without precision loss.

  it('BigInt round-trip: 13-digit timestamps survive JSON serialization', async () => {
    const startMs = Date.now() - 20_000;
    const endMs   = Date.now();
    // 20s window at 250 buckets: expectedPoints = 20 × 10 = 200 ≤ 250 → raw COV (Phase 6 dispatch).
    // startTime/endTime are echoed exactly on the raw path.

    const res = await request(app).get(
      `/api/v1/trends/tile?tag_ids=7099` +
      `&start_time=${startMs}&end_time=${endMs}&bucket_count=${COUNT}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('raw');
    // Numbers in response must decode back to the original values via BigInt.
    expect(BigInt(res.body.data.startTime)).toBe(BigInt(startMs));
    expect(BigInt(res.body.data.endTime)).toBe(BigInt(endMs));
    // startTime/endTime must be plain numbers, not bigint strings.
    expect(typeof res.body.data.startTime).toBe('number');
    expect(typeof res.body.data.endTime).toBe('number');
  });

  // ── 10. Watermark fall-through over the wire ─────────────────────────────────
  //
  // Sets __test_watermarkOverride to force a mid-range split even on the
  // pre-2000 sandbox window, then verifies the HTTP response carries source='mixed'.

  describe('200 watermark fall-through: source=mixed over HTTP', () => {
    beforeEach(async () => {
      await resetTestRangeExpectClean();
      await refreshTestCagg('1s_cagg');
      await refreshTestCagg('10s_cagg');
      __test_watermarkOverride.current = null;
      __test_clearWatermarkCache();
    });

    afterEach(async () => {
      __test_watermarkOverride.current = null;
      __test_clearWatermarkCache();
      await resetTestRange();
      await refreshTestCagg('1s_cagg');
      await refreshTestCagg('10s_cagg');
    });

    it('source=mixed when watermark splits the range mid-window', async () => {
      // Place the 1s_cagg watermark 125 buckets into the window (exactly aligned).
      const splitMs = Number(AGG_START) + 125 * BUCKET_MS;
      __test_watermarkOverride.current = new Map([
        ['tag_samples_1s_cagg',  splitMs + 1],        // watermark just past split
        ['tag_samples_10s_cagg', Number(AGG_END) + 60_000], // 10s_cagg covers the tail
      ]);

      await writeTestSamples([
        { ts: AGG_START + 1_000n,           tagId: 7050, value: 1.0 },
        { ts: BigInt(splitMs) + 1_000n,     tagId: 7050, value: 2.0 },
      ]);
      await refreshTestCagg('1s_cagg');
      await refreshTestCagg('10s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7050` +
        `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.source).toBe('mixed');
      expect(res.body.data.n).toBe(COUNT);
    });
  });

  // ── 11. Min/max bands (v0.8) ──────────────────────────────────────────────────

  describe('200 aggregate min/max bands (v0.8)', () => {
    beforeEach(async () => {
      await resetTestRangeExpectClean();
      await refreshTestCagg('1s_cagg');
    });
    afterEach(async () => {
      await resetTestRange();
      await refreshTestCagg('1s_cagg');
    });

    it('aggregate series carries value/min/max arrays of length n', async () => {
      await writeTestSamples([
        { ts: AGG_START + 1_000n, tagId: 7010, value: 1.0 },
        { ts: AGG_START + 5_000n, tagId: 7010, value: 3.0 },
        { ts: AGG_START + 10_000n, tagId: 7010, value: 2.0 },
      ]);
      await refreshTestCagg('1s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7010` +
        `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
      );

      expect(res.status).toBe(200);
      const { n, series } = res.body.data;
      const s = series[0];
      expect(s.value).toHaveLength(n);
      expect(s.min).toHaveLength(n);
      expect(s.max).toHaveLength(n);
    });

    it('normal bucket: value=last, min=1.0, max=3.0 for spread samples', async () => {
      // Bucket 0: AGG_START to AGG_START+BUCKET_MS. Three 1s sub-buckets:
      // ts+1000 → last=1.0, ts+5000 → last=3.0, ts+10000 → last=2.0 (max bucket → value)
      await writeTestSamples([
        { ts: AGG_START + 1_000n,  tagId: 7011, value: 1.0 },
        { ts: AGG_START + 5_000n,  tagId: 7011, value: 3.0 },
        { ts: AGG_START + 10_000n, tagId: 7011, value: 2.0 },
      ]);
      await refreshTestCagg('1s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7011` +
        `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
      );

      const s = res.body.data.series[0];
      expect(s.value[0]).toBe(2.0);
      expect(s.min[0]).toBe(1.0);
      expect(s.max[0]).toBe(3.0);
    });

    it('empty bucket: min === max === value (LOCF collapse, COV semantics)', async () => {
      // Bucket 0 has data (5.0). Bucket 5 is empty → LOCF'd to 5.0.
      // Guard sample in bucket 6 pushes the 1s_cagg watermark to 7287000ms,
      // which is ≥ bucket 5's gf_bucket (7272000ms). LOCF cutoff removed — bucket 5
      // is within the data range so carries the real LOCF'd value regardless.
      await writeTestSamples([
        { ts: AGG_START + 1_000n,                          tagId: 7012, value: 5.0  },
        { ts: AGG_START + BigInt(6 * BUCKET_MS) + 1_000n, tagId: 7012, value: 99.0 },
      ]);
      await refreshTestCagg('1s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7012` +
        `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
      );

      const s = res.body.data.series[0];
      expect(s.value[5]).toBe(5.0);
      expect(s.min[5]).toBe(5.0);
      expect(s.max[5]).toBe(5.0);
    });

    it('mixed-null bucket: value/min/max all null (band gap)', async () => {
      // Three samples in bucket 0 across three 1s sub-buckets; middle is null.
      // sum(null_count) = 1 > 0 → mixed-null case.
      await writeTestSamples([
        { ts: AGG_START + 1_000n, tagId: 7013, value: 1.0  },
        { ts: AGG_START + 2_000n, tagId: 7013, value: null },
        { ts: AGG_START + 3_000n, tagId: 7013, value: 2.0  },
      ]);
      await refreshTestCagg('1s_cagg');

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7013` +
        `&start_time=${AGG_START}&end_time=${AGG_END}&bucket_count=${COUNT}`,
      );

      const s = res.body.data.series[0];
      expect(s.value[0]).toBeNull();
      expect(s.min[0]).toBeNull();
      expect(s.max[0]).toBeNull();
    });
  });

  // ── 12. Raw path: no min/max leakage (discriminated-union invariant) ──────────

  describe('raw path: series carries no min or max keys', () => {
    beforeEach(async () => { await resetTestRangeExpectClean(); });
    afterEach(async () => { await resetTestRange(); });

    it('Object.keys(series[0]) does not include min or max', async () => {
      await writeTestSamples([{ ts: RAW_START + 1_000n, tagId: 7019, value: 9.9 }]);

      const res = await request(app).get(
        `/api/v1/trends/tile?tag_ids=7019` +
        `&start_time=${RAW_START}&end_time=${RAW_END}&bucket_count=${COUNT}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('raw');
      const keys = Object.keys(res.body.data.series[0]);
      expect(keys).not.toContain('min');
      expect(keys).not.toContain('max');
    });
  });
});
