import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mergeTrendData } from '../src/mergeTrendData.js';
import type { AggregateSeriesData, RawSeriesData } from '../src/types.js';
import type { AggregateTail, RawTail } from '../src/useLiveSubscription.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BUCKET_SMS = 1000; // 1 s per bucket for easy arithmetic

function makeAgg(
  n: number,
  tagValues: Map<number, (number | null)[]>,
  startTime = 0n,
): AggregateSeriesData {
  const series = new Map<number, { value: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>();
  for (const [tagId, vals] of tagValues) {
    series.set(tagId, {
      value: vals,
      min: vals.map(v => v !== null ? v - 0.5 : null),
      max: vals.map(v => v !== null ? v + 0.5 : null),
    });
  }
  return {
    type: 'aggregate',
    source: '1s_cagg',
    startTime,
    endTime: startTime + BigInt(n) * BigInt(BUCKET_SMS),
    n,
    bucketSMs: BUCKET_SMS,
    series,
  };
}

function makeRaw(
  tagEntries: Map<number, { ts: bigint[]; value: (number | null)[] }>,
  startTime = 0n,
  endTime = 10_000n,
): RawSeriesData {
  const series = new Map<number, { ts: bigint[]; value: (number | null)[] }>();
  for (const [tagId, entry] of tagEntries) {
    series.set(tagId, entry);
  }
  return { type: 'raw', source: 'raw', startTime, endTime, series };
}

function makeAggTail(
  startMs: bigint,
  tagValues: Map<number, (number | null)[]>,
  bucketSMs = BigInt(BUCKET_SMS),
): AggregateTail {
  const perTag = new Map<number, { value: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>();
  for (const [tagId, vals] of tagValues) {
    perTag.set(tagId, {
      value: vals,
      min: vals.map(v => v !== null ? v - 0.1 : null),
      max: vals.map(v => v !== null ? v + 0.1 : null),
    });
  }
  return { mode: 'aggregate', startMs, bucketSMs, perTag };
}

function makeRawTail(
  tagEntries: Map<number, { ts: bigint[]; value: (number | null)[] }>,
): RawTail {
  const perTag = new Map<number, { ts: bigint[]; value: (number | null)[] }>();
  for (const [tagId, entry] of tagEntries) {
    perTag.set(tagId, entry);
  }
  return { mode: 'raw', perTag };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mergeTrendData — null cases', () => {
  it('cached null → returns null', () => {
    const tail = makeAggTail(0n, new Map([[1, [5]]]));
    expect(mergeTrendData(null, tail)).toBeNull();
  });

  it('live null → returns cached unchanged (same reference)', () => {
    const cached = makeAgg(3, new Map([[1, [1, 2, 3]]]));
    const result = mergeTrendData(cached, null);
    expect(result).toBe(cached);
  });
});

describe('mergeTrendData — aggregate happy path', () => {
  it('live extends cached: merged length = liveStartIndex + liveN', () => {
    // cached: buckets 0–2 (n=3, startTime=0n, bucketSMs=1000)
    // live: starts at bucket 3 (startMs=3000n), 2 buckets
    const cached = makeAgg(3, new Map([[1, [10, 20, 30]]]));
    const tail   = makeAggTail(3000n, new Map([[1, [40, 50]]]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    expect(result.n).toBe(5);
    expect(result.endTime).toBe(5000n);
    const s = result.series.get(1)!;
    expect(s.value).toEqual([10, 20, 30, 40, 50]);
  });

  it('live wins in overlap region (live overrides last cached buckets)', () => {
    // cached: buckets 0–4 (n=5)
    // live: starts at bucket 3 (liveStartIndex=3), 3 buckets → overlaps 3,4 and extends to 5
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail   = makeAggTail(3000n, new Map([[1, [99, 88, 77]]]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    expect(result.n).toBe(6);
    const s = result.series.get(1)!;
    // indices 0,1,2 from cached; 3,4,5 from live
    expect(s.value).toEqual([1, 2, 3, 99, 88, 77]);
  });

  it('gap region: cached last value LOCFs through gap between cached.n and liveStartIndex', () => {
    // cached: buckets 0–2 (n=3, last value=30)
    // live: starts at bucket 5 (liveStartIndex=5), 2 buckets
    // gap = buckets 3,4 → LOCF from cached.value[2]=30
    const cached = makeAgg(3, new Map([[1, [10, 20, 30]]]));
    const tail   = makeAggTail(5000n, new Map([[1, [40, 50]]]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    expect(result.n).toBe(7);
    const s = result.series.get(1)!;
    // 0,1,2 from cached; 3,4 gap LOCF=30; 5,6 from live
    expect(s.value).toEqual([10, 20, 30, 30, 30, 40, 50]);
  });

  it('per-tag missing from cached: present in live only → null-filled prefix', () => {
    // cached has tag 1 only; live has tags 1 and 2
    const cached = makeAgg(3, new Map([[1, [1, 2, 3]]]));
    const tail   = makeAggTail(3000n, new Map([
      [1, [4, 5]],
      [2, [10, 20]],
    ]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    const s1 = result.series.get(1)!;
    const s2 = result.series.get(2)!;
    // tag 1: 1,2,3 (cached) then 4,5 (live)
    expect(s1.value).toEqual([1, 2, 3, 4, 5]);
    // tag 2: null,null,null (no cached) then 10,20 (live)
    expect(s2.value).toEqual([null, null, null, 10, 20]);
  });

  it('min/max from live override cached overlap correctly', () => {
    const cached = makeAgg(2, new Map([[1, [10, 20]]]));
    const tail   = makeAggTail(1000n, new Map([[1, [99]]]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    const s = result.series.get(1)!;
    // bucket 0 from cached; bucket 1 from live
    expect(s.value[0]).toBe(10);
    expect(s.value[1]).toBe(99);
    expect(s.min[1]).toBeCloseTo(98.9);
    expect(s.max[1]).toBeCloseTo(99.1);
  });
});

describe('mergeTrendData — raw happy path (fixed mode)', () => {
  it('live entries concatenated after cached entries', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n], value: [1, 2] }]]),
      0n, 200n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n], value: [3, 4] }]]));

    const result = mergeTrendData(cached, tail, false) as RawSeriesData;
    const s = result.series.get(1)!;
    expect(s.ts).toEqual([100n, 200n, 300n, 400n]);
    expect(s.value).toEqual([1, 2, 3, 4]);
  });

  it('live entries with ts ≤ max(cached.ts) are deduped', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 300n], value: [1, 3] }]]),
      0n, 300n,
    );
    // live has 300n (overlap) and 400n (new)
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n], value: [3, 4] }]]));

    const result = mergeTrendData(cached, tail, false) as RawSeriesData;
    const s = result.series.get(1)!;
    // 300n is deduped (≤ max cached ts=300n); only 400n appended
    expect(s.ts).toEqual([100n, 300n, 400n]);
    expect(s.value).toEqual([1, 3, 4]);
  });

  it('endTime advances to last merged ts', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n], value: [1, 2] }]]),
      0n, 200n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [500n], value: [5] }]]));

    const result = mergeTrendData(cached, tail, false) as RawSeriesData;
    expect(result.endTime).toBe(500n);
  });
});

