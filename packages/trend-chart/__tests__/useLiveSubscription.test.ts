import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLiveSubscription, TREND_FIFO_CAPACITY } from '../src/useLiveSubscription.js';
import { TS_BUCKET_ORIGIN_MS } from '../src/level.js';

// ─── Mock @caro/hmi-context ────────────────────────────────────────────────────

type TrendCb = (moduleTs: number, value: number | boolean | string | null) => void;

interface CallRecord {
  tagId: number;
  cb: TrendCb;
  unsub: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const calls: CallRecord[] = [];

  const subscribeTrend = vi.fn((tagId: number, cb: TrendCb): (() => void) => {
    const unsub = vi.fn(() => {
      const idx = calls.findIndex(r => r.tagId === tagId && r.cb === cb);
      if (idx >= 0) calls.splice(idx, 1);
    });
    calls.push({ tagId, cb, unsub });
    return unsub;
  });

  return { subscribeTrend, calls };
});

vi.mock('@caro/hmi-context', () => ({
  useHmiContext: () => ({
    tagMap: new Map(),
    tagPathIndex: {},
    getLiveValue: vi.fn(() => ({ value: null })),
    subscribeLiveValue: vi.fn(() => () => {}),
    subscribeTrend: mocks.subscribeTrend,
    writeTag: vi.fn(() => Promise.resolve()),
  }),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Fire all registered callbacks for a given tagId. */
function fireCb(tagId: number, moduleTs: number, value: number | boolean | string | null = 1): void {
  for (const r of mocks.calls) {
    if (r.tagId === tagId) r.cb(moduleTs, value);
  }
}

/** Count currently registered callbacks for a tagId. */
function cbCount(tagId: number): number {
  return mocks.calls.filter(r => r.tagId === tagId).length;
}

beforeEach(() => {
  mocks.subscribeTrend.mockClear();
  mocks.calls.length = 0;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useLiveSubscription — subscription lifecycle', () => {
  it('mount: subscribeTrend called once per tagId', () => {
    renderHook(() =>
      useLiveSubscription({ tagIds: [1, 2, 3], trimThreshold: null }),
    );
    expect(mocks.subscribeTrend).toHaveBeenCalledTimes(3);
    expect(mocks.subscribeTrend).toHaveBeenCalledWith(1, expect.any(Function));
    expect(mocks.subscribeTrend).toHaveBeenCalledWith(2, expect.any(Function));
    expect(mocks.subscribeTrend).toHaveBeenCalledWith(3, expect.any(Function));
  });

  it('unmount: all unsubscribes are called', () => {
    const { unmount } = renderHook(() =>
      useLiveSubscription({ tagIds: [10, 20], trimThreshold: null }),
    );
    const unsubFns = mocks.calls.map(r => r.unsub);
    expect(unsubFns).toHaveLength(2);
    unmount();
    for (const fn of unsubFns) expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tagIds change — add tag: new subscribeTrend call for added tag only', () => {
    const { rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null } } },
    );
    mocks.subscribeTrend.mockClear();

    rerender({ opts: { tagIds: [1, 2], trimThreshold: null } });

    // Re-runs effect: old sub for 1 is cleaned up and re-subscribed; 2 is new
    const calledIds = mocks.subscribeTrend.mock.calls.map(c => c[0]);
    expect(calledIds).toContain(2);
  });

  it('tagIds change — remove tag: unsubscribe fires; that tag FIFO is pruned', () => {
    const { rerender, result } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1, 2], trimThreshold: null } } },
    );
    act(() => { fireCb(1, 100, 5); fireCb(2, 200, 6); });

    // Remove tag 2: its FIFO entry (200) should be deleted. Tag 1's FIFO (100) survives.
    rerender({ opts: { tagIds: [1], trimThreshold: null } });

    const { start, end } = result.current.commitAndDrain();
    // Tag 2's entry at 200 is pruned. Only tag 1's entry at 100 remains.
    expect(start).toBe(100n);
    expect(end).toBe(100n);
  });
});

