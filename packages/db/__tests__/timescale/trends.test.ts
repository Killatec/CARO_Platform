import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
  getTrendTile,
  getTrendExtent,
  MAX_BUCKET_S,
  SAMPLE_RATE_HZ,
  dispatchShape,
  __test_watermarkOverride,
  __test_lastUsedSources,
  __test_getWatermarkMs,
  __test_clearWatermarkCache,
} from '../../timescale/trends.js';
import type { RawTrendTile, AggregateTrendTile } from '../../timescale/trends.js';
import timescalePool from '../../timescale/pool.js';

// ── Guard: skip all integration tests if TimescaleDB is not configured ─────────

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

if (HAVE_TIMESCALE) {
  afterAll(async () => {
    const { timescalePool } = await import('../helpers/trends-test-range.js');
    await timescalePool.end();
  });
}

// ── Cross-cutting validation (no DB needed) ────────────────────────────────────

describe('getTrendTile — INVALID_TAG_IDS', () => {
  it('throws on empty array', async () => {
    await expect(getTrendTile([], 1n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_TAG_IDS' });
  });

  it('throws on 9-element array (exceeds 8-tag cap)', async () => {
    await expect(getTrendTile([1,2,3,4,5,6,7,8,9], 1n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_TAG_IDS' });
  });

  it('throws when a tagId is not an integer', async () => {
    await expect(getTrendTile([1.5], 1n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_TAG_IDS' });
  });

  it('throws when a tagId is zero', async () => {
    await expect(getTrendTile([0], 1n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_TAG_IDS' });
  });

  it('throws when a tagId is negative', async () => {
    await expect(getTrendTile([-1], 1n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_TAG_IDS' });
  });
});

describe('getTrendTile — INVALID_RANGE', () => {
  it('throws when endTime equals startTime', async () => {
    await expect(getTrendTile([1], 1_000_000n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('throws when endTime is less than startTime', async () => {
    await expect(getTrendTile([1], 2_000_000n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('throws when startTime is zero (non-positive)', async () => {
    await expect(getTrendTile([1], 0n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('throws when startTime is negative', async () => {
    await expect(getTrendTile([1], -1n, 1_000_000n, 250))
      .rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });
});

describe('getTrendTile — INVALID_BUCKET_COUNT', () => {
  it('throws on bucketCount = 0', async () => {
    await expect(getTrendTile([1], 1n, 1_000_000n, 0))
      .rejects.toMatchObject({ code: 'INVALID_BUCKET_COUNT' });
  });

  it('throws on bucketCount = -1', async () => {
    await expect(getTrendTile([1], 1n, 1_000_000n, -1))
      .rejects.toMatchObject({ code: 'INVALID_BUCKET_COUNT' });
  });

  it('throws on bucketCount = 2501', async () => {
    await expect(getTrendTile([1], 1n, 1_000_000n, 2501))
      .rejects.toMatchObject({ code: 'INVALID_BUCKET_COUNT' });
  });

  it('throws on non-integer bucketCount', async () => {
    await expect(getTrendTile([1], 1n, 1_000_000n, 250.5))
      .rejects.toMatchObject({ code: 'INVALID_BUCKET_COUNT' });
  });
});

describe('getTrendTile — INVALID_BUCKET_S', () => {
  // bucketS = Number(endTime - startTime) / (bucketCount * 1000)
  // bucketS > MAX_BUCKET_S → INVALID_BUCKET_S
  // Range of 3_700_000_000 ms with 250 buckets: 3_700_000_000 / 250_000 = 14_800 > MAX_BUCKET_S
  it('throws when derived bucketS exceeds MAX_BUCKET_S', async () => {
    const start = 1n;
    const end   = start + 3_700_000_000n; // ~42.8 days
    await expect(getTrendTile([1], start, end, 250))
      .rejects.toMatchObject({ code: 'INVALID_BUCKET_S' });
  });
});

// ── Integration tests — live TimescaleDB ──────────────────────────────────────
//
// All samples live in [TEST_RANGE_START=0n, TEST_RANGE_END=946_684_799_000n]
// (epoch 1970 → 1999-12-31). This window never collides with real operational
// data (which begins after platform deployment, post-2025).
//
// Tile startTime must be > 0n per INVALID_RANGE validation; tests use offsets
// from epoch to keep windows cleanly within the sandbox.

// ── RAW branch (expectedPoints ≤ bucketCount) ─────────────────────────────────
// Window: startTime=3_600_000n (1h), endTime=3_620_000n (20s), bucketCount=250
// expectedPoints = 20 × 10 = 200 ≤ 250 → raw (unified dispatch rule).
// Also satisfies old bucketS criterion: bucketS = 20_000/250_000 = 0.08 < 1.0.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration: RAW branch (20s tile window)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean,
  } = await import('../helpers/trends-test-range.js');

  const START = 3_600_000n;  // 1h past epoch
  const END   = 3_620_000n;  // 20s window: expectedPoints = 200 ≤ 250 → raw
  const COUNT = 250;

  beforeEach(async () => { await resetTestRangeExpectClean(); });
  afterEach(async () => { await resetTestRange(); });
  afterAll(async () => { await resetTestRange(); });

  it('returns shape { source: "raw", startTime, endTime, series }', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 1001, value: 5.0 }]);
    const tile = await getTrendTile([1001], START, END, COUNT) as RawTrendTile;
    expect(tile.source).toBe('raw');
    expect(tile.startTime).toBe(START);
    expect(tile.endTime).toBe(END);
    expect(tile.series).toHaveLength(1);
    expect(tile.series[0].tagId).toBe(1001);
  });

  it('returns COV samples in chronological order per tag', async () => {
    await writeTestSamples([
      { ts: START + 2_000n, tagId: 1002, value: 10.0 },
      { ts: START + 5_000n, tagId: 1002, value: 20.0 },
      { ts: START + 1_000n, tagId: 1002, value:  5.0 },
    ]);
    const tile = await getTrendTile([1002], START, END, COUNT) as RawTrendTile;
    const s = tile.series[0];
    expect(s.ts[0]).toBe(START + 1_000n);
    expect(s.ts[1]).toBe(START + 2_000n);
    expect(s.ts[2]).toBe(START + 5_000n);
    expect(s.value).toEqual([5.0, 10.0, 20.0]);
  });

  it('tagIds order is preserved in series array even when a tag has no samples', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 1004, value: 1.0 }]);
    const tile = await getTrendTile([1005, 1004], START, END, COUNT) as RawTrendTile;
    expect(tile.series[0].tagId).toBe(1005);
    expect(tile.series[0].ts).toEqual([]);
    expect(tile.series[0].value).toEqual([]);
    expect(tile.series[1].tagId).toBe(1004);
    expect(tile.series[1].value).toEqual([1.0]);
  });

  it('empty range: tag with no samples returns ts:[] value:[]', async () => {
    const tile = await getTrendTile([1006], START, END, COUNT) as RawTrendTile;
    expect(tile.series[0].ts).toEqual([]);
    expect(tile.series[0].value).toEqual([]);
  });

  it('value array preserves null entries', async () => {
    await writeTestSamples([
      { ts: START + 1_000n, tagId: 1007, value: 3.0 },
      { ts: START + 2_000n, tagId: 1007, value: null },
      { ts: START + 3_000n, tagId: 1007, value: 4.0 },
    ]);
    const tile = await getTrendTile([1007], START, END, COUNT) as RawTrendTile;
    expect(tile.series[0].value[1]).toBeNull();
  });

  it('ts arrays carry bigint values', async () => {
    await writeTestSamples([{ ts: START + 1_500n, tagId: 1008, value: 7.0 }]);
    const tile = await getTrendTile([1008], START, END, COUNT) as RawTrendTile;
    expect(typeof tile.series[0].ts[0]).toBe('bigint');
    expect(tile.series[0].ts[0]).toBe(START + 1_500n);
  });

  it('bounded-prev: prev present when prior sample is within the 5-minute window', async () => {
    // Write one sample 60 s before the window (within the 5-minute bound).
    const prevTs = START - 60_000n;
    await writeTestSamples([{ ts: prevTs, tagId: 1011, value: 42.0 }]);
    const tile = await getTrendTile([1011], START, END, COUNT) as RawTrendTile;
    expect(tile.series[0].prev).toBeDefined();
    expect(tile.series[0].prev!.ts).toBe(prevTs);
    expect(tile.series[0].prev!.value).toBe(42.0);
  });

  it('bounded-prev: prev absent when prior sample is outside the 5-minute window', async () => {
    // Write one sample 6 minutes before the window (outside the 5-minute bound).
    const prevTs = START - 360_000n;
    await writeTestSamples([{ ts: prevTs, tagId: 1012, value: 7.0 }]);
    const tile = await getTrendTile([1012], START, END, COUNT) as RawTrendTile;
    expect(tile.series[0].prev).toBeUndefined();
  });

  it('bounded-prev: prev absent when no samples exist before the window at all', async () => {
    // Write only one in-window sample — nothing before startTime.
    await writeTestSamples([{ ts: START + 10_000n, tagId: 1013, value: 3.0 }]);
    const tile = await getTrendTile([1013], START, END, COUNT) as RawTrendTile;
    expect(tile.series[0].prev).toBeUndefined();
  });

  it('bounded-prev: independent per tag — some with prev, some without', async () => {
    // Tag 1014: has prior sample within 5 min.
    // Tag 1015: prior sample exists but is outside 5 min — no prev.
    await writeTestSamples([
      { ts: START - 30_000n, tagId: 1014, value: 11.0 },  // 30s before → within bound
      { ts: START - 360_000n, tagId: 1015, value: 22.0 }, // 6 min before → outside bound
    ]);
    const tile = await getTrendTile([1014, 1015], START, END, COUNT) as RawTrendTile;
    const s14 = tile.series.find(s => s.tagId === 1014)!;
    const s15 = tile.series.find(s => s.tagId === 1015)!;
    expect(s14.prev).toBeDefined();
    expect(s14.prev!.value).toBe(11.0);
    expect(s15.prev).toBeUndefined();
  });

  it('unified query sanity: 3-tag mixed prev — prev set/unset independently, in-window rows ordered', async () => {
    // Tag 1016: prev within 5 min → prev defined, with in-window samples.
    // Tag 1017: prev outside 5 min → no prev.
    // Tag 1018: no prior samples at all → no prev, only in-window.
    await writeTestSamples([
      { ts: START - 45_000n, tagId: 1016, value: 5.5 },   // 45s before → within bound
      { ts: START - 360_000n, tagId: 1017, value: 9.0 },  // 6 min before → outside bound
      { ts: START + 1_000n,   tagId: 1016, value: 10.0 }, // in-window
      { ts: START + 2_000n,   tagId: 1016, value: 20.0 }, // in-window
      { ts: START + 3_000n,   tagId: 1018, value: 30.0 }, // in-window, no prev
    ]);
    const tile = await getTrendTile([1016, 1017, 1018], START, END, COUNT) as RawTrendTile;
    const s16 = tile.series.find(s => s.tagId === 1016)!;
    const s17 = tile.series.find(s => s.tagId === 1017)!;
    const s18 = tile.series.find(s => s.tagId === 1018)!;

    // Prev correctness.
    expect(s16.prev).toBeDefined();
    expect(s16.prev!.value).toBe(5.5);
    expect(s17.prev).toBeUndefined();
    expect(s18.prev).toBeUndefined();

    // In-window rows for tag 1016 must arrive in chronological order.
    expect(s16.ts).toHaveLength(2);
    expect(s16.ts[0]).toBe(START + 1_000n);
    expect(s16.ts[1]).toBe(START + 2_000n);
    expect(s16.value).toEqual([10.0, 20.0]);

    // Tag 1018 has no prev but has one in-window sample.
    expect(s18.ts).toHaveLength(1);
    expect(s18.value).toEqual([30.0]);
  });

  it('raw path: startTime and endTime match the request exactly regardless of alignment', async () => {
    // Raw path (bucketS < 1.0) must never mutate the requested range.
    const unalignedStart = START + 123n;
    const unalignedEnd   = END   + 123n;
    await writeTestSamples([{ ts: unalignedStart + 1_000n, tagId: 1009, value: 7.0 }]);
    const tile = await getTrendTile([1009], unalignedStart, unalignedEnd, COUNT) as RawTrendTile;
    expect(tile.source).toBe('raw');
    expect(tile.startTime).toBe(unalignedStart);
    expect(tile.endTime).toBe(unalignedEnd);
  });
});

// ── 1s CAG branch (1.0 ≤ bucketS < 16) ───────────────────────────────────────
// Window: startTime=7_200_000n (2h), endTime=10_800_000n (3h), bucketCount=250
// bucketS = 3_600_000 / 250_000 = 14.4 — 1s CAG path.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration: 1s CAG branch (bucketS=14.4)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  const START = 7_200_000n;   // 2h past epoch
  const END   = 10_800_000n;  // 3h past epoch
  const COUNT = 250;
  const VIEW  = '1s_cagg' as const;

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg(VIEW);
  });
  afterEach(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });
  afterAll(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });

  it('dispatches to source="1s_cagg" for a 1h window with 250 buckets', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 2001, value: 1.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2001], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('1s_cagg');
  });

  it('aggregate response has n === bucketCount, all three series arrays have same length', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 2002, value: 1.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2002], START, END, COUNT) as AggregateTrendTile;
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
    expect(tile.series[0].min).toHaveLength(COUNT);
    expect(tile.series[0].max).toHaveLength(COUNT);
  });

  it('LOCF carries forward across empty buckets', async () => {
    // Write one sample early in the window; the rest of the 250 buckets should carry it.
    await writeTestSamples([{ ts: START + 500n, tagId: 2003, value: 42.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2003], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    // First bucket should contain 42.0; all subsequent buckets carry it forward.
    expect(value[0]).toBe(42.0);
    expect(value[COUNT - 1]).toBe(42.0);
    expect(value.every(v => v === 42.0)).toBe(true);
    // Empty buckets must collapse min/max to the LOCF'd value — no phantom spread.
    expect(min[0]).toBe(42.0);
    expect(max[0]).toBe(42.0);
    expect(min.every(m => m === 42.0)).toBe(true);
    expect(max.every(m => m === 42.0)).toBe(true);
  });

  it('bucket containing a NULL sample emits null in value array regardless of LOCF', async () => {
    // Write value=10 early, then null, then 20 near end.
    // The bucket containing the null must emit null even though locf would carry 10.
    const bucketSMs = BigInt(Math.round(14.4 * 1000)); // ~14400 ms per outer bucket
    await writeTestSamples([
      { ts: START + 100n,            tagId: 2004, value: 10.0 },
      { ts: START + bucketSMs * 5n,  tagId: 2004, value: null },
      { ts: START + bucketSMs * 10n, tagId: 2004, value: 20.0 },
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2004], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    // bucket 5 must be null — mixed-null rule nulls all three arrays
    expect(value[5]).toBeNull();
    expect(min[5]).toBeNull();
    expect(max[5]).toBeNull();
    // bucket 10 should be 20
    expect(value[10]).toBe(20.0);
  });

  it('bounded prev populates left edge when prior sample exists in the 5-minute pre-window', async () => {
    // Write a sample 60 s before the window (within the 5-minute prev bound),
    // and one sample inside the window to ensure gapfill produces rows for this tag.
    const priorTs = START - 60_000n;  // 60s before window
    const inTs    = START + 3_500_000n; // ~58 min into the window (bucket ~243)
    await writeTestSamples([
      { ts: priorTs, tagId: 2005, value: 55.5 },
      { ts: inTs,    tagId: 2005, value: 99.0 },
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2005], START, END, COUNT) as AggregateTrendTile;
    const { value } = tile.series[0];
    // Left edge buckets (before inTs) should carry the prev value 55.5.
    expect(value[0]).toBe(55.5);
    // Buckets past inTs are empty → LOCF carries 99.0 forward (no cutoff).
    expect(value[COUNT - 1]).toBe(99.0);
  });

  it('bounded prev returns null when no prior sample exists within 5 minutes', async () => {
    // Write ONLY one in-window sample with nothing in the pre-window.
    // Left-edge buckets before it must be null (leading-edge NULL prev case).
    const inTs = START + 1_800_000n; // 30 min into the window (bucket ~125)
    await writeTestSamples([{ ts: inTs, tagId: 2006, value: 7.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2006], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    expect(value[0]).toBeNull(); // left edge: no prev
    expect(value[COUNT - 1]).toBe(7.0); // inTs is ~bucket 125; LOCF carries 7.0 forward unbounded (no cutoff)
    // Leading-edge null: empty bucket with null LOCF → collapse to null/null/null.
    expect(min[0]).toBeNull();
    expect(max[0]).toBeNull();
  });

  it('empty range: tag with no CAG data returns value/min/max:[null]*n', async () => {
    // No samples written; CAG has nothing for this tag.
    const tile = await getTrendTile([2007], START, END, COUNT) as AggregateTrendTile;
    expect(tile.series[0].value).toHaveLength(COUNT);
    expect(tile.series[0].value.every(v => v === null)).toBe(true);
    expect(tile.series[0].min).toHaveLength(COUNT);
    expect(tile.series[0].min.every(m => m === null)).toBe(true);
    expect(tile.series[0].max).toHaveLength(COUNT);
    expect(tile.series[0].max.every(m => m === null)).toBe(true);
  });

  it('startTime and endTime are returned as bigint', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 2008, value: 1.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2008], START, END, COUNT) as AggregateTrendTile;
    expect(typeof tile.startTime).toBe('bigint');
    expect(typeof tile.endTime).toBe('bigint');
    expect(tile.startTime).toBe(START);
    expect(tile.endTime).toBe(END);
  });

  // ── Alignment contract tests ─────────────────────────────────────────────────
  // bucketSMs = round(14.4 * 1000) = 14400 ms per outer bucket.
  // START = 7_200_000n; 7200000 % 14400 = 0  → aligned.

  it('aligned startTime returns exactly bucketCount buckets with matching startTime/endTime', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 2009, value: 3.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2009], START, END, COUNT) as AggregateTrendTile;
    expect(tile.n).toBe(COUNT);
    expect(tile.startTime).toBe(START);
    expect(tile.endTime).toBe(END);
    expect(tile.series[0].value).toHaveLength(COUNT);
  });

  it('unaligned startTime returns bucketCount+1 buckets; served grid wraps the request', async () => {
    const BUCKET_MS = 14_400;
    // Shift by 100 ms: 7_200_100 % 14400 = 100 — not a natural bucket boundary.
    const unalignedStart = START + 100n;
    const unalignedEnd   = unalignedStart + BigInt(COUNT * BUCKET_MS);

    await writeTestSamples([{ ts: unalignedStart + 1_000n, tagId: 2010, value: 5.0 }]);
    await refreshTestCagg(VIEW);

    const tile = await getTrendTile([2010], unalignedStart, unalignedEnd, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('1s_cagg');
    expect(tile.n).toBe(COUNT + 1);
    // Served grid snaps back to the natural boundary before unalignedStart.
    expect(tile.startTime).toBe(START);                                  // 7_200_000n
    expect(tile.endTime).toBe(START + BigInt((COUNT + 1) * BUCKET_MS));  // 10_814_400n
    expect(tile.series[0].value).toHaveLength(COUNT + 1);
  });

  it('multi-tag unaligned request: all series share the same bucket grid', async () => {
    const BUCKET_MS = 14_400;
    const unalignedStart = START + 500n;
    const unalignedEnd   = unalignedStart + BigInt(COUNT * BUCKET_MS);

    await writeTestSamples([
      { ts: unalignedStart + 1_000n, tagId: 2011, value: 1.0 },
      { ts: unalignedStart + 2_000n, tagId: 2012, value: 2.0 },
      { ts: unalignedStart + 3_000n, tagId: 2013, value: 3.0 },
    ]);
    await refreshTestCagg(VIEW);

    const tile = await getTrendTile([2011, 2012, 2013], unalignedStart, unalignedEnd, COUNT) as AggregateTrendTile;
    expect(tile.n).toBe(COUNT + 1);
    expect(tile.series).toHaveLength(3);
    for (const s of tile.series) {
      expect(s.value).toHaveLength(tile.n);
      expect(s.min).toHaveLength(tile.n);
      expect(s.max).toHaveLength(tile.n);
    }
  });

  // ── min/max bands — three-case rule ───────────────────────────────────────────
  // Tag IDs 2100–2119 reserved for this block.
  // All tests use the 1s_cagg dispatch zone: START=7_200_000n, END=10_800_000n,
  // bucketSMs=14400ms.

  it('three-case: normal bucket — measured spread (value=last, min=true-min, max=true-max)', async () => {
    // Three samples in outer bucket 5 ([START+72000ms, START+86400ms)):
    //   ts +72100 → 1.0   ts +72200 → 3.0   ts +72300 → 2.0 (latest → last=2.0)
    // No guard needed — LOCF cutoff removed; bucket 5 carries real data.
    const B5 = START + 72_000n; // start of outer bucket 5 (14400ms × 5 = 72000ms past START)
    await writeTestSamples([
      { ts: B5 + 100n, tagId: 2100, value: 1.0 },
      { ts: B5 + 200n, tagId: 2100, value: 3.0 },
      { ts: B5 + 300n, tagId: 2100, value: 2.0 },
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2100], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    expect(value[5]).toBe(2.0);  // last by ts within bucket 5
    expect(min[5]).toBe(1.0);    // true minimum across all samples in bucket 5
    expect(max[5]).toBe(3.0);    // true maximum
  });

  it('three-case: single-sample bucket — degenerate band (value === min === max)', async () => {
    // One sample in outer bucket 3.
    const B3 = START + 43_200n; // start of outer bucket 3 (14400ms × 3 = 43200ms past START)
    await writeTestSamples([
      { ts: B3 + 100n, tagId: 2101, value: 5.0 },
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2101], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    expect(value[3]).toBe(5.0);
    expect(min[3]).toBe(5.0);  // degenerate: min === value
    expect(max[3]).toBe(5.0);  // degenerate: max === value
  });

  it('three-case: empty bucket LOCF collapse — min/max equal LOCF value, not prior spread', async () => {
    // Sample at bucket 0: value=7.0.  Sample at bucket 10: value=99.0.
    // Buckets 1–9 are empty (gapfilled) between these two real samples.
    // Their LOCF'd value is 7.0. min/max must collapse to 7.0, not carry prior spread.
    const B10 = START + BigInt(10 * 14_400); // start of outer bucket 10
    await writeTestSamples([
      { ts: START + 100n, tagId: 2102, value: 7.0 },
      { ts: B10 + 100n,   tagId: 2102, value: 99.0 },
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2102], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    // Bucket 5 is empty — LOCF'd from bucket 0's last = 7.0.
    expect(value[5]).toBe(7.0);
    expect(min[5]).toBe(7.0);   // collapsed, not null and not a spread
    expect(max[5]).toBe(7.0);   // collapsed
    // Bucket 10 has the real sample.
    expect(value[10]).toBe(99.0);
    expect(min[10]).toBe(99.0); // single sample
    expect(max[10]).toBe(99.0);
  });

  it('three-case: mixed-null bucket — all three fields null (band gap)', async () => {
    // Write samples across three separate 1s sub-buckets inside outer bucket 5.
    // One sample is null → null_count=1 in the 1s CAG → outer sum(null_count)>0 → band gap.
    // LOCF cutoff removed — bucket 5 has real data so this is fine regardless.
    const B5 = START + 72_000n;
    await writeTestSamples([
      { ts: B5 + 100n,   tagId: 2103, value: 1.0  },  // 1s sub-bucket 7272000ms
      { ts: B5 + 1_100n, tagId: 2103, value: null },  // 1s sub-bucket 7273000ms → null_count=1
      { ts: B5 + 2_100n, tagId: 2103, value: 2.0  },  // 1s sub-bucket 7274000ms
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2103], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    // Bucket 5: sum(null_count)=1 → mixed-null case → all three must be null.
    expect(value[5]).toBeNull();
    expect(min[5]).toBeNull();
    expect(max[5]).toBeNull();
  });

  // ── Aggregator correction spot-check (Div=8) ──────────────────────────────────
  // Verifies min(s.min) / max(s.max) — not last(s.min, s.bucket) / last(s.max, s.bucket).
  // With bucketSMs=8000ms the dispatch stays 1s_cagg (8.0s < 16s).
  // 4 samples occupy different 1s sub-buckets within outer bucket 0.
  // The *last* 1s sub-bucket by time (at +7000ms) has value=35.0 — NOT the global min/max.
  // Correct:   min=5.0  max=50.0   (min/max across all four sub-buckets)
  // Wrong doc: min=35.0 max=35.0   (min/max of the last sub-bucket only)

  it('aggregator correction (Div=8): min(s.min)/max(s.max) spans all sub-buckets, not just the last', async () => {
    const COUNT_8 = 450; // bucketSMs = round(3_600_000 / 450) = 8000ms
    await writeTestSamples([
      { ts: START +   500n, tagId: 2104, value:  5.0 }, // global min  — 1s sub-bucket 0
      { ts: START + 1_500n, tagId: 2104, value: 50.0 }, // global max  — 1s sub-bucket 1
      { ts: START + 2_500n, tagId: 2104, value: 20.0 }, //              1s sub-bucket 2
      { ts: START + 7_000n, tagId: 2104, value: 35.0 }, // LAST by time — 1s sub-bucket 7
    ]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([2104], START, END, COUNT_8) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    expect(value[0]).toBe(35.0);  // last by ts in bucket 0
    // Correct aggregation: min/max span all four sub-buckets.
    expect(min[0]).toBe(5.0);   // true minimum — would be 35.0 with last(s.min, s.bucket)
    expect(max[0]).toBe(50.0);  // true maximum — would be 35.0 with last(s.max, s.bucket)
  });
});

// ── 10s CAG branch (16 ≤ bucketS < 160) ──────────────────────────────────────
// Window: startTime=14_400_000n (4h), endTime=43_200_000n (12h), bucketCount=250
// bucketS = 28_800_000 / 250_000 = 115.2 — 10s CAG path.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration: 10s CAG branch (bucketS=115.2)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  const START = 14_400_000n;  // 4h past epoch
  const END   = 43_200_000n;  // 12h past epoch
  const COUNT = 250;
  const VIEW  = '10s_cagg' as const;

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg(VIEW);
  });
  afterEach(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });
  afterAll(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });

  it('dispatches to source="10s_cagg" for the 8h window', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 3001, value: 1.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([3001], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('10s_cagg');
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
  });
});

