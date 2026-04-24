import { describe, it, expect, vi, beforeEach, afterEach, afterAll, type MockInstance } from 'vitest';
import timescalePool from '../timescale/pool.js';
import { getTrendTile, tileSpanFor, assembleAggregateSeries } from '../timescale/trends.js';
import type { RawTrendTile, AggregateTrendTile } from '../timescale/trends.js';

// Spy on pool.query so unit tests control responses without a top-level vi.mock.
let querySpy: MockInstance;

beforeEach(() => {
  querySpy = vi.spyOn(timescalePool, 'query');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tileSpanFor ───────────────────────────────────────────────────────────────

describe('tileSpanFor', () => {
  it('returns 3_600_000 for bucketS=0 (raw, 1 h)', () => {
    expect(tileSpanFor(0)).toBe(3_600_000);
  });

  it('returns 600_000 for bucketS=1 (10 min tile)', () => {
    expect(tileSpanFor(1)).toBe(600_000);
  });

  it('returns 6_000_000 for bucketS=10 (100 min tile)', () => {
    expect(tileSpanFor(10)).toBe(6_000_000);
  });

  it('returns 36_000_000 for bucketS=60 (10 h tile)', () => {
    expect(tileSpanFor(60)).toBe(36_000_000);
  });

  it('returns 360_000_000 for bucketS=600 (100 h tile)', () => {
    expect(tileSpanFor(600)).toBe(360_000_000);
  });

  it('throws INVALID_BUCKET_S for an unknown bucket size', () => {
    expect(() => tileSpanFor(500)).toThrow(
      expect.objectContaining({ code: 'INVALID_BUCKET_S' }),
    );
  });
});

// ── getTrendTile — validation ─────────────────────────────────────────────────

describe('getTrendTile — INVALID_TAG_IDS', () => {
  it('throws on empty tagIds array', async () => {
    await expect(getTrendTile([], 0, 0)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TAG_IDS' }),
    );
  });

  it('throws when a tagId is zero (non-positive)', async () => {
    await expect(getTrendTile([0], 0, 0)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TAG_IDS' }),
    );
  });

  it('throws when a tagId is negative', async () => {
    await expect(getTrendTile([-1], 0, 0)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TAG_IDS' }),
    );
  });

  it('throws when a tagId is a non-integer', async () => {
    await expect(getTrendTile([1.5], 0, 0)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TAG_IDS' }),
    );
  });
});

describe('getTrendTile — INVALID_TILE_INDEX', () => {
  it('throws on negative tileIndex', async () => {
    await expect(getTrendTile([1], 0, -1)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TILE_INDEX' }),
    );
  });

  it('throws on non-integer tileIndex', async () => {
    await expect(getTrendTile([1], 0, 1.5)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_TILE_INDEX' }),
    );
  });
});

describe('getTrendTile — INVALID_BUCKET_S', () => {
  it('throws on an arbitrary invalid bucket size', async () => {
    await expect(getTrendTile([1], 500, 0)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_BUCKET_S' }),
    );
  });
});

// ── getTrendTile — raw happy path (mocked pool) ───────────────────────────────

describe('getTrendTile — raw happy path (mocked pool)', () => {
  it('issues one query with correct params and returns a valid RawTrendTile', async () => {
    const tagIds    = [42, 87];
    const tileIndex = 3;
    const tileSpanMs = 3_600_000;
    const tsStart   = tileIndex * tileSpanMs; // 10_800_000

    querySpy.mockResolvedValueOnce({
      rows: [
        { tag_id: 42, ts_ms: BigInt(10_800_500), value: 1.5 },
        { tag_id: 42, ts_ms: BigInt(10_801_000), value: null },
        { tag_id: 87, ts_ms: BigInt(10_800_750), value: 99.0 },
      ],
    });

    const tile = await getTrendTile(tagIds, 0, tileIndex) as RawTrendTile;

    // SQL and params
    const [sql, params] = querySpy.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM tag_samples/);
    expect(params[0]).toEqual(tagIds);
    expect(params[1]).toBe(tsStart);
    expect(params[2]).toBe(tsStart + tileSpanMs);

    // Shape
    expect(tile.bucketS).toBe(0);
    expect(tile.tileIndex).toBe(tileIndex);
    expect(tile.tileSpanMs).toBe(tileSpanMs);
    expect(tile.series).toHaveLength(2);

    // Tag 42
    expect(tile.series[0].tagId).toBe(42);
    expect(tile.series[0].ts).toEqual([10_800_500, 10_801_000]);
    expect(tile.series[0].value).toEqual([1.5, null]);

    // Tag 87
    expect(tile.series[1].tagId).toBe(87);
    expect(tile.series[1].ts).toEqual([10_800_750]);
    expect(tile.series[1].value).toEqual([99.0]);
  });

  it('returns empty series entries for tags with no rows in the tile', async () => {
    querySpy.mockResolvedValueOnce({ rows: [] });

    const tile = await getTrendTile([1, 2], 0, 0) as RawTrendTile;

    expect(tile.series).toHaveLength(2);
    expect(tile.series[0]).toEqual({ tagId: 1, ts: [], value: [] });
    expect(tile.series[1]).toEqual({ tagId: 2, ts: [], value: [] });
  });

  it('preserves request order of tagIds in the series array', async () => {
    querySpy.mockResolvedValueOnce({
      rows: [
        { tag_id: 10, ts_ms: BigInt(1000), value: 0.1 },
        { tag_id: 20, ts_ms: BigInt(2000), value: 0.2 },
      ],
    });

    const tile = await getTrendTile([20, 10], 0, 0) as RawTrendTile;

    // Requested order: [20, 10] — series must match
    expect(tile.series[0].tagId).toBe(20);
    expect(tile.series[1].tagId).toBe(10);
  });
});

// ── getTrendTile — aggregate path (mocked pool) ───────────────────────────────

describe('getTrendTile — aggregate: fires two queries', () => {
  it('issues seed query then bucket-last query with correct params', async () => {
    // tile 0, bucketS=1: tsStart=0, tsEnd=600_000, 600 buckets
    querySpy
      .mockResolvedValueOnce({ rows: [{ tag_id: 1, prev: null }, { tag_id: 2, prev: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await getTrendTile([1, 2], 1, 0);

    expect(querySpy.mock.calls).toHaveLength(2);

    const [sql1, params1] = querySpy.mock.calls[0] as [string, unknown[]];
    const [sql2, params2] = querySpy.mock.calls[1] as [string, unknown[]];

    // Query 1 — seed: per-tag last sample before tile start
    expect(sql1).toMatch(/SELECT value FROM tag_samples/);
    expect(params1[0]).toEqual([1, 2]);
    expect(params1[1]).toBe(0n); // BigInt(tsStart=0)

    // Query 2 — bucket-last: time_bucket + last(value, ts); $4 is bucketS in seconds
    expect(sql2).toMatch(/time_bucket/);
    expect(sql2).toMatch(/last\(value, ts\)/);
    expect(sql2).toMatch(/make_interval\(secs => \$4::double precision\)/);
    expect(params2[0]).toEqual([1, 2]);
    expect(params2[1]).toBe(0n);       // BigInt(tsStart)
    expect(params2[2]).toBe(600_000n); // BigInt(tsEnd)
    expect(params2[3]).toBe(1);        // bucketS in seconds
  });
});

describe('getTrendTile — aggregate: series shape invariants (mocked pool)', () => {
  it('preserves request order when seed rows arrive in a different order', async () => {
    querySpy
      .mockResolvedValueOnce({ rows: [{ tag_id: 2, prev: 5 }, { tag_id: 1, prev: 7 }] })
      .mockResolvedValueOnce({ rows: [] });

    const tile = await getTrendTile([1, 2], 1, 0) as AggregateTrendTile;

    expect(tile.series[0].tagId).toBe(1);
    expect(tile.series[0].value).toHaveLength(600);
    expect(tile.series[0].value.every(v => v === 7)).toBe(true);

    expect(tile.series[1].tagId).toBe(2);
    expect(tile.series[1].value.every(v => v === 5)).toBe(true);
  });

  it('null seed produces an all-null series', async () => {
    querySpy
      .mockResolvedValueOnce({ rows: [{ tag_id: 1, prev: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const tile = await getTrendTile([1], 1, 0) as AggregateTrendTile;

    expect(tile.series[0].value).toHaveLength(600);
    expect(tile.series[0].value.every(v => v === null)).toBe(true);
  });

  it('missing seed row (tag absent from seed result) produces all-null series', async () => {
    // Should not happen with the CTE unnest, but the code must be belt-and-suspenders.
    querySpy
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const tile = await getTrendTile([1], 1, 0) as AggregateTrendTile;

    expect(tile.series[0].value).toHaveLength(600);
    expect(tile.series[0].value.every(v => v === null)).toBe(true);
  });

  it('carries a real seed across entire tile when no in-tile samples exist', async () => {
    querySpy
      .mockResolvedValueOnce({ rows: [{ tag_id: 1, prev: 42.5 }] })
      .mockResolvedValueOnce({ rows: [] });

    const tile = await getTrendTile([1], 1, 0) as AggregateTrendTile;

    expect(tile.series[0].value).toHaveLength(600);
    expect(tile.series[0].value.every(v => v === 42.5)).toBe(true);
  });

  it('LOCF: carries the last value forward across empty buckets, including a null carry', async () => {
    // tileIndex=0, bucketS=1: bucket i starts at ms i*1000
    // rows at bucket 0 (0ms)=20, bucket 2 (2000ms)=null, bucket 4 (4000ms)=30
    // seed=10; but bucket 0 has a value so seed is immediately replaced
    querySpy
      .mockResolvedValueOnce({ rows: [{ tag_id: 1, prev: 10 }] })
      .mockResolvedValueOnce({
        rows: [
          { tag_id: 1, bucket_ms: 0n,    last_val: 20   },
          { tag_id: 1, bucket_ms: 2000n,  last_val: null },
          { tag_id: 1, bucket_ms: 4000n,  last_val: 30   },
        ],
      });

    const tile = await getTrendTile([1], 1, 0) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    expect(value[0]).toBe(20);       // bucket 0: new value 20
    expect(value[1]).toBe(20);       // bucket 1: LOCF carry
    expect(value[2]).toBeNull();     // bucket 2: new null value
    expect(value[3]).toBeNull();     // bucket 3: LOCF null carry
    expect(value[4]).toBe(30);       // bucket 4: new value 30
    expect(value[5]).toBe(30);       // bucket 5: LOCF carry
    expect(value[599]).toBe(30);     // last bucket: still 30
  });

  it('returns correct AggregateTrendTile metadata', async () => {
    querySpy
      .mockResolvedValueOnce({ rows: [{ tag_id: 1, prev: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const tile = await getTrendTile([1], 10, 2) as AggregateTrendTile;

    // tileSpanMs for bucketS=10 is 6_000_000; tile 2 starts at 12_000_000
    expect(tile.bucketS).toBe(10);
    expect(tile.tileIndex).toBe(2);
    expect(tile.tileSpanMs).toBe(6_000_000);
    expect(tile.tsStart).toBe(12_000_000);
    expect(tile.n).toBe(600);
    expect(tile.series).toHaveLength(1);
  });
});

// ── assembleAggregateSeries — pure-function unit tests ────────────────────────

describe('assembleAggregateSeries — pure function', () => {
  const BMS = 1; // 1 s bucket (bucketS unit)
  const COUNT = 10;  // small count for readability

  function seeds(...pairs: [number, number | null][]): Map<number, number | null> {
    return new Map(pairs);
  }

  function rows(tagId: number, ...entries: [number, number | null][]): Map<number, Array<{ bucketMs: bigint; lastVal: number | null }>> {
    return new Map([
      [tagId, entries.map(([bms, v]) => ({ bucketMs: BigInt(bms), lastVal: v }))],
    ]);
  }

  it('all-null when no seed and no rows', () => {
    const result = assembleAggregateSeries([1], new Map(), new Map(), 0, BMS, COUNT);
    expect(result[0].value).toEqual(new Array(COUNT).fill(null));
  });

  it('carries seed when no rows', () => {
    const result = assembleAggregateSeries([1], seeds([1, 7.5]), new Map(), 0, BMS, COUNT);
    expect(result[0].value).toEqual(new Array(COUNT).fill(7.5));
  });

  it('null seed carried as null', () => {
    const result = assembleAggregateSeries([1], seeds([1, null]), new Map(), 0, BMS, COUNT);
    expect(result[0].value).toEqual(new Array(COUNT).fill(null));
  });

  it('row at bucket 0 replaces seed immediately', () => {
    const result = assembleAggregateSeries([1], seeds([1, 99]), rows(1, [0, 5]), 0, BMS, COUNT);
    expect(result[0].value[0]).toBe(5);
    expect(result[0].value.slice(1).every(v => v === 5)).toBe(true);
  });

  it('LOCF across multiple samples', () => {
    // bucketS=1: bucket i is at ms i*1000.
    // rows at ms 0=10, ms 2000=20, ms 4000=null; seed=0 (replaced immediately by bucket 0 row)
    const r = rows(1, [0, 10], [2000, 20], [4000, null]);
    const result = assembleAggregateSeries([1], seeds([1, 0]), r, 0, BMS, COUNT);
    const v = result[0].value;
    expect(v[0]).toBe(10);
    expect(v[1]).toBe(10);
    expect(v[2]).toBe(20);
    expect(v[3]).toBe(20);
    expect(v[4]).toBeNull();
    expect(v[5]).toBeNull();
    expect(v[COUNT - 1]).toBeNull();
  });

  it('preserves tagIds request order and per-tag isolation', () => {
    const s = seeds([1, 100], [2, 200]);
    const result = assembleAggregateSeries([2, 1], s, new Map(), 0, BMS, COUNT);
    expect(result[0].tagId).toBe(2);
    expect(result[0].value[0]).toBe(200);
    expect(result[1].tagId).toBe(1);
    expect(result[1].value[0]).toBe(100);
  });

  it('output length equals bucketCount regardless of row count', () => {
    const r = rows(1, [0, 1], [3000, 2], [7000, 3]);
    const result = assembleAggregateSeries([1], seeds([1, null]), r, 0, BMS, COUNT);
    expect(result[0].value).toHaveLength(COUNT);
    expect(result[0].value.every(v => v !== undefined)).toBe(true);
  });

  it('non-zero tileStartMs: bucket alignment uses tileStartMs + i*bucketS*1000', () => {
    // tileStartMs=5000, bucketS=1: bucket 0 = 5000ms, bucket 1 = 6000ms, bucket 2 = 7000ms
    const r = new Map([
      [1, [{ bucketMs: 6000n, lastVal: 42 }]],
    ]);
    const result = assembleAggregateSeries([1], seeds([1, 7]), r, 5000, BMS, 3);
    // bucket 0 (5000ms): no row → carry=7
    // bucket 1 (6000ms): row → carry=42
    // bucket 2 (7000ms): no row → carry=42
    expect(result[0].value).toEqual([7, 42, 42]);
  });
});

// ── Integration tests — live TimescaleDB ─────────────────────────────────────

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

// Shared teardown: end the Timescale pool once after all integration tests complete.
if (HAVE_TIMESCALE) {
  afterAll(async () => {
    const { timescalePool: tsPool } = await import('./helpers/trends-test-range.js');
    await tsPool.end();
  });
}

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration raw (live TimescaleDB)', async () => {
  const {
    writeTestSamples,
    resetTestRange,
    TEST_RANGE_START,
  } = await import('./helpers/trends-test-range.js');

  const RAW_TILE_SPAN = 3_600_000; // 1 h

  beforeEach(async () => {
    await resetTestRange();
  });

  afterAll(async () => {
    await resetTestRange();
  });

  it('round-trip: written samples appear in the correct tile with correct shape', async () => {
    const tileIndex = 0;
    const base = TEST_RANGE_START; // 0

    await writeTestSamples([
      { ts: base + 1_000, tagId: 101, value: 10.5 },
      { ts: base + 2_000, tagId: 101, value: 11.0 },
      { ts: base + 1_500, tagId: 202, value: 42.0 },
    ]);

    const tile = await getTrendTile([101, 202], 0, tileIndex) as RawTrendTile;

    expect(tile.bucketS).toBe(0);
    expect(tile.tileIndex).toBe(tileIndex);
    expect(tile.tileSpanMs).toBe(RAW_TILE_SPAN);
    expect(tile.series).toHaveLength(2);

    const s101 = tile.series[0];
    expect(s101.tagId).toBe(101);
    expect(s101.ts).toHaveLength(2);
    expect(s101.value).toEqual([10.5, 11.0]);

    const s202 = tile.series[1];
    expect(s202.tagId).toBe(202);
    expect(s202.ts).toHaveLength(1);
    expect(s202.value).toEqual([42.0]);
  });

  it('null pass-through: a written null appears as null in the value array', async () => {
    await writeTestSamples([
      { ts: TEST_RANGE_START + 100, tagId: 303, value: 5.0 },
      { ts: TEST_RANGE_START + 200, tagId: 303, value: null },
      { ts: TEST_RANGE_START + 300, tagId: 303, value: 6.0 },
    ]);

    const tile = await getTrendTile([303], 0, 0) as RawTrendTile;
    const s = tile.series[0];

    expect(s.value).toHaveLength(3);
    expect(s.value[1]).toBeNull();
  });

  it('tile isolation: only rows inside the queried tile are returned', async () => {
    const tile0ts = TEST_RANGE_START + 1_000;
    const tile1ts = RAW_TILE_SPAN + 1_000;

    await writeTestSamples([
      { ts: tile0ts, tagId: 404, value: 1.0 },
      { ts: tile1ts, tagId: 404, value: 2.0 },
    ]);

    const tile = await getTrendTile([404], 0, 0) as RawTrendTile;
    const s = tile.series[0];

    expect(s.ts).toHaveLength(1);
    expect(s.value).toEqual([1.0]);
  });

  it('empty tag: a tagId with no samples returns an empty series entry', async () => {
    await writeTestSamples([
      { ts: TEST_RANGE_START + 500, tagId: 505, value: 7.0 },
    ]);

    const tile = await getTrendTile([505, 606], 0, 0) as RawTrendTile;

    expect(tile.series).toHaveLength(2);
    expect(tile.series[1].tagId).toBe(606);
    expect(tile.series[1].ts).toEqual([]);
    expect(tile.series[1].value).toEqual([]);
  });
});

describe.skipIf(!HAVE_TIMESCALE)('getTrendTile — integration aggregate (live TimescaleDB)', async () => {
  const {
    writeTestSamples,
    resetTestRange,
    TEST_RANGE_START,
  } = await import('./helpers/trends-test-range.js');

  // Use tile 1 so TILE_START=600_000ms, giving room to write pre-tile seeds at ≥ 0ms.
  // TEST_RANGE_START=0; tile 1 → [600_000ms, 1_200_000ms), entirely in the sandbox.
  const BUCKET_S   = 1;        // 1 s buckets
  const TILE_SPAN  = 600_000;  // ms (tileSpanFor(1) = 600_000)
  const TILE_INDEX = 1;
  const TILE_START = TILE_INDEX * TILE_SPAN; // 600_000 ms

  beforeEach(async () => {
    await resetTestRange();
  });

  afterAll(async () => {
    await resetTestRange();
  });

  it('sparse COV + LOCF: sample mid-tile carries forward', async () => {
    // Write one sample at bucket 300 (300_000ms into the tile)
    await writeTestSamples([
      { ts: TILE_START + 300_000, tagId: 9001, value: 42.5 },
    ]);

    const tile = await getTrendTile([9001], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    // No prior history → seed=null → buckets 0..299 are null
    expect(value.slice(0, 300).every(v => v === null)).toBe(true);
    // Bucket 300 gets the sample; buckets 300..599 carry it forward
    expect(value.slice(300).every(v => v === 42.5)).toBe(true);
  });

  it('real seed carries across an empty tile', async () => {
    // Write one sample BEFORE the tile window (1 s before tile start)
    await writeTestSamples([
      { ts: TILE_START - 1_000, tagId: 9002, value: 77 },
    ]);

    const tile = await getTrendTile([9002], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    expect(value.every(v => v === 77)).toBe(true);
  });

  it('null seed carries across an empty tile', async () => {
    await writeTestSamples([
      { ts: TILE_START - 1_000, tagId: 9003, value: null },
    ]);

    const tile = await getTrendTile([9003], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    expect(value.every(v => v === null)).toBe(true);
  });

  it('no history at all: values are all null (unified edge-case rule)', async () => {
    const tile = await getTrendTile([9004], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    expect(value.every(v => v === null)).toBe(true);
  });

  it('null inside tile carries forward; non-null after null replaces the carry', async () => {
    // bucket 1 (1000ms into tile)=5, bucket 2 (2000ms)=null, bucket 5 (5000ms)=8
    // No prior history → seed=null → bucket 0=null
    await writeTestSamples([
      { ts: TILE_START + 1_000, tagId: 9005, value: 5   },
      { ts: TILE_START + 2_000, tagId: 9005, value: null },
      { ts: TILE_START + 5_000, tagId: 9005, value: 8   },
    ]);

    const tile = await getTrendTile([9005], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    expect(value[0]).toBeNull();      // no seed, no row at bucket 0
    expect(value[1]).toBe(5);         // bucket 1: sample
    expect(value[2]).toBeNull();      // bucket 2: null sample
    expect(value[3]).toBeNull();      // LOCF null carry
    expect(value[4]).toBeNull();      // LOCF null carry
    expect(value[5]).toBe(8);         // bucket 5: new sample
    expect(value[599]).toBe(8);       // last bucket: still 8
  });

  it('tile isolation: samples outside the queried tile window do not appear as in-tile data', async () => {
    // Write a seed BEFORE the tile (→ captured by seed query), one IN the tile (→ bucket 0),
    // and one AFTER the tile (→ must not appear in the result).
    const beforeTile = TILE_START - 100;             // seed: last sample before tile
    const inTile     = TILE_START + 100;             // lands in bucket 0 (time_bucket truncates to TILE_START)
    const afterTile  = TILE_START + TILE_SPAN + 100; // tile N+1: must not appear

    await writeTestSamples([
      { ts: beforeTile, tagId: 9006, value: 11 },
      { ts: inTile,     tagId: 9006, value: 22 },
      { ts: afterTile,  tagId: 9006, value: 33 },
    ]);

    const tile = await getTrendTile([9006], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    // Bucket 0 gets value=22 (seed=11 is superseded); tile N+1 sample must not bleed in.
    expect(value[0]).toBe(22);
    expect(value[599]).toBe(22);
  });

  it('multi-tag: per-tag LOCF independence and series length invariant', async () => {
    // Tag 9007: has a seed before the tile; tag 9008: has no history
    await writeTestSamples([
      { ts: TILE_START - 500, tagId: 9007, value: 55 },
      { ts: TILE_START + 200_000, tagId: 9008, value: 99 },
    ]);

    const tile = await getTrendTile([9007, 9008], BUCKET_S, TILE_INDEX) as AggregateTrendTile;

    expect(tile.series).toHaveLength(2);

    // Tag 9007: seed=55, no in-tile samples → all 55
    expect(tile.series[0].tagId).toBe(9007);
    expect(tile.series[0].value).toHaveLength(600);
    expect(tile.series[0].value.every(v => v === 55)).toBe(true);

    // Tag 9008: no seed, sample at bucket 200 → nulls then 99
    expect(tile.series[1].tagId).toBe(9008);
    expect(tile.series[1].value).toHaveLength(600);
    expect(tile.series[1].value[199]).toBeNull();
    expect(tile.series[1].value[200]).toBe(99);
    expect(tile.series[1].value[599]).toBe(99);
  });

  it('length invariant holds for a random spread of 50 samples', async () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({
      ts: TILE_START + i * 11_000, // spread across the tile (50 × 11 s < 600 s)
      tagId: 9009,
      value: i % 5 === 0 ? null : i * 1.1,
    }));

    await writeTestSamples(samples);

    const tile = await getTrendTile([9009], BUCKET_S, TILE_INDEX) as AggregateTrendTile;
    const { value } = tile.series[0];

    expect(value).toHaveLength(600);
    expect(value.every(v => v !== undefined)).toBe(true);
  });
});