describe('useLiveSubscription — FIFO buffer', () => {
  it('single callback → entry appears; commitAndDrain returns that moduleTs', () => {
    const { result } = renderHook(() =>
      useLiveSubscription({ tagIds: [1], trimThreshold: null }),
    );
    act(() => { fireCb(1, 1_000, 42); });

    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(1_000n);
    expect(end).toBe(1_000n);
  });

  it('multiple callbacks across tags → commitAndDrain returns min/max across all', () => {
    const { result } = renderHook(() =>
      useLiveSubscription({ tagIds: [1, 2], trimThreshold: null }),
    );
    act(() => {
      fireCb(1, 500, 1);
      fireCb(2, 1500, 2);
      fireCb(1, 1200, 3);
    });

    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(500n);
    expect(end).toBe(1500n);
  });

  it('FIFO overflow: 101st push drops the oldest entry', () => {
    const { result } = renderHook(() =>
      useLiveSubscription({ tagIds: [1], trimThreshold: null }),
    );
    act(() => {
      // Push TREND_FIFO_CAPACITY + 1 entries: moduleTs 0..100
      for (let i = 0; i <= TREND_FIFO_CAPACITY; i++) {
        fireCb(1, i, i);
      }
    });

    // Entry 0 was the oldest and should have been shifted out.
    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(1n);           // moduleTs=0 was evicted
    expect(end).toBe(BigInt(TREND_FIFO_CAPACITY));
  });

  it('commitAndDrain on empty state → { start: 0n, end: 0n }', () => {
    const { result } = renderHook(() =>
      useLiveSubscription({ tagIds: [1, 2], trimThreshold: null }),
    );
    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(0n);
    expect(end).toBe(0n);
  });

  it('commitAndDrain clears FIFOs but preserves subscriptions; next callback appends correctly', () => {
    const { result } = renderHook(() =>
      useLiveSubscription({ tagIds: [1], trimThreshold: null }),
    );
    act(() => { fireCb(1, 100, 1); });
    result.current.commitAndDrain(); // clears

    // New callback after drain should still be received
    act(() => { fireCb(1, 200, 2); });
    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(200n);
    expect(end).toBe(200n);
    // Subscription is still active (callback count unchanged)
    expect(cbCount(1)).toBe(1);
  });
});

describe('useLiveSubscription — trim threshold', () => {
  it('entries with moduleTs < threshold are removed; == and > are kept', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null } } },
    );
    act(() => {
      fireCb(1, 50, 1);   // below threshold
      fireCb(1, 100, 2);  // equals threshold
      fireCb(1, 150, 3);  // above threshold
    });

    rerender({ opts: { tagIds: [1], trimThreshold: 100 } });

    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(100n);
    expect(end).toBe(150n);
  });

  it('null → number transition triggers an immediate trim', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null } } },
    );
    act(() => {
      fireCb(1, 200, 1);
      fireCb(1, 800, 2);
    });

    // Transition from null to 500 should trim the entry at 200
    rerender({ opts: { tagIds: [1], trimThreshold: 500 } });

    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(800n);
    expect(end).toBe(800n);
  });

  it('backward trimThreshold is a no-op (already-trimmed entries are not restored)', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null } } },
    );
    // Push entry while threshold is null (no trim runs yet)
    act(() => { fireCb(1, 50, 1); });

    // Advance threshold to 100: entry at 50 is removed (50 < 100)
    rerender({ opts: { tagIds: [1], trimThreshold: 100 } });

    // Move threshold backward to 40: entry at 50 is already gone; a lower threshold
    // cannot restore it
    rerender({ opts: { tagIds: [1], trimThreshold: 40 } });

    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(0n);
    expect(end).toBe(0n);
  });
});

// ─── Bucket accumulator helpers ───────────────────────────────────────────────
//
// All timestamps are anchored to TS_BUCKET_ORIGIN_MS so bucket boundaries
// are exact multiples of BUCKET_SMS from the origin.

const ORIGIN      = Number(TS_BUCKET_ORIGIN_MS); // ms since Unix epoch
const BUCKET_SMS  = 1000n;                        // 1-second buckets for easy arithmetic

// Helpers: time at offset ms within a specific bucket index
function tAt(bucketIdx: number, offsetMs = 500): number {
  return ORIGIN + bucketIdx * Number(BUCKET_SMS) + offsetMs;
}

// Default tailing options (aggregate mode)
function tailingOpts(tagIds: number[], seed?: Map<number, number | null>): Parameters<typeof useLiveSubscription>[0] {
  return {
    tagIds,
    trimThreshold: null,
    isTailing: true,
    bucketSMs: BUCKET_SMS,
    seedFromCachedTile: seed ?? null,
    tailMode: 'aggregate',
  };
}