// ── 1min CAG branch (160 ≤ bucketS < 1600) ────────────────────────────────────
// Window: startTime=86_400_000n (1d), endTime=259_200_000n (3d), bucketCount=250
// bucketS = 172_800_000 / 250_000 = 691.2 — 1min CAG path.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration: 1min CAG branch (bucketS=691.2)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  const START = 86_400_000n;   // 1 day past epoch
  const END   = 259_200_000n;  // 3 days past epoch
  const COUNT = 250;
  const VIEW  = '1min_cagg' as const;

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg(VIEW);
  });
  afterEach(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });
  afterAll(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });

  it('dispatches to source="1min_cagg" for the 2-day window', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 4001, value: 1.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([4001], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('1min_cagg');
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
  });
});

// ── 10min CAG branch (bucketS ≥ 1600) ─────────────────────────────────────────
// Window: startTime=604_800_000n (7d), endTime=1_900_800_000n (22d), bucketCount=250
// bucketS = 1_296_000_000 / 250_000 = 5184 — 10min CAG path.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration: 10min CAG branch (bucketS=5184)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  // startTime must be epoch-aligned to the outer bucketS (5184 s).
  // 1_296_000_000 ms = 1296000 s; 1296000 / 5184 = 250 (exact multiple).
  // endTime = startTime + 250 * 5184 * 1000 = startTime + 1_296_000_000.
  const START = 1_296_000_000n;  // 15 days past epoch
  const END   = 2_592_000_000n;  // 30 days past epoch
  const COUNT = 250;
  const VIEW  = '10min_cagg' as const;

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg(VIEW);
  });
  afterEach(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });
  afterAll(async () => {
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });

  it('dispatches to source="10min_cagg" for the 15-day window', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 5001, value: 1.0 }]);
    await refreshTestCagg(VIEW);
    const tile = await getTrendTile([5001], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('10min_cagg');
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
  });
});

