import { describe, it, expect, vi } from 'vitest';
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

describe('mergeTrendData — raw merge', () => {
  it('live entries concatenated after cached entries (no overlap)', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n], value: [1, 2] }]]),
      0n, 200n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n], value: [3, 4] }]]));

    const result = mergeTrendData(cached, tail) as RawSeriesData;
    const s = result.series.get(1)!;
    expect(s.ts).toEqual([100n, 200n, 300n, 400n]);
    expect(s.value).toEqual([1, 2, 3, 4]);
  });

  it('live wins at overlap: cached entries at ts ≥ minLiveTs are dropped', () => {
    // cached: [100,200,300,400,500]; live starts at 300 → cached 300,400,500 dropped
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n, 300n, 400n, 500n], value: [1, 2, 3, 4, 5] }]]),
      0n, 500n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n], value: [30, 40] }]]));

    const result = mergeTrendData(cached, tail) as RawSeriesData;
    const s = result.series.get(1)!;
    expect(s.ts).toEqual([100n, 200n, 300n, 400n]);
    expect(s.value).toEqual([1, 2, 30, 40]);
  });

  it('endTime advances to last merged ts', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n], value: [1, 2] }]]),
      0n, 200n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [500n], value: [5] }]]));

    const result = mergeTrendData(cached, tail) as RawSeriesData;
    expect(result.endTime).toBe(500n);
  });

  it('no live entries for tag: cached entries preserved unchanged', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n, 300n], value: [1, 2, 3] }]]),
      0n, 300n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [], value: [] }]]));

    const result = mergeTrendData(cached, tail) as RawSeriesData;
    const s = result.series.get(1)!;
    expect(s.ts).toEqual([100n, 200n, 300n]);
    expect(s.value).toEqual([1, 2, 3]);
  });

  it('live entries that start before cached max are still included (live wins at coverage start)', () => {
    // cached: [100, 300]. live: [300, 400, 600]. minLiveTs=300 → drop cached[300] → keep [100].
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 300n], value: [1, 3] }]]),
      0n, 300n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [300n, 400n, 600n], value: [30, 40, 60] }]]));

    const result = mergeTrendData(cached, tail) as RawSeriesData;
    const s = result.series.get(1)!;
    // cached[100] kept; cached[300] dropped; live[300,400,600] appended
    expect(s.ts).toEqual([100n, 300n, 400n, 600n]);
    expect(s.value).toEqual([1, 30, 40, 60]);
  });
});