// ─── Three-case rule ──────────────────────────────────────────────────────────

describe('useLiveSubscription — three-case rule (aggregate)', () => {
  it('normal: events 5, 7, 6 in one bucket; next-bucket event closes it → (last=6, min=5, max=7)', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), 5);
      fireCb(1, tAt(0, 200), 7);
      fireCb(1, tAt(0, 300), 6);
      fireCb(1, tAt(1, 100), 0); // triggers close of bucket 0
    });
    const { tail } = result.current;
    expect(tail).not.toBeNull();
    expect(tail!.perTag.get(1)!.value).toEqual([6]);
    expect(tail!.perTag.get(1)!.min).toEqual([5]);
    expect(tail!.perTag.get(1)!.max).toEqual([7]);
  });

  it('mixed-null: non-null then null in same bucket → close emits (null, null, null), lastKnownValue := null', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), 5);   // non-null
      fireCb(1, tAt(0, 200), null); // null — makes it mixed
      fireCb(1, tAt(1, 100), 1);   // triggers close of bucket 0
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toEqual([null]);
    expect(tail!.perTag.get(1)!.min).toEqual([null]);
    expect(tail!.perTag.get(1)!.max).toEqual([null]);
  });

  it('mixed-null sets lastKnownValue to null; next empty bucket emits (null, null, null)', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), null); // mixed-null
      fireCb(1, tAt(2, 100), 1);   // skips bucket 1 (empty), closes bucket 0, then closes bucket 1 (empty)
    });
    const { tail } = result.current;
    // bucket 0: mixed-null → (null, null, null), lkv = null
    // bucket 1: empty, lkv=null → (null, null, null)
    expect(tail!.perTag.get(1)!.value).toEqual([null, null]);
  });

  it('empty bucket inherits lkv from prior normal close', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), 5); // bucket 0: normal, lkv → 5 on close
      fireCb(1, tAt(2, 100), 9); // bucket 2: closes bucket 0 (normal), closes bucket 1 (empty, lkv=5)
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toEqual([5, 5]); // bucket 0 normal, bucket 1 empty LOCF
    expect(tail!.perTag.get(1)!.min).toEqual([5, 5]);
    expect(tail!.perTag.get(1)!.max).toEqual([5, 5]);
  });

  it('empty bucket after mixed-null close emits (null, null, null)', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), null); // bucket 0: mixed-null → lkv = null on close
      fireCb(1, tAt(2, 100), 9);   // closes bucket 0 (mixed-null), closes bucket 1 (empty, lkv=null)
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toEqual([null, null]);
    expect(tail!.perTag.get(1)!.min).toEqual([null, null]);
  });

  it('boolean true → 1 in aggregate bucket (last, min, max)', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), true);
      fireCb(1, tAt(1, 100), 0); // closes bucket 0
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toEqual([1]);
    expect(tail!.perTag.get(1)!.min).toEqual([1]);
    expect(tail!.perTag.get(1)!.max).toEqual([1]);
  });

  it('boolean false → 0 in aggregate bucket (last, min, max)', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), false);
      fireCb(1, tAt(1, 100), 0); // closes bucket 0
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toEqual([0]);
    expect(tail!.perTag.get(1)!.min).toEqual([0]);
    expect(tail!.perTag.get(1)!.max).toEqual([0]);
  });

  it('sequence true, false, true in one bucket → (last=1, min=0, max=1)', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), true);
      fireCb(1, tAt(0, 200), false);
      fireCb(1, tAt(0, 300), true);
      fireCb(1, tAt(1, 100), 0); // closes bucket 0
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toEqual([1]);
    expect(tail!.perTag.get(1)!.min).toEqual([0]);
    expect(tail!.perTag.get(1)!.max).toEqual([1]);
  });
});

// ─── Bucket boundary tests ────────────────────────────────────────────────────