// ── Watermark fall-through tests ───────────────────────────────────────────────
//
// All synthetic-fixture tests use __test_watermarkOverride to control watermarks
// deterministically. The sandbox window is 1970-epoch; watermark ms values are
// chosen relative to the test ranges.
//
// Tag IDs 6001–6099 are reserved for this block.
//
// Window: 1s CAG range (same as the 1s_cagg block above).
// bucketS = 3_600_000 / 250_000 = 14.4 → 1s_cagg dispatch.
// bucketSMs = 14_400.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — watermark fall-through', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  // Use 1s_cagg dispatch window (same parameters as the 1s_cagg block).
  const START     = 7_200_000n;   // 2h past epoch
  const END       = 10_800_000n;  // 3h past epoch
  const COUNT     = 250;
  const BUCKET_MS = 14_400;       // Math.round(14.4 * 1000)

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg('1s_cagg');
    // Ensure production watermark is NOT used by any test in this block.
    // Each test sets its own override; this guards against override leak.
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
  });

  afterEach(async () => {
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
    await resetTestRange();
    await refreshTestCagg('1s_cagg');
  });

  afterAll(async () => {
    await resetTestRange();
    await refreshTestCagg('1s_cagg');
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
  });

  // ── Test 1: watermark past endTime — no fall-through ─────────────────────────

  it('watermark past endTime → single source, no fall-through', async () => {
    // Set watermark well past END so the entire window is covered by 1s_cagg.
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg', Number(END) + 60_000],
    ]);

    await writeTestSamples([{ ts: START + 1_000n, tagId: 6001, value: 7.5 }]);
    await refreshTestCagg('1s_cagg');

    const tile = await getTrendTile([6001], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('1s_cagg');   // NOT 'mixed'
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
    // Bucket 0 has the real sample; later buckets are empty → LOCF carries 7.5 forward.
    expect(tile.series[0].value[0]).toBe(7.5);
    expect(tile.series[0].value[COUNT - 1]).toBe(7.5);
  });

  // ── Test 2: watermark mid-range → fall-through to next-finer CAG ─────────────

  it('watermark mid-range → source=mixed, 1s_cagg+10s_cagg stitch', async () => {
    // Split at bucket boundary: 125 buckets into the window.
    const splitMs = Number(START) + 125 * BUCKET_MS; // exactly bucket-aligned
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg',   splitMs + 1],  // watermark just past split → splitBoundary = splitMs
      ['tag_samples_10s_cagg',  Number(END) + 60_000],  // 10s_cagg covers the tail
    ]);

    // Write data in both halves so both segments return non-null values.
    await writeTestSamples([
      { ts: START + 1_000n,                                value: 1.0, tagId: 6002 },
      { ts: BigInt(splitMs) + 1_000n,                      value: 2.0, tagId: 6002 },
    ]);
    await refreshTestCagg('1s_cagg');
    // 10s_cagg doesn't need refresh for the tail — raw-as-aggregate path will be
    // used if 10s_cagg also has no data, which is fine (null values expected).
    // Refresh 10s_cagg for the sandbox window so it can contribute.
    await refreshTestCagg('10s_cagg');

    const tile = await getTrendTile([6002], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('mixed');
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
    // min/max must stitch correctly across the source seam — same length as value.
    expect(tile.series[0].min).toHaveLength(COUNT);
    expect(tile.series[0].max).toHaveLength(COUNT);
  });

  // ── Test 3: watermark before startTime → entire range falls through ──────────

  it('watermark before startTime → entire range falls through to next-finer', async () => {
    // 1s_cagg watermark is before the test window; 10s_cagg covers the whole range.
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg',  Number(START) - 10_000],  // before window
      ['tag_samples_10s_cagg', Number(END)   + 60_000],  // covers everything
    ]);

    await writeTestSamples([{ ts: START + 1_000n, tagId: 6003, value: 5.0 }]);
    await refreshTestCagg('1s_cagg');
    await refreshTestCagg('10s_cagg');

    const tile = await getTrendTile([6003], START, END, COUNT) as AggregateTrendTile;
    // Fall-through occurred (1s_cagg not used), so source = 'mixed'.
    expect(tile.source).toBe('mixed');
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
  });

  // ── Test 4: split at non-bucket-aligned watermark — boundary rounds down ──────

  it('non-bucket-aligned watermark → splitBoundary rounds down, n stays bucketCount', async () => {
    // Watermark falls 7200 ms into a 14400 ms bucket (halfway).
    // splitBoundary = floor((START + 125*BUCKET_MS + 7200) / BUCKET_MS) * BUCKET_MS
    //               = START + 125*BUCKET_MS (rounded down, not up).
    const splitMs        = Number(START) + 125 * BUCKET_MS;
    const midBucketWmMs  = splitMs + 7_200;  // halfway through bucket 125

    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg',  midBucketWmMs],
      ['tag_samples_10s_cagg', Number(END) + 60_000],
    ]);

    await writeTestSamples([
      { ts: START + 1_000n,           value: 11.0, tagId: 6004 },
      { ts: BigInt(splitMs) + 1_000n, value: 22.0, tagId: 6004 },
    ]);
    await refreshTestCagg('1s_cagg');
    await refreshTestCagg('10s_cagg');

    const tile = await getTrendTile([6004], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('mixed');
    // n must still be exactly COUNT (aligned request, aligned split).
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);
  });

  // ── Test 5: cascade through two CAG levels ────────────────────────────────────
  //
  // Uses a 10s_cagg dispatch range (bucketS = 115.2) so the fall-through ladder
  // goes: dispatch=10s_cagg → split at watermark mid-window → tail falls through
  // 1s_cagg (watermark before window) → raw (tag_samples). Two distinct sources
  // actually serve data: tag_samples_10s_cagg (left half) + tag_samples (right half).

  it('cascade through two levels: 10s_cagg splits, tail falls through 1s_cagg → raw', async () => {
    // 10s_cagg dispatch range: START_10S=4h, END_10S=12h, COUNT=250.
    // bucketS = 28_800_000 / 250_000 = 115.2 → tag_samples_10s_cagg dispatch.
    // bucketSMs = Math.round(115.2 * 1000) = 115_200.
    const START_10S     = 14_400_000n;  // 4h past epoch (bucket-aligned: 14_400_000 / 115_200 = 125)
    const END_10S       = 43_200_000n;  // 12h past epoch
    const BUCKET_MS_10S = 115_200;

    // Place 10s_cagg watermark 200 buckets into the window:
    //   splitBoundaryMs = 14_400_000 + 200 * 115_200 = 37_440_000 (exact boundary)
    const splitMs10s = Number(START_10S) + 200 * BUCKET_MS_10S; // 37_440_000
    __test_watermarkOverride.current = new Map([
      ['tag_samples_10s_cagg', splitMs10s + 1],             // watermark just past split
      ['tag_samples_1s_cagg',  Number(START_10S) - 10_000], // before window → falls through to raw
    ]);

    await writeTestSamples([{ ts: START_10S + 1_000n, tagId: 6005, value: 3.0 }]);
    await refreshTestCagg('1s_cagg');
    await refreshTestCagg('10s_cagg');

    const tile = await getTrendTile([6005], START_10S, END_10S, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('mixed');
    expect(tile.n).toBe(COUNT);
    expect(tile.series[0].value).toHaveLength(COUNT);

    // Prove recursion reached two distinct sources:
    // 10s_cagg served the left half; tag_samples served the right half (1s_cagg fell through entirely).
    expect(__test_lastUsedSources.current.size).toBeGreaterThanOrEqual(2);
    expect(__test_lastUsedSources.current.has('tag_samples_10s_cagg')).toBe(true);
    expect(__test_lastUsedSources.current.has('tag_samples')).toBe(true);
  });

  // ── Test 6: raw dispatch is unaffected by watermark overrides ─────────────────

  it('raw dispatch (short tile window) ignores watermark overrides', async () => {
    // Set overrides for all CAGs to weird values — raw path must not use them.
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg',    0],
      ['tag_samples_10s_cagg',   0],
      ['tag_samples_1min_cagg',  0],
      ['tag_samples_10min_cagg', 0],
    ]);

    // Raw window: 20s tile window, expectedPoints = 200 ≤ 250 → raw dispatch.
    const RAW_START = 3_600_000n;
    const RAW_END   = 3_620_000n;
    await writeTestSamples([{ ts: RAW_START + 1_000n, tagId: 6006, value: 8.0 }]);

    const tile = await getTrendTile([6006], RAW_START, RAW_END, COUNT) as RawTrendTile;
    expect(tile.source).toBe('raw');
    expect(tile.startTime).toBe(RAW_START);
    expect(tile.endTime).toBe(RAW_END);
    expect(tile.series[0].value).toEqual([8.0]);
  });

  // ── Test 7: live-edge smoke (production watermark, no override) ───────────────
  //
  // Validates real-world fall-through against the running system.
  // Uses [now-10min, now] → bucketS=2.4s → 1s_cagg dispatch.
  // 1s_cagg watermark typically lags now by ~60s, so the trailing portion
  // falls through to tag_samples (raw-as-aggregate) or the next-finer level.
  // Skips if TIMESCALE_HOST is unset (existing guard pattern).

  it('live-edge smoke: [now-10min, now] with production watermark (no override)', async () => {
    const { pickRecentlyActiveTagId } = await import('../helpers/trends-test-range.js');
    const tagId = await pickRecentlyActiveTagId();
    if (tagId === null) {
      // No active tag in the last 5 minutes — skip rather than fail.
      console.warn('[live-edge smoke] no recently active tag found; test skipped');
      return;
    }

    // Ensure production watermarks are used.
    __test_watermarkOverride.current = null;

    const nowMs     = BigInt(Date.now());
    const tenMin    = 600_000n;
    const liveStart = nowMs - tenMin;
    const liveEnd   = nowMs;

    // bucketS = 600_000 / 250_000 = 2.4 → 1s_cagg dispatch
    const tile = await getTrendTile([tagId], liveStart, liveEnd, COUNT) as AggregateTrendTile;

    // Source must be '1s_cagg' (watermark covers full range) or 'mixed' (fall-through).
    expect(['1s_cagg', 'mixed']).toContain(tile.source);

    // n must be COUNT or COUNT+1 (alignment contract).
    expect([COUNT, COUNT + 1]).toContain(tile.n);

    // The value array must have n entries.
    expect(tile.series[0].value).toHaveLength(tile.n);

    // At least one non-null value must exist anywhere in the window.
    // (The tag may have logged data earlier in the 10-min span, not only at the edge.)
    const nonNullCount = tile.series[0].value.filter(v => v !== null).length;
    expect(nonNullCount).toBeGreaterThan(0);
  });
});

