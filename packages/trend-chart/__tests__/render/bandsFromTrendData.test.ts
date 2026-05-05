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
      [1, { ts: [0n, 1000n], value: [1.0, 2.0] }],
    ]),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bandsFromTrendData', () => {
  it('returns null for raw data', () => {
    expect(bandsFromTrendData(makeRaw(), [1])).toBeNull();
  });

  it('returns BandArrays for aggregate data', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result).not.toBeNull();
  });

  it('xs are epoch-aligned bucket start times in seconds', () => {
    const result = bandsFromTrendData(makeAggregate(), [1]);
    // startTime=0ms, bucketSMs=1000ms → [0, 1, 2]
    expect(result!.xs).toEqual([0, 1, 2]);
  });

  it('xs match seriesFromTrendData xs', () => {
    const data = makeAggregate();
    const bands = bandsFromTrendData(data, [1]);
    // Same formula as seriesFromTrendData
    expect(bands!.xs).toHaveLength(3);
    expect(bands!.xs[0]).toBe(0);
    expect(bands!.xs[2]).toBe(2);
  });

  it('mins and maxs have one array per tagId', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result!.mins).toHaveLength(2);
    expect(result!.maxs).toHaveLength(2);
  });

  it('mins[i] and maxs[i] are aligned with xs (length n)', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result!.mins[0]).toHaveLength(3);
    expect(result!.maxs[0]).toHaveLength(3);
  });

  it('min and max values are correct per tag', () => {
    const result = bandsFromTrendData(makeAggregate(), [1, 2]);
    expect(result!.mins[0]).toEqual([8, 18, 28]);
    expect(result!.maxs[0]).toEqual([12, 22, 32]);
    expect(result!.mins[1]).toEqual([0.5, 1.5, 2.5]);
    expect(result!.maxs[1]).toEqual([1.5, 2.5, 3.5]);
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
    expect(result!.mins[0]).toEqual([0.5, null, 2.5]);
    expect(result!.maxs[0]).toEqual([1.5, null, 3.5]);
  });

  it('absent tagId produces null-filled arrays (not a crash)', () => {
    const result = bandsFromTrendData(makeAggregate(), [99]);
    expect(result!.mins[0]).toEqual([null, null, null]);
    expect(result!.maxs[0]).toEqual([null, null, null]);
  });

  it('v0.7 cache entry (no min/max) produces null-filled arrays', () => {
    const result = bandsFromTrendData(makeAggregate(false), [1, 2]);
    expect(result!.mins[0]).toEqual([null, null, null]);
    expect(result!.maxs[0]).toEqual([null, null, null]);
  });

  it('handles bigint startTime correctly', () => {
    const data = makeAggregate();
    const shifted: AggregateSeriesData = { ...data, startTime: 3_600_000n, bucketSMs: 1000 };
    const result = bandsFromTrendData(shifted, [1]);
    expect(result!.xs[0]).toBeCloseTo(3600, 3);
  });
});