describe('useLiveSubscription — bucket boundaries', () => {
  it('two events in same bucket → no closed buckets; tail is null', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 100), 3);
      fireCb(1, tAt(0, 400), 5);
    });
    expect(result.current.tail).toBeNull(); // no bucket has closed
  });

  it('event past one bucket boundary → previous bucket closes, new bucket opens', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 500), 10);
      fireCb(1, tAt(1, 500), 20); // crosses into bucket 1
    });
    const { tail } = result.current;
    expect(tail).not.toBeNull();
    expect(tail!.perTag.get(1)!.value).toHaveLength(1); // only bucket 0 closed
    expect(tail!.perTag.get(1)!.value[0]).toBe(10);
    expect(tail!.startMs).toBe(BigInt(ORIGIN)); // bucket 0 = TS_BUCKET_ORIGIN_MS
  });

  it('event 3 buckets later → closes current + 2 intermediate empties', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 500), 7); // bucket 0
      fireCb(1, tAt(3, 500), 9); // jumps to bucket 3 → closes 0 (normal), 1 (empty), 2 (empty)
    });
    const { tail } = result.current;
    expect(tail!.perTag.get(1)!.value).toHaveLength(3);
    // bucket 0: normal (lkv→7), bucket 1: empty (LOCF=7), bucket 2: empty (LOCF=7)
    expect(tail!.perTag.get(1)!.value).toEqual([7, 7, 7]);
    expect(tail!.perTag.get(1)!.min).toEqual([7, 7, 7]);
  });
});

// ─── Mode-flip tests ──────────────────────────────────────────────────────────

describe('useLiveSubscription — mode-flip', () => {
  it('false→true with FIFO entries: accumulator replays them and produces tail', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: false, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } } },
    );
    // Push events while not tailing (FIFO fills, no accumulator)
    act(() => {
      fireCb(1, tAt(0, 100), 3);
      fireCb(1, tAt(0, 200), 5);
      fireCb(1, tAt(1, 100), 7); // would close bucket 0 on replay
    });
    expect(result.current.tail).toBeNull(); // not tailing yet

    // Flip to tailing: replays FIFO
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } });

    const { tail } = result.current;
    expect(tail).not.toBeNull();
    expect(tail!.perTag.get(1)!.value).toHaveLength(1);
    expect(tail!.perTag.get(1)!.value[0]).toBe(5); // last in bucket 0 (5 came after 3, then 7 closes it — last non-null = 5 since 7 is in bucket 1)
  });

  it('false→true with empty FIFO: tail remains null until first event', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: false, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } } },
    );
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } });
    expect(result.current.tail).toBeNull();

    // Even after an event in the open bucket (not yet closed), tail is still null
    act(() => { fireCb(1, tAt(0, 100), 5); });
    expect(result.current.tail).toBeNull(); // open bucket only, nothing closed
  });

  it('isTailing=true with bucketSMs=null (aggregate): stays dormant; inits when bucketSMs arrives', () => {
    // The accumulator should not process events when bucketSMs is unknown.
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: null as bigint | null, seedFromCachedTile: null, tailMode: 'aggregate' as const } } },
    );
    act(() => { fireCb(1, tAt(0, 100), 5); }); // FIFO fills but no accumulator
    expect(result.current.tail).toBeNull();

    // bucketSMs arrives — triggers re-init + FIFO replay
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } });
    // FIFO has one event in bucket 0; no close yet
    expect(result.current.tail).toBeNull();

    // Bucket 1 event closes bucket 0
    act(() => { fireCb(1, tAt(1, 100), 9); });
    expect(result.current.tail).not.toBeNull();
    expect(result.current.tail!.perTag.get(1)!.value).toHaveLength(1);
    expect(result.current.tail!.perTag.get(1)!.value[0]).toBe(5); // bucket 0 normal close
  });

  it('true→false clears accumulator and sets tail to null', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } } },
    );
    act(() => {
      fireCb(1, tAt(0, 100), 3);
      fireCb(1, tAt(1, 100), 5); // closes bucket 0
    });
    expect(result.current.tail).not.toBeNull();

    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: false, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } });
    expect(result.current.tail).toBeNull();
  });
});

// ─── Trim integration ────────────────────────────────────────────────────────

describe('useLiveSubscription — trim + accumulator coexistence', () => {
  it('trimThreshold advance trims FIFO; accumulator state survives unchanged', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null, isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } } },
    );
    act(() => {
      fireCb(1, tAt(0, 100), 3);
      fireCb(1, tAt(1, 100), 5); // closes bucket 0 → tail has 1 closed bucket
    });
    const closedBefore = result.current.tail!.perTag.get(1)!.value.length;
    expect(closedBefore).toBe(1);

    // Advance trim: FIFO events below threshold are removed. Accumulator untouched.
    rerender({ opts: { tagIds: [1], trimThreshold: tAt(0, 500), isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } });

    // Accumulator still reports the same closed bucket
    expect(result.current.tail!.perTag.get(1)!.value).toHaveLength(closedBefore);
  });
});