// ── Future-bucket nulling tests ────────────────────────────────────────────────
//
// All tests use the 1s CAG dispatch zone (same windows as the 1s_cagg block):
// START=7_200_000n (2h), END=10_800_000n (3h), COUNT=250, bucketSMs=14_400.
//
// nowMs is passed explicitly so tests are deterministic and do not depend on
// the real Date.now() wall clock.
//
// Tag IDs 7001–7099 are reserved for this block.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — future-bucket nulling (§6.5)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  const START      = 7_200_000n;   // 2h past epoch
  const END        = 10_800_000n;  // 3h past epoch
  const COUNT      = 250;
  const BUCKET_MS  = 14_400;       // Math.round(14.4 * 1000)
  const VIEW       = '1s_cagg' as const;

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg(VIEW);
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg', Number(END) + 3_600_000],  // watermark past end — no fall-through
    ]);
    __test_clearWatermarkCache();
  });

  afterEach(async () => {
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });

  afterAll(async () => {
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
    await resetTestRange();
    await refreshTestCagg(VIEW);
  });

  // a) endTime past nowMs: buckets after nowMs are nulled; buckets before are preserved.
  it('aggregate, endTime past nowMs: future buckets are null; past buckets have real data', async () => {
    // Write one sample early in the window (bucket 0).
    await writeTestSamples([{ ts: START + 500n, tagId: 7001, value: 42.0 }]);
    await refreshTestCagg(VIEW);

    // nowMs = 1ms before the start of bucket 125 → inside bucket 124.
    // Rule: bucketStartMs > nowMs → nulled.
    // Bucket 124: start = START + 124*BUCKET_MS < nowMs → preserved.
    // Bucket 125: start = START + 125*BUCKET_MS > nowMs → nulled.
    const nowMs = Number(START) + 125 * BUCKET_MS - 1;

    const tile = await getTrendTile([7001], START, END, COUNT, nowMs) as AggregateTrendTile;

    // Buckets 0–124: at or before nowMs → must retain LOCF'd 42.0.
    expect(tile.series[0].value[0]).toBe(42.0);
    expect(tile.series[0].value[124]).toBe(42.0);
    // Bucket 125 onward: bucketStartMs > nowMs → must be null.
    expect(tile.series[0].value[125]).toBeNull();
    expect(tile.series[0].value[249]).toBeNull();
    // min/max nulled in lockstep with value.
    expect(tile.series[0].min[125]).toBeNull();
    expect(tile.series[0].max[125]).toBeNull();
    // Array length unchanged.
    expect(tile.series[0].value).toHaveLength(COUNT);
  });

  // b) endTime exactly at nowMs: no buckets nulled (none strictly past nowMs).
  it('aggregate, endTime exactly at nowMs: no buckets nulled', async () => {
    await writeTestSamples([{ ts: START + 500n, tagId: 7002, value: 7.0 }]);
    await refreshTestCagg(VIEW);

    // nowMs = END exactly. All bucket starts are ≤ nowMs (last bucket start = END - BUCKET_MS).
    const nowMs = Number(END);

    const tile = await getTrendTile([7002], START, END, COUNT, nowMs) as AggregateTrendTile;

    // No future buckets — every bucket start < END = nowMs.
    expect(tile.series[0].value.every(v => v !== null)).toBe(true);
    expect(tile.series[0].value[COUNT - 1]).toBe(7.0);
  });

  // c) endTime entirely before nowMs: no buckets nulled.
  it('aggregate, endTime before nowMs: no buckets nulled (all in the past)', async () => {
    await writeTestSamples([{ ts: START + 500n, tagId: 7003, value: 5.0 }]);
    await refreshTestCagg(VIEW);

    // nowMs well in the future (2 days after END).
    const nowMs = Number(END) + 2 * 86_400_000;

    const tile = await getTrendTile([7003], START, END, COUNT, nowMs) as AggregateTrendTile;

    expect(tile.series[0].value.every(v => v !== null)).toBe(true);
    expect(tile.series[0].value[0]).toBe(5.0);
    expect(tile.series[0].value[COUNT - 1]).toBe(5.0);
  });

  // d) Bucket containing nowMs is preserved; the next bucket (startMs > nowMs) is nulled.
  it('bucket containing nowMs preserved; first bucket past nowMs is null', async () => {
    // Write a sample at bucket 0 so LOCF fills all buckets with 99.0.
    await writeTestSamples([{ ts: START + 500n, tagId: 7004, value: 99.0 }]);
    await refreshTestCagg(VIEW);

    // Place nowMs halfway through bucket 10 (startMs = START + 10 * BUCKET_MS).
    // Bucket 10: start = START + 10*BUCKET_MS, end = START + 11*BUCKET_MS.
    // nowMs = start_of_bucket_10 + BUCKET_MS/2 → inside bucket 10, which is preserved.
    // Bucket 11: start > nowMs → nulled.
    const bucket10Start = Number(START) + 10 * BUCKET_MS;
    const nowMs = bucket10Start + BUCKET_MS / 2;

    const tile = await getTrendTile([7004], START, END, COUNT, nowMs) as AggregateTrendTile;

    // Bucket 10 (containing nowMs): preserved.
    expect(tile.series[0].value[10]).toBe(99.0);
    // Bucket 11 (first strictly past nowMs): null.
    expect(tile.series[0].value[11]).toBeNull();
    expect(tile.series[0].min[11]).toBeNull();
    expect(tile.series[0].max[11]).toBeNull();
    // Bucket 9 (well in the past): also preserved.
    expect(tile.series[0].value[9]).toBe(99.0);
  });

  // e) Raw tile, endTime past nowMs: raw path is unaffected (no future-null pass on raw).
  it('raw tile, endTime past nowMs: raw response is unchanged (no synthetic nulls)', async () => {
    // Raw window: 20s tile, expectedPoints = 200 ≤ 250 → raw path.
    const RAW_START = 3_600_000n;
    const RAW_END   = 3_620_000n;
    const RAW_COUNT = 250;

    await writeTestSamples([
      { ts: RAW_START + 1_000n, tagId: 7005, value: 11.0 },
      { ts: RAW_START + 2_000n, tagId: 7005, value: 22.0 },
    ]);

    // nowMs = well before RAW_END — if raw applied future-null it would strip the second sample.
    const nowMs = Number(RAW_START) + 500;

    const tile = await getTrendTile([7005], RAW_START, RAW_END, RAW_COUNT, nowMs) as RawTrendTile;

    expect(tile.source).toBe('raw');
    // Both in-window samples must be present — raw path applies no future-null filtering.
    expect(tile.series[0].ts).toHaveLength(2);
    expect(tile.series[0].value).toEqual([11.0, 22.0]);
  });

  // f) Mixed source (watermark fall-through), endTime past nowMs: future buckets are nulled
  //    even on the stitched 'mixed' result.
  it('mixed source, endTime past nowMs: future buckets nulled on the stitched result', async () => {
    // Override: 1s_cagg covers first 125 buckets; 10s_cagg covers the rest.
    const splitMs = Number(START) + 125 * BUCKET_MS;
    __test_clearWatermarkCache();
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg',   splitMs + 1],             // watermark mid-range → fall-through
      ['tag_samples_10s_cagg',  Number(END) + 60_000],    // 10s_cagg covers the tail
    ]);

    // Write data in both halves.
    await writeTestSamples([
      { ts: START + 500n,             tagId: 7006, value: 3.0 },
      { ts: BigInt(splitMs) + 500n,   tagId: 7006, value: 3.0 },
    ]);
    await refreshTestCagg(VIEW);
    await refreshTestCagg('10s_cagg');

    // nowMs cuts at bucket 200 boundary — buckets 200–249 must be nulled.
    const nowMs = Number(START) + 200 * BUCKET_MS;

    const tile = await getTrendTile([7006], START, END, COUNT, nowMs) as AggregateTrendTile;

    expect(tile.source).toBe('mixed');
    // Bucket 199 (startMs = nowMs): preserved (startMs === nowMs, not strictly greater).
    expect(tile.series[0].value[199]).not.toBeNull();
    // Bucket 200 (startMs = START + 200*BUCKET_MS > nowMs — because nowMs = START + 200*BUCKET_MS,
    // that's equal, so bucket 200 start === nowMs → NOT strictly greater → also preserved).
    // Actually bucket 200 start = START + 200*BUCKET_MS = nowMs, so NOT > nowMs. First null is 201.
    expect(tile.series[0].value[200]).not.toBeNull();
    expect(tile.series[0].value[201]).toBeNull();
    expect(tile.series[0].value[249]).toBeNull();
    expect(tile.series[0].value).toHaveLength(COUNT);
  });
});