describe('mergeTrendData — coverage clip (unconditional)', () => {
  it('cached clipped to liveEndIndex when cached extends past live coverage', () => {
    // cached: 500 buckets (n=500); live: starts at bucket 450 with 30 samples → liveEndIndex=480.
    // Live wins on coverage → effectiveCachedN=min(500,480)=480; totalN=480.
    // Buckets 480-499 (LOCF gapfill past live coverage) are absent.
    const cachedVals = Array.from({ length: 500 }, (_, i) => i * 1.0);
    const cached = makeAgg(500, new Map([[1, cachedVals]]));
    const liveVals = Array.from({ length: 30 }, (_, i) => 1000 + i * 1.0);
    const tail = makeAggTail(BigInt(450 * BUCKET_SMS), new Map([[1, liveVals]]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    expect(result.n).toBe(480);
    expect(result.endTime).toBe(BigInt(480 * BUCKET_SMS));
    const s = result.series.get(1)!;
    expect(s.value.length).toBe(480);
    expect(s.value[449]).toBe(449);    // last cached bucket before live
    expect(s.value[450]).toBe(1000);   // first live bucket
    expect(s.value[479]).toBe(1029);   // last live bucket
  });

  it('live extending past cached: no clip, totalN = liveEndIndex', () => {
    // cached: 5 buckets; live: starts at bucket 3 with 5 samples → liveEndIndex=8 > cached.n.
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(BigInt(3 * BUCKET_SMS), new Map([[1, [10, 20, 30, 40, 50]]]));

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    expect(result.n).toBe(8);
    const s = result.series.get(1)!;
    expect(s.value).toEqual([1, 2, 3, 10, 20, 30, 40, 50]);
  });

  it('empty live tail (liveEndIndex=0): cached returned unchanged (same reference)', () => {
    // live.startMs = 0n, perTag has empty arrays → fast-path → cached reference returned
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(0n, new Map([[1, []]]));

    const result = mergeTrendData(cached, tail);
    expect(result).toBe(cached);
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

// ─── New Phase 2 tests ────────────────────────────────────────────────────────

describe('mergeTrendData — fast-path (empty live tail)', () => {
  it('aggregate tail with all-empty perTag arrays → returns cached unchanged (same reference)', () => {
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(0n, new Map([[1, []], [2, []]]));

    const result = mergeTrendData(cached, tail);
    expect(result).toBe(cached);
  });

  it('raw tail with all-empty ts arrays → returns cached unchanged (same reference)', () => {
    const cached = makeRaw(
      new Map([[1, { ts: [100n, 200n], value: [1, 2] }]]),
      0n, 200n,
    );
    const tail = makeRawTail(new Map([[1, { ts: [], value: [] }], [2, { ts: [], value: [] }]]));

    const result = mergeTrendData(cached, tail);
    expect(result).toBe(cached);
  });
});

describe('mergeTrendData — live null wins over cached non-null within coverage', () => {
  it('live null in coverage range overrides cached non-null (watchdog case)', () => {
    // cached: [1, 2, 5.2, 4.0, 5.0]; live covers buckets 2-3 with null at bucket 2
    const cached = makeAgg(5, new Map([[1, [1, 2, 5.2, 4.0, 5.0]]]));
    const tail = makeAggTail(2000n, new Map([[1, [null, 4.0]]]));
    // liveStartIndex=2, liveEndIndex=4, effectiveCachedN=min(5,4)=4

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    const s = result.series.get(1)!;
    expect(result.n).toBe(4);
    expect(s.value[0]).toBe(1);
    expect(s.value[1]).toBe(2);
    expect(s.value[2]).toBeNull();   // live null wins over cached 5.2
    expect(s.value[3]).toBe(4.0);   // live 4.0 wins
  });
});

describe('mergeTrendData — outside live coverage: cached wins', () => {
  it('cached buckets before live start are preserved', () => {
    // cached: 5 buckets; live covers only bucket 3 (1 entry)
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(3000n, new Map([[1, [99]]]));
    // liveStartIndex=3, liveEndIndex=4, effectiveCachedN=min(5,4)=4, totalN=4

    const result = mergeTrendData(cached, tail) as AggregateSeriesData;
    const s = result.series.get(1)!;
    expect(result.n).toBe(4);
    expect(s.value[0]).toBe(1);   // cached (before live)
    expect(s.value[1]).toBe(2);   // cached (before live)
    expect(s.value[2]).toBe(3);   // cached (before live)
    expect(s.value[3]).toBe(99);  // live wins in coverage
  });
});

describe('mergeTrendData — cross-bucketSMs (bucketSMs mismatch)', () => {
  it('returns cached unchanged when live.bucketSMs !== cached.bucketSMs', () => {
    const cached = makeAgg(3, new Map([[1, [1, 2, 3]]]));
    const tail = makeAggTail(0n, new Map([[1, [10, 20]]]), 250n);
    const result = mergeTrendData(cached, tail);
    expect(result).toBe(cached);
  });
});

describe('mergeTrendData — seamResponseTailTs=null is a no-op (smell #1)', () => {
  it('null seamResponseTailTs produces identical output to omitting opts', () => {
    // getSeamResponseTailTs returns null when all active-tile responseTailTs are null.
    // mergeTrendData must treat null the same as the no-opts path (seamBucketIndex=-1).
    const cached = makeAgg(5, new Map([[1, [1, 2, 3, 4, 5]]]));
    const tail = makeAggTail(3000n, new Map([[1, [99]]]));

    const withNull = mergeTrendData(cached, tail, { seamResponseTailTs: null }) as AggregateSeriesData;
    const withOmit = mergeTrendData(cached, tail) as AggregateSeriesData;

    expect(withNull.n).toBe(withOmit.n);
    const sNull = withNull.series.get(1)!;
    const sOmit = withOmit.series.get(1)!;
    expect(sNull.value).toEqual(sOmit.value);
    expect(sNull.min).toEqual(sOmit.min);
    expect(sNull.max).toEqual(sOmit.max);
  });

  it('null seamResponseTailTs with multiple tags — live min/max wins at every bucket', () => {
    const cached = makeAgg(3, new Map([[1, [10, 20, 30]], [2, [100, 200, 300]]]));
    const tail = makeAggTail(0n, new Map([[1, [1, 2, 3]], [2, [10, 20, 30]]]));

    const withNull = mergeTrendData(cached, tail, { seamResponseTailTs: null }) as AggregateSeriesData;
    const withOmit = mergeTrendData(cached, tail) as AggregateSeriesData;

    for (const tagId of [1, 2]) {
      const sNull = withNull.series.get(tagId)!;
      const sOmit = withOmit.series.get(tagId)!;
      expect(sNull.value).toEqual(sOmit.value);
      expect(sNull.min).toEqual(sOmit.min);
      expect(sNull.max).toEqual(sOmit.max);
    }
  });
});