// ─── commitAndDrain extension ────────────────────────────────────────────────

describe('useLiveSubscription — commitAndDrain with accumulator', () => {
  it('accumulator-only data: range spans closed buckets + open bucket end', () => {
    const { result } = renderHook(() => useLiveSubscription(tailingOpts([1])));
    act(() => {
      fireCb(1, tAt(0, 500), 3); // open bucket 0
      fireCb(1, tAt(1, 500), 5); // closes bucket 0; bucket 1 open
    });
    // Accumulator: closed=[bucket0], open=bucket1
    // acc range: [bucket0.startMs, bucket1.startMs + BUCKET_SMS]
    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(BigInt(ORIGIN));                      // first closed = bucket 0
    expect(end).toBe(BigInt(ORIGIN) + 2n * BUCKET_SMS);     // open bucket 1 end
  });

  it('FIFO + accumulator: range is union of both', () => {
    // Push FIFO entry before tailing starts (FIFO entry at an earlier time)
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: false, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } } },
    );
    act(() => {
      fireCb(1, tAt(0, 100), 1); // FIFO entry at tAt(0,100)
    });
    // Flip to tailing and push an event that closes a bucket
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, seedFromCachedTile: null, tailMode: 'aggregate' as const } });
    act(() => {
      fireCb(1, tAt(1, 500), 9); // closes bucket 0; bucket 1 open
    });
    // FIFO has tAt(0,100) and tAt(1,500); acc covers [bucket0.start, bucket1.end]
    const { start, end } = result.current.commitAndDrain();
    // start: min(fifoMin=tAt(0,100), accStart=bucket0.start=ORIGIN) = ORIGIN
    // end: max(fifoMax=tAt(1,500), accEnd=ORIGIN+2*BUCKET_SMS=ORIGIN+2000)
    expect(start).toBe(BigInt(ORIGIN));
    expect(end).toBe(BigInt(ORIGIN) + 2n * BUCKET_SMS);
  });
});

// ─── Raw mode helpers ─────────────────────────────────────────────────────────

function rawOpts(tagIds: number[]): Parameters<typeof useLiveSubscription>[0] {
  return { tagIds, trimThreshold: null, isTailing: true, tailMode: 'raw' };
}

// ─── Raw mode: core behavior ──────────────────────────────────────────────────

describe('useLiveSubscription — raw mode core', () => {
  it('events arrive → perTag has them as (ts, value) pairs in order', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => {
      fireCb(1, 1000, 3.5);
      fireCb(1, 2000, 7.0);
    });
    const { tail } = result.current;
    expect(tail).not.toBeNull();
    expect(tail!.mode).toBe('raw');
    const t = (tail as import('../src/useLiveSubscription.js').RawTail).perTag.get(1)!;
    expect(t.ts).toEqual([1000n, 2000n]);
    expect(t.value).toEqual([3.5, 7.0]);
  });

  it('null value is preserved (not dropped)', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => {
      fireCb(1, 1000, null);
      fireCb(1, 2000, 5);
    });
    const t = (result.current.tail as import('../src/useLiveSubscription.js').RawTail)!.perTag.get(1)!;
    expect(t.value).toEqual([null, 5]);
  });

  it('boolean true → 1 in raw tail (toNumericValue)', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => {
      fireCb(1, 1000, true);
    });
    const t = (result.current.tail as import('../src/useLiveSubscription.js').RawTail)!.perTag.get(1)!;
    expect(t.value).toEqual([1]);
  });

  it('boolean false → 0 in raw tail (toNumericValue)', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => {
      fireCb(1, 1000, false);
    });
    const t = (result.current.tail as import('../src/useLiveSubscription.js').RawTail)!.perTag.get(1)!;
    expect(t.value).toEqual([0]);
  });

  it('string value → null in raw tail (toNumericValue)', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => {
      fireCb(1, 1000, 'on');
    });
    const t = (result.current.tail as import('../src/useLiveSubscription.js').RawTail)!.perTag.get(1)!;
    expect(t.value).toEqual([null]);
  });

  it('null value → null in raw tail (toNumericValue regression)', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => {
      fireCb(1, 1000, null);
    });
    const t = (result.current.tail as import('../src/useLiveSubscription.js').RawTail)!.perTag.get(1)!;
    expect(t.value).toEqual([null]);
  });

  it('multiple tags go to separate perTag entries', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1, 2])));
    act(() => {
      fireCb(1, 1000, 10);
      fireCb(2, 1500, 20);
    });
    const tail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    expect(tail.perTag.get(1)!.value).toEqual([10]);
    expect(tail.perTag.get(2)!.value).toEqual([20]);
  });

  it('no events yet → tail is null', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    expect(result.current.tail).toBeNull();
  });
});