// ── Seam regression: non-Postgres-epoch-aligned bucketSMs ────────────────────
//
// Uses bucketSMs = 6221 ms (not a divisor of POSTGRES_EPOCH_MS = 946_684_800_000).
// Old code computed: splitBoundary = floor(watermarkMs / 6221) * 6221  (Unix epoch)
// New code computes: splitBoundary = floor((watermarkMs - POSTGRES_EPOCH_MS) / 6221) * 6221 + POSTGRES_EPOCH_MS
// These differ whenever POSTGRES_EPOCH_MS % bucketSMs ≠ 0.
// With the old formula, the split lands off the TimescaleDB time_bucket grid →
// left and right segments overlap at the seam → merged n = 502 → assertion throws.
// Tag IDs 9001–9099 are reserved for this block.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — seam regression: non-Postgres-epoch-aligned bucketSMs', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean, refreshTestCagg,
  } = await import('../helpers/trends-test-range.js');

  // span = 250 * 6221 ms = 1_555_250 ms → exact integer bucketSMs, no float error.
  // bucketS = 6.221 → dispatches to 1s_cagg (1.0 ≤ 6.221 < 16).
  const COUNT      = 250;
  const BUCKET_SMs = 6221;
  const START      = 7_200_000n;
  const END        = START + BigInt(COUNT * BUCKET_SMs); // 8_755_250n

  beforeEach(async () => {
    await resetTestRangeExpectClean();
    await refreshTestCagg('1s_cagg');
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
  });

  afterEach(async () => {
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
    await resetTestRange();
    await refreshTestCagg('1s_cagg');
  });

  afterAll(async () => {
    await resetTestRange();
    await refreshTestCagg('1s_cagg');
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
  });

  it('split at non-Postgres-epoch-aligned boundary: n is COUNT or COUNT+1, bucketSMs is integer', async () => {
    // Place the watermark just past the 125th bucket boundary to force a mid-range split.
    const midMs = Number(START) + 125 * BUCKET_SMs; // 8_977_625
    __test_watermarkOverride.current = new Map([
      ['tag_samples_1s_cagg',  midMs + 1],                // 1s_cagg covers left half
      ['tag_samples_10s_cagg', Number(END) + 60_000],     // 10s_cagg covers right half
    ]);

    await writeTestSamples([{ ts: START + 1_000n, tagId: 9001, value: 5.0 }]);
    await refreshTestCagg('1s_cagg');
    await refreshTestCagg('10s_cagg');

    const tile = await getTrendTile([9001], START, END, COUNT) as AggregateTrendTile;

    expect(tile.source).toBe('mixed');
    expect(Number.isInteger(tile.bucketSMs)).toBe(true);
    expect(tile.bucketSMs).toBe(BUCKET_SMs);
    // Without the Postgres-epoch alignment fix, the split lands off the TimescaleDB
    // grid → both segments include the seam bucket → merged n = 502 → throws.
    // With the fix, n must be exactly COUNT (aligned start) or COUNT+1 (unaligned).
    expect([COUNT, COUNT + 1]).toContain(tile.n);
    expect(tile.series[0].value).toHaveLength(tile.n);
  });
});