describe('mergeTrendData — raw tailing mode', () => {
  it('tailing: live extends past cached — all live kept, no cached truncation', () => {
    // cached: ts 100, 200. live starts at 300 (no overlap). All entries kept.
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n], value: [1, 2] }]]),
      0n, 200n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n], value: [3, 4] }]]));

    const result = mergeTrendData(cached, tail, true) as RawSeriesData;
    const s = result.series.get(1)!;
    expect(s.ts).toEqual([100n, 200n, 300n, 400n]);
    expect(s.value).toEqual([1, 2, 3, 4]);
  });

  it('tailing: cached extends past live (gapfill scenario) — cached entries at live range dropped', () => {
    // cached: ts 100..500 (500 is future gapfill). live: starts at 300.
    // minLiveTs = 300 → cached entries at 300, 400, 500 are dropped.
    // Result: cached 100, 200 + live 300, 400.
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n, 300n, 400n, 500n], value: [1, 2, 3, 4, 5] }]]),
      0n, 500n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n], value: [30, 40] }]]));

    const result = mergeTrendData(cached, tail, true) as RawSeriesData;
    const s = result.series.get(1)!;
    // cached 100, 200 kept; 300+ dropped; live 300, 400 appended
    expect(s.ts).toEqual([100n, 200n, 300n, 400n]);
    expect(s.value).toEqual([1, 2, 30, 40]);
  });

  it('tailing: empty live → cached returned unchanged (no filtering)', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n, 300n], value: [1, 2, 3] }]]),
      0n, 300n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [], value: [] }]]));

    const result = mergeTrendData(cached, tail, true) as RawSeriesData;
    const s = result.series.get(1)!;
    expect(s.ts).toEqual([100n, 200n, 300n]);
    expect(s.value).toEqual([1, 2, 3]);
  });

  it('isTailing=false with overlap: live dedup behaviour preserved', () => {
    // Same as gapfill scenario but fixed mode → live entries at/before maxCachedTs dropped.
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n, 300n, 400n, 500n], value: [1, 2, 3, 4, 5] }]]),
      0n, 500n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n, 600n], value: [30, 40, 60] }]]));

    const result = mergeTrendData(cached, tail, false) as RawSeriesData;
    const s = result.series.get(1)!;
    // live 300, 400 deduped (≤ maxCachedTs=500); only 600 appended
    expect(s.ts).toEqual([100n, 200n, 300n, 400n, 500n, 600n]);
    expect(s.value).toEqual([1, 2, 3, 4, 5, 60]);
  });
});