// ─── Raw mode: tailMode change while tailing ──────────────────────────────────

describe('useLiveSubscription — tailMode transitions', () => {
  it('tailMode null → aggregate: accumulator initializes; tail becomes aggregate on close', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: null as 'aggregate' | 'raw' | null } } },
    );
    expect(result.current.tail).toBeNull();

    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'aggregate' } });
    act(() => {
      fireCb(1, tAt(0, 100), 5);
      fireCb(1, tAt(1, 100), 9); // closes bucket 0
    });
    expect(result.current.tail).not.toBeNull();
    expect(result.current.tail!.mode).toBe('aggregate');
  });

  it('tailMode null → raw: raw buffer initializes; tail becomes raw on first event', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, tailMode: null as 'aggregate' | 'raw' | null } } },
    );
    expect(result.current.tail).toBeNull();

    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, tailMode: 'raw' } });
    act(() => { fireCb(1, 5000, 42); });
    expect(result.current.tail!.mode).toBe('raw');
  });

  it('tailMode aggregate → raw while tailing: accumulator clears; raw buffer starts fresh', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'aggregate' as const } } },
    );
    act(() => {
      fireCb(1, tAt(0, 100), 5);
      fireCb(1, tAt(1, 100), 9); // closes bucket 0 → aggregate tail has 1 bucket
    });
    expect(result.current.tail!.mode).toBe('aggregate');

    // Switch to raw mode: accumulator clears; FIFO in FIFO replays into raw buffer
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'raw' } });
    // FIFO was populated during aggregate phase; replay produces raw tail
    expect(result.current.tail!.mode).toBe('raw');
    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    // Entries from FIFO replay should be present
    expect(rawTail.perTag.get(1)!.ts.length).toBeGreaterThan(0);
  });

  it('tailMode raw → aggregate while tailing: raw clears; accumulator re-inits from FIFO', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'raw' as const } } },
    );
    act(() => {
      fireCb(1, tAt(0, 100), 3);
      fireCb(1, tAt(1, 100), 7);
    });
    expect(result.current.tail!.mode).toBe('raw');

    // Switch to aggregate: raw clears, accumulator replays FIFO
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'aggregate' } });
    // FIFO has two entries spanning bucket 0 and 1; replay closes bucket 0
    expect(result.current.tail!.mode).toBe('aggregate');
    const aggTail = result.current.tail as import('../src/useLiveSubscription.js').AggregateTail;
    expect(aggTail.perTag.get(1)!.value).toHaveLength(1); // bucket 0 closed
    expect(aggTail.perTag.get(1)!.value[0]).toBe(3);
  });

  it('isTailing true → false with tailMode=raw: raw buffer clears; tail becomes null', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: true, tailMode: 'raw' as const } } },
    );
    act(() => { fireCb(1, 1000, 5); });
    expect(result.current.tail).not.toBeNull();

    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: false, tailMode: 'raw' as const } });
    expect(result.current.tail).toBeNull();
  });
});

// ─── Raw mode: trim integration ───────────────────────────────────────────────