// ── getWatermarkMs — direct catalog query (Part 2A) ───────────────────────────
//
// Validates the live catalog path without going through getTrendTile or any
// watermark override. Skip the suite if TIMESCALE_HOST is unset.

describe.skipIf(!HAVE_TIMESCALE)('getWatermarkMs — direct catalog query', async () => {
  const CAGG_SOURCES = [
    'tag_samples_1s_cagg',
    'tag_samples_10s_cagg',
    'tag_samples_1min_cagg',
    'tag_samples_10min_cagg',
  ] as const;

  it.each(CAGG_SOURCES)('%s: returns finite ms timestamp within expected range', async (source) => {
    const wmMs = await __test_getWatermarkMs(source);

    // Watermark must be a finite number.
    expect(Number.isFinite(wmMs)).toBe(true);

    // Watermark must be positive (CAGs have been refreshed at least once).
    expect(wmMs).toBeGreaterThan(0);

    // Watermark must be no more than 10 minutes in the past (active refresh policy).
    expect(wmMs).toBeGreaterThan(Date.now() - 600_000);

    // Watermark must not be in the future.
    expect(wmMs).toBeLessThanOrEqual(Date.now() + 1_000); // +1 s tolerance for clock skew
  });

  it('tag_samples (raw): returns Infinity (no watermark concept)', async () => {
    const wmMs = await __test_getWatermarkMs('tag_samples');
    expect(wmMs).toBe(Infinity);
  });
});

