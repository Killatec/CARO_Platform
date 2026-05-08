import { describe, it, expect } from 'vitest';
import { bandsFromTrendData } from '../../src/render/bandsFromTrendData.js';
import type { AggregateSeriesData, RawSeriesData } from '../../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAggregate(withBands = true): AggregateSeriesData {
  const series: AggregateSeriesData['series'] = new Map([
    [1, withBands
      ? { value: [10, 20, 30], min: [8, 18, 28], max: [12, 22, 32] }
      : { value: [10, 20, 30] }],
    [2, withBands
      ? { value: [1, 2, 3], min: [0.5, 1.5, 2.5], max: [1.5, 2.5, 3.5] }
      : { value: [1, 2, 3] }],
  ]);
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: 3_000n,
    n: 3,
    bucketSMs: 1000,
    series,
  };
}

function makeRaw(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 0n,
    endTime: 3_000n,
    series: new Map([
      [1, { ts: [0n, 1000n, 2000n], value: [1.0, 2.0, null] }],
      [2, { ts: [500n, 1500n],      value: [10.0, 20.0] }],
    ]),
  };
}

// ── Aggregate path ────────────────────────────────────────────────────────────

describe('bandsFromTrendData — aggregate', () => {
  it('returns BandArrays for aggregate data', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result).not.toBeNull();
  });

  it('xs are epoch-aligned bucket start times in seconds', () => {
    const result = bandsFromTrendData(makeAggregate(), [1]);
    // startTime=0ms, bucketSMs=1000ms → [0, 1, 2]
    expect(result.xs).toEqual([0, 1, 2]);
  });

  it('xs match seriesFromTrendData xs', () => {
    const data = makeAggregate();
    const bands = bandsFromTrendData(data, [1]);
    expect(bands.xs).toHaveLength(3);
    expect(bands.xs[0]).toBe(0);
    expect(bands.xs[2]).toBe(2);
  });

  it('mins and maxs have one array per tagId', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result.mins).toHaveLength(2);
    expect(result.maxs).toHaveLength(2);
  });

  it('mins[i] and maxs[i] are aligned with xs (length n)', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result.mins[0]).toHaveLength(3);
    expect(result.maxs[0]).toHaveLength(3);
  });

  it('min and max values are correct per tag', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result.mins[0]).toEqual([8, 18, 28]);
    expect(result.maxs[0]).toEqual([12, 22, 32]);
    expect(result.mins[1]).toEqual([0.5, 1.5, 2.5]);
    expect(result.maxs[1]).toEqual([1.5, 2.5, 3.5]);
  });

  it('null values in min/max are preserved', () => {
    const data: AggregateSeriesData = {
      type: 'aggregate',
      source: '1min_cagg',
      startTime: 0n,
      endTime: 3_000n,
      n: 3,
      bucketSMs: 1000,
      series: new Map([[1, { value: [1, null, 3], min: [0.5, null, 2.5], max: [1.5, null, 3.5] }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.mins[0]).toEqual([0.5, null, 2.5]);
    expect(result.maxs[0]).toEqual([1.5, null, 3.5]);
  });

  it('absent tagId produces null-filled arrays (not a crash)', () => {
    const result = bandsFromTrendData(makeAggregate(), [99]);
    expect(result.mins[0]).toEqual([null, null, null]);
    expect(result.maxs[0]).toEqual([null, null, null]);
  });

  it('v0.7 cache entry (no min/max) produces null-filled arrays', () => {
    const result = bandsFromTrendData(makeAggregate(false), [1, 2]);
    expect(result.mins[0]).toEqual([null, null, null]);
    expect(result.maxs[0]).toEqual([null, null, null]);
  });

  it('handles bigint startTime correctly', () => {
    const data = makeAggregate();
    const shifted: AggregateSeriesData = { ...data, startTime: 3_600_000n, bucketSMs: 1000 };
    const result = bandsFromTrendData(shifted, [1]);
    expect(result.xs[0]).toBeCloseTo(3600, 3);
  });

  it('aggregate: mins and maxs are independent arrays (not same reference)', () => {
    const result = bandsFromTrendData(makeAggregate(), [1]);
    // In aggregate mode, min and max are different data — should not share a reference.
    expect(result.mins[0]).not.toBe(result.maxs[0]);
  });
});

// ── Raw path ──────────────────────────────────────────────────────────────────

describe('bandsFromTrendData — raw', () => {
  it('returns BandArrays (not null) for raw data', () => {
    const result = bandsFromTrendData(makeRaw(), [1]);
    expect(result).toBeDefined();
    expect(Array.isArray(result.xs)).toBe(true);
  });

  it('xs are the sorted union of all tag ts arrays in seconds', () => {
    const result = bandsFromTrendData(makeRaw(), [1, 2]);
    // tag1 ts: 0, 1000, 2000 ms; tag2 ts: 500, 1500 ms → union sorted in seconds
    expect(result.xs).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('mins[i] === maxs[i] (same array reference — zero-area band)', () => {
    const result = bandsFromTrendData(makeRaw(), [1, 2]);
    expect(result.mins[0]).toBe(result.maxs[0]);
    expect(result.mins[1]).toBe(result.maxs[1]);
  });

  it('forward-fills tag values between change points', () => {
    const result = bandsFromTrendData(makeRaw(), [1, 2]);
    // Tag1: at 0→1.0, 500→hold(1.0), 1000→2.0, 1500→hold(2.0), 2000→null
    expect(result.mins[0]).toEqual([1.0, 1.0, 2.0, 2.0, null]);
    // Tag2: at 0→null(no prior), 500→10.0, 1000→hold(10.0), 1500→20.0, 2000→hold(20.0)
    expect(result.mins[1]).toEqual([null, 10.0, 10.0, 20.0, 20.0]);
  });

  it('absent tagId: xs is empty (raw xs comes only from requested tagIds)', () => {
    // Tag 99 is not in the series map, so no ts values are collected.
    // xs and per-tag arrays are empty — no crash.
    const result = bandsFromTrendData(makeRaw(), [99]);
    expect(result.xs).toHaveLength(0);
    expect(result.mins[0]).toHaveLength(0);
  });

  it('empty raw data returns empty xs/mins/maxs', () => {
    const empty: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 0n, series: new Map(),
    };
    const result = bandsFromTrendData(empty, [1]);
    expect(result.xs).toHaveLength(0);
    expect(result.mins[0]).toHaveLength(0);
    expect(result.maxs[0]).toHaveLength(0);
  });

  it('single tag: xs length equals number of ts entries', () => {
    const data: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 2_000n,
      series: new Map([[1, { ts: [0n, 1000n, 2000n], value: [1, 2, 3] }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.xs).toHaveLength(3);
    expect(result.mins[0]).toEqual([1, 2, 3]);
  });
});

// ── Raw path — bounded-prev seeding ───────────────────────────────────────────

describe('bandsFromTrendData — raw with bounded-prev', () => {
  it('prev.ts appears in xs and seeds forward-fill from the left edge', () => {
    // prev at -1000ms, one in-window sample at 1000ms.
    const data: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 2_000n,
      series: new Map([[1, { ts: [1000n], value: [99.0], prev: { ts: -1000n, value: 42.0 } }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.xs).toEqual([-1, 1]);
    expect(result.mins[0]).toEqual([42.0, 99.0]);
  });

  it('prev seeds the line when the viewport has no in-window samples (flatlined tag)', () => {
    const data: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 5_000n, endTime: 10_000n,
      series: new Map([[1, { ts: [], value: [], prev: { ts: 2_000n, value: 77.0 } }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.xs).toEqual([2]);
    expect(result.mins[0]).toEqual([77.0]);
  });

  it('prev null value seeds forward-fill as null (bad-quality sentinel)', () => {
    const data: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 2_000n,
      series: new Map([[1, { ts: [1000n], value: [5.0], prev: { ts: -500n, value: null } }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.xs).toEqual([-0.5, 1]);
    expect(result.mins[0]).toEqual([null, 5.0]);
  });

  it('without prev: tag with no in-window samples returns empty (existing behaviour preserved)', () => {
    const data: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 2_000n,
      series: new Map([[1, { ts: [], value: [] }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.xs).toHaveLength(0);
    expect(result.mins[0]).toHaveLength(0);
  });

  it('mins === maxs (zero-area band) still holds when prev is present', () => {
    const data: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 2_000n,
      series: new Map([[1, { ts: [1000n], value: [3.0], prev: { ts: -500n, value: 1.0 } }]]),
    };
    const result = bandsFromTrendData(data, [1]);
    expect(result.mins[0]).toBe(result.maxs[0]);
  });
});