describe('useLiveSubscription — raw trim', () => {
  it('trimThreshold does NOT trim raw buffers (rawBuffers survive threshold advance)', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null, isTailing: true, tailMode: 'raw' as const } } },
    );
    act(() => {
      fireCb(1, 100, 1);
      fireCb(1, 500, 2);
      fireCb(1, 900, 3);
    });
    // Advance threshold to 500: rawBuffers must NOT be trimmed (all 3 entries survive)
    rerender({ opts: { tagIds: [1], trimThreshold: 500, isTailing: true, tailMode: 'raw' as const } });

    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    expect(rawTail.perTag.get(1)!.ts).toEqual([100n, 500n, 900n]);
    expect(rawTail.perTag.get(1)!.value).toEqual([1, 2, 3]);
  });

  it('minLiveTs (rawBuffers[0].ts) does not advance when trimThreshold advances', () => {
    // Regression: if rawBuffers were trimmed on threshold advance, minLiveTs would
    // jump forward, letting cached LOCF gapfill leak through mergeRaw's drop filter.
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null, isTailing: true, tailMode: 'raw' as const } } },
    );
    act(() => {
      fireCb(1, 1000, 10);
      fireCb(1, 2000, 20);
      fireCb(1, 3000, 30);
    });
    // After threshold advances to 2500, rawBuffers must still have the ts=1000 entry
    rerender({ opts: { tagIds: [1], trimThreshold: 2500, isTailing: true, tailMode: 'raw' as const } });

    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    // All entries survive — minLiveTs stays at 1000n
    expect(rawTail.perTag.get(1)!.ts[0]).toBe(1000n);
  });

  it('FIFO IS trimmed when trimThreshold advances in raw mode', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null, isTailing: true, tailMode: 'raw' as const } } },
    );
    act(() => {
      fireCb(1, 100, 1);
      fireCb(1, 500, 2);
      fireCb(1, 900, 3);
    });
    rerender({ opts: { tagIds: [1], trimThreshold: 500, isTailing: true, tailMode: 'raw' as const } });
    // After trim, re-enter tailing to force FIFO replay into rawBuffers — should
    // replay only entries >= threshold (500 and 900)
    rerender({ opts: { tagIds: [1], trimThreshold: 500, isTailing: false, tailMode: 'raw' as const } });
    rerender({ opts: { tagIds: [1], trimThreshold: 500, isTailing: true, tailMode: 'raw' as const } });

    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    expect(rawTail.perTag.get(1)!.ts).toEqual([500n, 900n]);
  });

  it('aggregate mode: trimThreshold advance does NOT touch accumulator (step 7 invariant preserved)', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null as number | null, isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'aggregate' as const } } },
    );
    act(() => {
      fireCb(1, tAt(0, 100), 3);
      fireCb(1, tAt(1, 100), 5); // closes bucket 0
    });
    const lenBefore = result.current.tail!.perTag.get(1)!.value.length;
    rerender({ opts: { tagIds: [1], trimThreshold: tAt(1, 50), isTailing: true, bucketSMs: BUCKET_SMS, tailMode: 'aggregate' as const } });
    // Accumulator closed-bucket count is unchanged
    expect(result.current.tail!.perTag.get(1)!.value).toHaveLength(lenBefore);
  });
});

// ─── Raw mode: viewportSpanMs 2×span trim ────────────────────────────────────

describe('useLiveSubscription — viewportSpanMs 2×span trim', () => {
  it('entries older than latestTs - 2×viewportSpanMs are evicted from raw buffers', () => {
    // viewportSpanMs = 60_000n (1 min) → cutoff = latestTs - 120_000
    const SPAN = 60_000n;
    const { result } = renderHook(() =>
      useLiveSubscription({
        tagIds: [1],
        trimThreshold: null,
        isTailing: true,
        tailMode: 'raw',
        viewportSpanMs: SPAN,
      }),
    );

    // Push entries spanning 200 s: ts 0, 50_000, 100_000, 150_000, 200_000
    act(() => {
      fireCb(1, 0,       1);
      fireCb(1, 50_000,  2);
      fireCb(1, 100_000, 3);
      fireCb(1, 150_000, 4);
      fireCb(1, 200_000, 5); // latestTs = 200_000; cutoff = 200_000 - 120_000 = 80_000
    });

    // Entries with ts < 80_000 (i.e. ts=0 and ts=50_000) should have been evicted.
    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    const ts = rawTail.perTag.get(1)!.ts;
    expect(ts.every(t => t >= 80_000n)).toBe(true);
    expect(ts).toContain(100_000n);
    expect(ts).toContain(150_000n);
    expect(ts).toContain(200_000n);
    expect(ts).not.toContain(0n);
    expect(ts).not.toContain(50_000n);
  });

  it('entries within 2×viewportSpanMs are all kept', () => {
    const SPAN = 60_000n;
    const { result } = renderHook(() =>
      useLiveSubscription({
        tagIds: [1],
        trimThreshold: null,
        isTailing: true,
        tailMode: 'raw',
        viewportSpanMs: SPAN,
      }),
    );

    // 3 entries, all within 2×60s = 120s of each other
    act(() => {
      fireCb(1, 100_000, 1);
      fireCb(1, 150_000, 2);
      fireCb(1, 200_000, 3); // cutoff = 80_000; all ts >= 80_000 → none evicted
    });

    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    expect(rawTail.perTag.get(1)!.ts).toEqual([100_000n, 150_000n, 200_000n]);
  });
});