// ── getTrendExtent — direct query ─────────────────────────────────────────────
//
// Tag IDs 8001–8099 are reserved for this block.
// Tests query the full table, so assertions are conservative: any data (from
// live operational writes or the sandbox) satisfies them. The null/null case
// (empty table) cannot be reliably tested in a shared dev environment without
// truncating the whole hypertable, so it is covered at the route unit test
// layer (mocked) in server/__tests__/routes/trends.test.ts.

describe.skipIf(!HAVE_TIMESCALE)('getTrendExtent — direct query', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean,
  } = await import('../helpers/trends-test-range.js');

  beforeEach(async () => { await resetTestRangeExpectClean(); });
  afterEach(async () => { await resetTestRange(); });
  afterAll(async () => { await resetTestRange(); });

  it('returns non-null bigints with oldestMs <= newestMs when table has samples', async () => {
    await writeTestSamples([
      { tagId: 8001, ts: 10_000_000n, value: 1.0 },
      { tagId: 8001, ts: 20_000_000n, value: 2.0 },
    ]);

    const result = await getTrendExtent();

    expect(result.oldestMs).not.toBeNull();
    expect(result.newestMs).not.toBeNull();
    // Type narrowing — both are bigint here.
    expect(typeof result.oldestMs).toBe('bigint');
    expect(typeof result.newestMs).toBe('bigint');
    expect(result.oldestMs!).toBeLessThanOrEqual(result.newestMs!);
    // Sanity: newestMs reflects real data — must be a plausible epoch-ms value
    // (at minimum the sandbox sample at 10_000_000 ms past epoch).
    expect(result.oldestMs!).toBeGreaterThan(0n);
  });
});

// ── dispatchShape — unit tests (no DB required) ───────────────────────────────
//
// At SAMPLE_RATE_HZ=10 and bucketCount=500, crossover is at tile window > 50 s
// (visible window > 100 s with 2 tiles). At exactly 50 s: expectedPoints = 500 =
// bucketCount → NOT strictly greater → raw (equality stays raw).

describe('dispatchShape — unit', () => {
  it('exports SAMPLE_RATE_HZ = 10', () => {
    expect(SAMPLE_RATE_HZ).toBe(10);
  });

  it('returns raw for 1 ms tile window', () => {
    expect(dispatchShape(0n, 1n, 500)).toBe('raw');
  });

  it('returns raw for 30 s tile window (1m preset per tile)', () => {
    expect(dispatchShape(0n, 30_000n, 500)).toBe('raw');
  });

  it('returns raw at the crossover boundary: 50 s, expectedPoints = bucketCount (not strictly greater)', () => {
    expect(dispatchShape(0n, 50_000n, 500)).toBe('raw');
  });

  it('returns bucketed just above crossover: 50.001 s', () => {
    expect(dispatchShape(0n, 50_001n, 500)).toBe('bucketed');
  });

  it('returns bucketed for 150 s tile window (5m preset per tile)', () => {
    expect(dispatchShape(0n, 150_000n, 500)).toBe('bucketed');
  });

  it('returns bucketed for 450 s tile window (15m preset per tile)', () => {
    expect(dispatchShape(0n, 450_000n, 500)).toBe('bucketed');
  });

  it('returns bucketed for 1800 s tile window (1h preset per tile)', () => {
    expect(dispatchShape(0n, 1_800_000n, 500)).toBe('bucketed');
  });

  it('crossover scales with bucketCount: at bucketCount=1000 crossover is at tile window > 100 s', () => {
    // expectedPoints = 100 * 10 = 1000 = bucketCount → raw (equality stays raw)
    expect(dispatchShape(0n, 100_000n, 1000)).toBe('raw');
    // 100.001 s → bucketed
    expect(dispatchShape(0n, 100_001n, 1000)).toBe('bucketed');
  });

  it('different startTime offsets do not affect the result (only span matters)', () => {
    const offset = 3_600_000n; // 1h
    // 150 s span at an arbitrary start → same as from 0
    expect(dispatchShape(offset, offset + 150_000n, 500)).toBe('bucketed');
    expect(dispatchShape(offset, offset + 30_000n,  500)).toBe('raw');
  });
});

