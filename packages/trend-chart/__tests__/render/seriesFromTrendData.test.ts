import { describe, it, expect } from 'vitest';
import { seriesFromTrendData } from '../../src/render/seriesFromTrendData.js';
import type { AggregateSeriesData, RawSeriesData } from '../../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAggregate(overrides?: Partial<AggregateSeriesData>): AggregateSeriesData {
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: 3_000n,
    n: 3,
    bucketSMs: 1000,
    series: new Map([
      [1, { value: [10, 20, 30] }],
      [2, { value: [null, 5, null] }],
    ]),
    ...overrides,
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
      [2, { ts: [500n, 1500n], value: [10.0, 20.0] }],
    ]),
  };
}

// ── Aggregate path ─────────────────────────────────────────────────────────────

describe('seriesFromTrendData — aggregate', () => {
  it('produces xs in seconds from startTime and bucketSMs', () => {
    const { xs } = seriesFromTrendData(makeAggregate(), [1, 2]);
    // startTime=0ms, bucketSMs=1000ms → bucketS=1s; xs=[0, 1, 2]
    expect(xs).toEqual([0, 1, 2]);
  });

  it('produces one ys array per tagId', () => {
    const { ys } = seriesFromTrendData(makeAggregate(), [1, 2]);
    expect(ys).toHaveLength(2);
  });

  it('preserves null values in ys', () => {
    const { ys } = seriesFromTrendData(makeAggregate(), [1, 2]);
    expect(ys[1]).toEqual([null, 5, null]);
  });

  it('fills absent tagId ys with nulls', () => {
    const { ys } = seriesFromTrendData(makeAggregate(), [99]);
    expect(ys[0]).toEqual([null, null, null]);
  });

  it('handles bigint startTime correctly', () => {
    const data = makeAggregate({ startTime: 3_600_000n, bucketSMs: 1000 });
    const { xs } = seriesFromTrendData(data, [1]);
    expect(xs[0]).toBeCloseTo(3600, 3);
  });
});

// ── Raw path ──────────────────────────────────────────────────────────────────

describe('seriesFromTrendData — raw', () => {
  it('produces xs from the union of all tag ts arrays', () => {
    const { xs } = seriesFromTrendData(makeRaw(), [1, 2]);
    // tag1 ts: 0, 1000, 2000 ms; tag2 ts: 500, 1500 ms → union sorted
    expect(xs).toEqual([0, 0.5, 1, 1.5, 2]); // in seconds
  });

  it('forward-fills tag values between change points', () => {
    const { ys } = seriesFromTrendData(makeRaw(), [1, 2]);
    // Tag1: at 0→1.0, 500→1.0(hold), 1000→2.0, 1500→2.0(hold), 2000→null
    expect(ys[0]).toEqual([1.0, 1.0, 2.0, 2.0, null]);
    // Tag2: at 0→null(no prior), 500→10.0, 1000→10.0(hold), 1500→20.0, 2000→20.0(hold)
    expect(ys[1]).toEqual([null, 10.0, 10.0, 20.0, 20.0]);
  });

  it('returns empty arrays when no series data', () => {
    const empty: RawSeriesData = {
      type: 'raw', source: 'raw', startTime: 0n, endTime: 0n, series: new Map(),
    };
    const { xs, ys } = seriesFromTrendData(empty, [1]);
    expect(xs).toHaveLength(0);
    expect(ys[0]).toHaveLength(0);
  });
});