// ─── Raw mode: commitAndDrain and FIFO replay ─────────────────────────────────

describe('useLiveSubscription — raw commitAndDrain + FIFO replay', () => {
  it('raw entries: covered range is min/max moduleTs across all tags', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1, 2])));
    act(() => {
      fireCb(1, 1000, 5);
      fireCb(2, 3000, 7);
      fireCb(1, 2000, 9);
    });
    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(1000n);
    expect(end).toBe(3000n);
  });

  it('enter tailing with tailMode=raw and FIFO entries: raw buffer gets FIFO replay', () => {
    const { result, rerender } = renderHook(
      ({ opts }) => useLiveSubscription(opts),
      { initialProps: { opts: { tagIds: [1], trimThreshold: null, isTailing: false, tailMode: 'raw' as const } } },
    );
    // Fill FIFO while not tailing
    act(() => {
      fireCb(1, 1000, 10);
      fireCb(1, 2000, 20);
    });
    expect(result.current.tail).toBeNull();

    // Enter tailing: FIFO replays into raw buffer
    rerender({ opts: { tagIds: [1], trimThreshold: null, isTailing: true, tailMode: 'raw' as const } });
    const rawTail = result.current.tail as import('../src/useLiveSubscription.js').RawTail;
    expect(rawTail).not.toBeNull();
    expect(rawTail.perTag.get(1)!.ts).toEqual([1000n, 2000n]);
    expect(rawTail.perTag.get(1)!.value).toEqual([10, 20]);
  });

  it('raw commitAndDrain after drain → { 0n, 0n }', () => {
    const { result } = renderHook(() => useLiveSubscription(rawOpts([1])));
    act(() => { fireCb(1, 5000, 1); });
    result.current.commitAndDrain();
    const { start, end } = result.current.commitAndDrain();
    expect(start).toBe(0n);
    expect(end).toBe(0n);
  });
});

// ─── onDataReceived ───────────────────────────────────────────────────────────

describe('useLiveSubscription — onDataReceived', () => {
  it('fires once per frame with max moduleTs across all tag callbacks', async () => {
    const onDataReceived = vi.fn();
    renderHook(() => useLiveSubscription({
      tagIds: [1, 2],
      trimThreshold: null,
      onDataReceived,
    }));

    await act(async () => {
      fireCb(1, 3000, 1); // lower ts
      fireCb(2, 5000, 2); // higher ts — same synchronous frame
    });

    expect(onDataReceived).toHaveBeenCalledTimes(1);
    expect(onDataReceived).toHaveBeenCalledWith(5000);
  });

  it('fires once per act frame (separate calls = separate frames)', async () => {
    const onDataReceived = vi.fn();
    renderHook(() => useLiveSubscription({
      tagIds: [1],
      trimThreshold: null,
      onDataReceived,
    }));

    await act(async () => { fireCb(1, 1000, 1); });
    await act(async () => { fireCb(1, 2000, 2); });

    expect(onDataReceived).toHaveBeenCalledTimes(2);
    expect(onDataReceived).toHaveBeenNthCalledWith(1, 1000);
    expect(onDataReceived).toHaveBeenNthCalledWith(2, 2000);
  });

  it('fires unconditionally regardless of isTailing', async () => {
    const onDataReceived = vi.fn();
    renderHook(() => useLiveSubscription({
      tagIds: [1],
      trimThreshold: null,
      isTailing: false,
      onDataReceived,
    }));

    await act(async () => { fireCb(1, 9000, 5); });

    expect(onDataReceived).toHaveBeenCalledTimes(1);
    expect(onDataReceived).toHaveBeenCalledWith(9000);
  });
});