describe('mergeTrendData — tailing clip', () => {
  it('isTailing=true: cached clipped to liveEndIndex when cached extends past live coverage', () => {
    // cached: 500 buckets (n=500); live: starts at bucket 450 with 30 samples → liveEndIndex=480.
    // isTailing=true → effectiveCachedN=min(500,480)=480; totalN=480.
    // Buckets 480-499 (LOCF gapfill in after-prefetch tile) must be absent.
    const cachedVals = Array.from({ length: 500 }, (_, i) => i * 1.0);
    const cached = makeAgg(500, new Map([[1, cachedVals]]));
    const liveVals = Array.from({ length: 30 }, (_, i) => 1000 + i * 1.0);
    const tail = makeAggTail(BigInt(450 * BUCKET_SMS), new Map([[1, liveVals]]));

    const result = mergeTrendData(cached, tail, true) as AggregateSeriesData;
    expect(result.n).toBe(480);
    expect(result.endTime).toBe(BigInt(480 * BUCKET_SMS));
    const s = result.series.get(1)!;
    // 0-449 from cached; 450-479 from live
    expect(s.value.length).toBe(480);
    expect(s.value[449]).toBe(449);    // last cached bucket before live
    expect(s.value[450]).toBe(1000);   // first live bucket
    expect(s.value[479]).toBe(1029);   // last live bucket
  });

  it('isTailing=false (fixed mode): cached full extent included even when live ends earlier', () => {
    // Same inputs but isTailing=false → full 500 buckets preserved.
    const cachedVals = Array.from({ length: 500 }, (_, i) => i * 1.0);
    const cached = makeAgg(500, new Map([[1, cachedVals]]));
    const liveVals = Array.from({ length: 30 }, (_, i) => 1000 + i * 1.0);
    const tail = makeAggTail(BigInt(450 * BUCKET_SMS), new Map([[1, liveVals]]));

    const result = mergeTrendData(cached, tail, false) as AggregateSeriesData;
    expect(result.n).toBe(500);
    const s = result.series.get(1)!;
    expect(s.value.length).toBe(500);
    // Buckets 480-499 still present (LOCF from the last live/cached value at 479)
    expect(s.value[480]).not.toBeUndefined();
  });

  it('isTailing=true with live extending past cached: no clip, totalN = liveEndIndex', () => {
    // cached: 5 buckets; live: starts at bucket 3 with 5 samples → liveEndIndex=8 > cached.n.
    // effectiveCachedN = min(5, max(0, 8)) = 5; totalN = max(5, 8) = 8 — same as non-tailing.
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(BigInt(3 * BUCKET_SMS), new Map([[1, [10, 20, 30, 40, 50]]]));

    const result = mergeTrendData(cached, tail, true) as AggregateSeriesData;
    expect(result.n).toBe(8);
    const s = result.series.get(1)!;
    expect(s.value).toEqual([1, 2, 3, 10, 20, 30, 40, 50]);
  });

  it('isTailing=true with empty live (liveEndIndex=0): cached returned unchanged, no clip', () => {
    // live.startMs = 0n, maxLiveLen = 0 → liveEndIndex = 0.
    // Guard: isTailing && liveEndIndex > 0 is false → effectiveCachedN = cached.n.
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(0n, new Map([[1, []]]));

    const result = mergeTrendData(cached, tail, true) as AggregateSeriesData;
    // live is empty so result should equal cached
    expect(result.n).toBe(5);
    expect(result.series.get(1)!.value).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('mergeTrendData — type mismatch', () => {
  it('aggregate cached + raw live → returns cached unchanged, logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cached = makeAgg(3, new Map([[1, [1, 2, 3]]]));
    const tail   = makeRawTail(new Map([[1, { ts: [100n], value: [1] }]]));

    const result = mergeTrendData(cached, tail);
    expect(result).toBe(cached);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[mergeTrendData]'),
      expect.anything(),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });
});