// ── Raw-source bucketed branch (bucketS < 1.0 + expectedPoints > bucketCount) ─
//
// Window: startTime=3_600_000n (1h), endTime=3_750_000n (1h 2.5min), bucketCount=500
// tileWindow = 150_000 ms = 150 s → expectedPoints = 1500 > 500 → bucketed dispatch
// bucketS = 150_000 / (500 × 1000) = 0.3 < 1.0 → tag_samples source
// bucketSMs = Math.round(150_000 / 500) = 300 ms per bucket
//
// No CAG refresh required — this path reads tag_samples directly.
// Tag IDs 10001–10099 are reserved for this block.

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration: raw-source bucketed (bucketS=0.3, tile=150s)', async () => {
  const {
    writeTestSamples, resetTestRange, resetTestRangeExpectClean,
  } = await import('../helpers/trends-test-range.js');

  const START = 3_600_000n;   // 1h past epoch
  const END   = 3_750_000n;   // 150 s window
  const COUNT = 500;
  // bucketSMs = Math.round(150_000 / 500) = 300 ms

  beforeEach(async () => { await resetTestRangeExpectClean(); });
  afterEach(async ()  => { await resetTestRange(); });
  afterAll(async ()   => { await resetTestRange(); });

  it('returns AggregateTrendTile shape (not raw) for 5m-equivalent tile', async () => {
    await writeTestSamples([{ ts: START + 1_000n, tagId: 10001, value: 5.0 }]);
    const tile = await getTrendTile([10001], START, END, COUNT) as AggregateTrendTile;
    expect(tile.source).toBe('tag_samples');
    expect(tile.bucketSMs).toBe(300);
    expect(tile.series[0].value).toHaveLength(tile.n);
    expect(tile.series[0].min).toHaveLength(tile.n);
    expect(tile.series[0].max).toHaveLength(tile.n);
  });

  it('value/min/max arrays are populated (not raw COV ts arrays)', async () => {
    await writeTestSamples([
      { ts: START + 50n,  tagId: 10002, value: 10.0 },
      { ts: START + 100n, tagId: 10002, value: 20.0 },
    ]);
    const tile = await getTrendTile([10002], START, END, COUNT) as AggregateTrendTile;
    expect(Array.isArray(tile.series[0].value)).toBe(true);
    expect(Array.isArray(tile.series[0].min)).toBe(true);
    expect(Array.isArray(tile.series[0].max)).toBe(true);
    // Both values fall in the same 300ms bucket (START+0 to START+300ms, bucket 0)
    // last(value, ts) = 20.0, min = 10.0, max = 20.0
    expect(tile.series[0].value[0]).toBe(20.0);
    expect(tile.series[0].min[0]).toBe(10.0);
    expect(tile.series[0].max[0]).toBe(20.0);
  });

  it('LOCF fills empty buckets — flatline tag stays flat across all buckets', async () => {
    await writeTestSamples([{ ts: START + 50n, tagId: 10003, value: 42.0 }]);
    const tile = await getTrendTile([10003], START, END, COUNT) as AggregateTrendTile;
    const { value } = tile.series[0];
    expect(value[0]).toBe(42.0);
    expect(value[tile.n - 1]).toBe(42.0);
    expect(value.every(v => v === 42.0)).toBe(true);
  });

  it('null-as-gap: bucket with null sample emits null for value/min/max', async () => {
    const BUCKET_MS = 300n; // bucketSMs = 300
    await writeTestSamples([
      { ts: START + 100n,             tagId: 10004, value: 5.0  },
      { ts: START + BUCKET_MS * 10n,  tagId: 10004, value: null },
      { ts: START + BUCKET_MS * 20n,  tagId: 10004, value: 9.0  },
    ]);
    const tile = await getTrendTile([10004], START, END, COUNT) as AggregateTrendTile;
    const { value, min, max } = tile.series[0];
    expect(value[10]).toBeNull();
    expect(min[10]).toBeNull();
    expect(max[10]).toBeNull();
    expect(value[20]).toBe(9.0);
  });

  it('bounded-prev LOCF: value before first in-window sample uses prior sample', async () => {
    const priorTs = START - 60_000n; // 60s before window
    const inTs    = START + 90_000n; // 90s into window (bucket 300)
    await writeTestSamples([
      { ts: priorTs, tagId: 10005, value: 55.5 },
      { ts: inTs,    tagId: 10005, value: 99.0 },
    ]);
    const tile = await getTrendTile([10005], START, END, COUNT) as AggregateTrendTile;
    const { value } = tile.series[0];
    // Leading buckets before inTs should carry the prev value 55.5 via LOCF.
    expect(value[0]).toBe(55.5);
    // Bucket containing inTs and beyond should carry 99.0.
    expect(value[tile.n - 1]).toBe(99.0);
  });

  it('__test_lastUsedSources records tag_samples', async () => {
    __test_lastUsedSources.current = new Set();
    await writeTestSamples([{ ts: START + 1_000n, tagId: 10006, value: 1.0 }]);
    await getTrendTile([10006], START, END, COUNT);
    expect(__test_lastUsedSources.current.has('tag_samples')).toBe(true);
    expect(__test_lastUsedSources.current.size).toBe(1);
  });

  it('empty tag returns null×n arrays', async () => {
    const tile = await getTrendTile([10007], START, END, COUNT) as AggregateTrendTile;
    expect(tile.series[0].value.every(v => v === null)).toBe(true);
    expect(tile.series[0].min.every(m => m === null)).toBe(true);
    expect(tile.series[0].max.every(m => m === null)).toBe(true);
  });
});

// NOTE: The LOCF data-extent cutoff (MAX(ts) query + past-extent CASE wrapper) was removed
// for performance. It paid 814ms of planning time per CAG request on production-scale
// tag_samples (251 chunks × 8 tag_ids → catalog enumeration). LOCF now runs unbounded
// past MAX(ts) — trailing empty buckets carry the last known value forward. Dead-tag
// detection is deferred; see "Dead-tag detection" TODO in Docs/hmi_trend_viewer_handoff.md.

// ── Watermark memoization — unit tests (no DB required) ──────────────────────
//
// These tests spy on timescalePool.query to assert call counts without a real DB.
// Each test starts with a clean cache via __test_clearWatermarkCache() and restores
// the spy in afterEach. __test_watermarkOverride is kept null throughout so the
// production cache path is exercised.

describe('getWatermarkMs — memoization', () => {
  // Fake DB response: wm_us = "1700000000000000" → 1700000000000 ms
  const FAKE_WM_US = '1700000000000000';
  const FAKE_WM_MS = 1_700_000_000_000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let querySpy: any;

  beforeEach(() => {
    __test_watermarkOverride.current = null;
    __test_clearWatermarkCache();
    querySpy = vi.spyOn(timescalePool, 'query').mockResolvedValue({
      rows: [{ wm_us: FAKE_WM_US }],
      rowCount: 1, command: 'SELECT', oid: 0, fields: [],
    } as never);
  });

  afterEach(() => {
    querySpy.mockRestore();
    __test_clearWatermarkCache();
    __test_watermarkOverride.current = null;
  });

  // 1. Cache hit — second call must not issue a second DB query.
  it('cache hit: second call returns cached value without issuing a new DB query', async () => {
    const first  = await __test_getWatermarkMs('tag_samples_1s_cagg');
    const second = await __test_getWatermarkMs('tag_samples_1s_cagg');
    expect(first).toBe(FAKE_WM_MS);
    expect(second).toBe(FAKE_WM_MS);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  // 2. TTL expiry — call after 30s must re-issue the DB query.
  it('TTL expiry: call after 30s re-issues the DB query', async () => {
    vi.useFakeTimers();
    try {
      await __test_getWatermarkMs('tag_samples_1s_cagg');
      expect(querySpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_001);

      await __test_getWatermarkMs('tag_samples_1s_cagg');
      expect(querySpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // 3. In-flight dedup — two concurrent calls share one DB round-trip.
  it('in-flight dedup: two concurrent calls share one DB round-trip', async () => {
    let resolveQuery!: (v: unknown) => void;
    querySpy.mockImplementation(
      () => new Promise(resolve => { resolveQuery = resolve; }),
    );

    const p1 = __test_getWatermarkMs('tag_samples_1s_cagg');
    const p2 = __test_getWatermarkMs('tag_samples_1s_cagg');

    // Only one DB call should have been made so far (the second saw the in-flight promise).
    expect(querySpy).toHaveBeenCalledTimes(1);

    // Resolve the single DB promise.
    resolveQuery({ rows: [{ wm_us: FAKE_WM_US }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(FAKE_WM_MS);
    expect(r2).toBe(FAKE_WM_MS);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  // 4. Test override bypasses cache — DB is never called.
  it('test override bypasses cache: no DB query fires when override is set', async () => {
    __test_watermarkOverride.current = new Map([['tag_samples_1s_cagg', 999_999]]);
    const result = await __test_getWatermarkMs('tag_samples_1s_cagg');
    expect(result).toBe(999_999);
    expect(querySpy).not.toHaveBeenCalled();
  });

  // 5. __test_clearWatermarkCache clears state — next call re-issues the DB query.
  it('__test_clearWatermarkCache clears state: next call re-issues DB query', async () => {
    await __test_getWatermarkMs('tag_samples_1s_cagg');
    expect(querySpy).toHaveBeenCalledTimes(1);

    __test_clearWatermarkCache();

    await __test_getWatermarkMs('tag_samples_1s_cagg');
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
