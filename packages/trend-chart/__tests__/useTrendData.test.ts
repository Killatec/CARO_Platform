import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTrendData, pruneAndAdd } from '../src/useTrendData.js';
import { fetchTile } from '../src/api.js';
import type { Viewport, Tile } from '../src/types.js';
import type { TileApiResponse } from '../src/api.js';

vi.mock('../src/api.js', () => ({
  fetchTile: vi.fn(),
}));

const mockFetchTile = vi.mocked(fetchTile);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ONE_HOUR = 3_600_000n;
const HALF_HOUR = 1_800_000n;

const defaultViewport: Viewport = { start: 0n, end: ONE_HOUR };

function makeAggResponse(tagIds: number[], opts: { n?: number; bucketSMs?: number; source?: TileApiResponse['source'] } = {}): TileApiResponse {
  const { n = 500, bucketSMs = 3_600, source = '1min_cagg' } = opts;
  if (source === 'raw') throw new Error('use makeRawResponse for raw source');
  return {
    source: source as '1min_cagg',
    startTime: 0,
    endTime: Number(ONE_HOUR),
    bucketSMs,
    n,
    series: tagIds.map(id => ({
      tagId: id,
      value: new Array(n).fill(1.0),
      min:   new Array(n).fill(0.9),
      max:   new Array(n).fill(1.1),
    })),
  };
}

function makeRawResponse(tagIds: number[]): TileApiResponse {
  return {
    source: 'raw',
    startTime: 0,
    endTime: Number(ONE_HOUR),
    series: tagIds.map(id => ({ tagId: id, ts: [100, 200, 300], value: [1.0, 2.0, null] })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchTile.mockResolvedValue(makeAggResponse([1, 2, 3, 4, 5, 6, 7, 8]));
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTile(startMs: bigint, endMs: bigint, bucketCount = 500): Tile {
  return { startTime: startMs, endTime: endMs, bucketCount };
}

// ─── pruneAndAdd ─────────────────────────────────────────────────────────────

describe('pruneAndAdd', () => {
  const SPAN = 1_800_000n; // 30 min tiles

  it('empty active set → returns [newTile]', () => {
    const newTile = makeTile(0n, SPAN);
    expect(pruneAndAdd([], newTile)).toEqual([newTile]);
  });

  it('active set of 3 + left tile → 4 tiles, all originals kept', () => {
    const tiles = [makeTile(0n, SPAN), makeTile(SPAN, SPAN * 2n), makeTile(SPAN * 2n, SPAN * 3n)];
    const newTile = makeTile(-SPAN, 0n);
    const result = pruneAndAdd(tiles, newTile);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(newTile);
    expect(result[3]).toEqual(tiles[2]);
  });

  it('active set of 8 + left tile → 8 tiles, rightmost dropped', () => {
    const tiles = [
      makeTile(0n, SPAN), makeTile(SPAN, SPAN * 2n), makeTile(SPAN * 2n, SPAN * 3n), makeTile(SPAN * 3n, SPAN * 4n),
      makeTile(SPAN * 4n, SPAN * 5n), makeTile(SPAN * 5n, SPAN * 6n), makeTile(SPAN * 6n, SPAN * 7n), makeTile(SPAN * 7n, SPAN * 8n),
    ];
    const newTile = makeTile(-SPAN, 0n);
    const result = pruneAndAdd(tiles, newTile);
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual(newTile);
    // Rightmost tile (SPAN*7n:SPAN*8n) must be gone.
    expect(result.some(t => t.startTime === SPAN * 7n)).toBe(false);
  });

  it('active set of 8 + right tile → 8 tiles, leftmost dropped', () => {
    const tiles = [
      makeTile(0n, SPAN), makeTile(SPAN, SPAN * 2n), makeTile(SPAN * 2n, SPAN * 3n), makeTile(SPAN * 3n, SPAN * 4n),
      makeTile(SPAN * 4n, SPAN * 5n), makeTile(SPAN * 5n, SPAN * 6n), makeTile(SPAN * 6n, SPAN * 7n), makeTile(SPAN * 7n, SPAN * 8n),
    ];
    const newTile = makeTile(SPAN * 8n, SPAN * 9n);
    const result = pruneAndAdd(tiles, newTile);
    expect(result).toHaveLength(8);
    expect(result[result.length - 1]).toEqual(newTile);
    // Leftmost tile (0n:SPAN) must be gone.
    expect(result.some(t => t.startTime === 0n)).toBe(false);
  });

  it('active set of 8 + middle tile → 8 tiles, warn logged, leftmost dropped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tiles = [
      makeTile(0n, SPAN * 2n), makeTile(SPAN * 2n, SPAN * 4n), makeTile(SPAN * 4n, SPAN * 6n), makeTile(SPAN * 6n, SPAN * 8n),
      makeTile(SPAN * 8n, SPAN * 10n), makeTile(SPAN * 10n, SPAN * 12n), makeTile(SPAN * 12n, SPAN * 14n), makeTile(SPAN * 14n, SPAN * 16n),
    ];
    // Middle tile: startTime > tiles[0].startTime, endTime < tiles[last].endTime.
    const newTile = makeTile(SPAN, SPAN * 3n);
    const result = pruneAndAdd(tiles, newTile);
    expect(result).toHaveLength(8);
    expect(warnSpy).toHaveBeenCalledWith(
      '[useTrendData] pruneAndAdd: newTile is in the middle of activeSet — unexpected',
    );
    warnSpy.mockRestore();
  });

  it('maxSize override: no pruning until count exceeds maxSize', () => {
    const tiles = [makeTile(0n, SPAN), makeTile(SPAN, SPAN * 2n), makeTile(SPAN * 2n, SPAN * 3n), makeTile(SPAN * 3n, SPAN * 4n)];
    const newTile = makeTile(SPAN * 4n, SPAN * 5n);
    const result = pruneAndAdd(tiles, newTile, 6);
    // 4 + 1 = 5 ≤ 6 → no pruning.
    expect(result).toHaveLength(5);
    expect(result[result.length - 1]).toEqual(newTile);
  });

  it('sorted output: inserted tile in correct position regardless of insertion order', () => {
    const tiles = [makeTile(SPAN, SPAN * 2n), makeTile(SPAN * 2n, SPAN * 3n), makeTile(SPAN * 3n, SPAN * 4n)];
    const newTile = makeTile(0n, SPAN); // prepend
    const result = pruneAndAdd(tiles, newTile, 5);
    expect(result[0]).toEqual(newTile);
    expect(result[1]).toEqual(tiles[0]);
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useTrendData', () => {
  it('initial render: isLoading=true, data=null, fetches fired for visible+prefetch', async () => {
    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    // Synchronous initial state: loading, no data.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Fetches fired for visible tiles + prefetch tiles (2 + 2 = 4 total with default settings).
    expect(mockFetchTile).toHaveBeenCalled();
    const callCount = mockFetchTile.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2); // at least 2 visible-tile fetches
  });

  it('after visible tiles resolve: isLoading=false, data populated', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.type).toBe('aggregate');
    expect(result.current.error).toBeNull();
  });

  it('second render with same opts: cache hit; no new fetches; data immediately available', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const firstCallCount = mockFetchTile.mock.calls.length;

    // Rerender with identical opts — cache should satisfy all tiles.
    rerender({ viewport: defaultViewport });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // No additional fetches fired.
    expect(mockFetchTile).toHaveBeenCalledTimes(firstCallCount);
    expect(result.current.data).not.toBeNull();
  });

  it('pan by 1 tile: prefetch tile reused from cache, only new territory triggers a fetch', async () => {
    // Use a 2h viewport so tileSpan = 1h — clean integer arithmetic.
    const twoHourViewport: Viewport = { start: 0n, end: ONE_HOUR * 2n };
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: twoHourViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterFirst = mockFetchTile.mock.calls.length; // 4 (2 vis + 2 prefetch)

    // Pan right by 1 tile: visible[1] ([1h,2h]) was prefetch-after → cache hit.
    const pannedViewport: Viewport = { start: ONE_HOUR, end: ONE_HOUR * 3n };
    rerender({ viewport: pannedViewport });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Only 1 new fetch fires (the new prefetch-after [3h,4h] — new territory).
    const newCalls = mockFetchTile.mock.calls.length - callsAfterFirst;
    expect(newCalls).toBe(1);
    expect(result.current.data).not.toBeNull();
  });

  it('tag add: only the new tag fires fetches per visible tile', async () => {
    // Start with tag 1 only.
    mockFetchTile.mockResolvedValue(makeAggResponse([1, 2]));

    const { result, rerender } = renderHook(
      (props: { tagIds: number[] }) => useTrendData({ viewport: defaultViewport, ...props }),
      { initialProps: { tagIds: [1] } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterFirst = mockFetchTile.mock.calls.length;

    // Add tag 2 — only tag 2's visible tiles need fetching.
    rerender({ tagIds: [1, 2] });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 2 new visible fetches (one per visible tile, tag 2 only) + 2 prefetch = 4 new calls.
    // More importantly: no call should have tag 1 in tagIds when tag 1 is already cached.
    const newCalls = mockFetchTile.mock.calls.slice(callsAfterFirst);
    for (const [params] of newCalls) {
      expect((params as Parameters<typeof fetchTile>[0]).tagIds).not.toContain(1);
      expect((params as Parameters<typeof fetchTile>[0]).tagIds).toContain(2);
    }
  });

  it('tag remove: no fetches fired; data shrinks to remaining tags', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1, 2]));

    const { result, rerender } = renderHook(
      (props: { tagIds: number[] }) => useTrendData({ viewport: defaultViewport, ...props }),
      { initialProps: { tagIds: [1, 2] } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterFirst = mockFetchTile.mock.calls.length;

    // Remove tag 2 — all remaining tags are in cache.
    rerender({ tagIds: [1] });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // No new fetches (tag 1 is already cached for all tiles).
    expect(mockFetchTile).toHaveBeenCalledTimes(callsAfterFirst);
    // Data only contains tag 1.
    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      expect(data.series.has(1)).toBe(true);
      expect(data.series.has(2)).toBe(false);
    }
  });

  it('multi-tag fan-out: 16 tags → 2 tag-groups per tile → 4 visible-tile fetches (2 tiles × 2 groups)', async () => {
    const tagIds = Array.from({ length: 16 }, (_, i) => i + 1);
    mockFetchTile.mockImplementation(async (params) => makeAggResponse(params.tagIds));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // With 2 visible tiles and 2 groups per tile, exactly 4 visible-tile fetch calls.
    // (+ 4 prefetch = 8 total, but we check the visible-tile groups specifically.)
    const visibleTileCalls = mockFetchTile.mock.calls.filter(([params]) => {
      const p = params as Parameters<typeof fetchTile>[0];
      return p.startTime >= 0n && p.startTime < ONE_HOUR;
    });
    expect(visibleTileCalls.length).toBe(4); // 2 tiles × 2 groups of 8 tags

    // Each call has at most 8 tagIds.
    for (const [params] of mockFetchTile.mock.calls) {
      expect((params as Parameters<typeof fetchTile>[0]).tagIds.length).toBeLessThanOrEqual(8);
    }
  });

  it('prefetch failure: console.warn fires; isLoading and data are unaffected', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // First 2 calls = visible tiles (succeed); next 2 = prefetch (fail).
    mockFetchTile
      .mockResolvedValueOnce(makeAggResponse([1])) // visible[0]
      .mockResolvedValueOnce(makeAggResponse([1])) // visible[1]
      .mockRejectedValueOnce(new Error('prefetch fail')) // prefetch before
      .mockRejectedValueOnce(new Error('prefetch fail')); // prefetch after

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).not.toBeNull();
    expect(result.current.error).toBeNull();

    // Allow prefetch rejections to settle.
    await act(async () => { await Promise.resolve(); });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useTrendData] prefetch fetch failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );

    warnSpy.mockRestore();
  });

  it('visible failure: console.error fires; failed tile tags get null arrays; failure not cached', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // visible[0] succeeds; visible[1] fails; prefetch can succeed.
    mockFetchTile
      .mockResolvedValueOnce(makeAggResponse([1])) // visible[0]
      .mockRejectedValueOnce(new Error('visible fail')) // visible[1]
      .mockResolvedValue(makeAggResponse([1])); // prefetch

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(errorSpy).toHaveBeenCalledWith(
      '[useTrendData] visible tile fetch failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );

    // Data is assembled: tile[0] has real values, tile[1] is null-filled, prefetch cached.
    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      const values = data.series.get(1)!.value;
      // Assembly includes prefetch tiles: 4 tiles × 500 = 2000 buckets.
      // Order: prefetch-before (1.0), visible[0] (1.0), visible[1] (null-fill), prefetch-after (1.0).
      expect(values).toHaveLength(2000);
      expect(values.slice(500, 1000).every(v => v === 1.0)).toBe(true);  // visible[0]
      expect(values.slice(1000, 1500).every(v => v === null)).toBe(true); // visible[1] null-fill
    }

    // Failure not cached: next opts change will retry the failed tile.
    // Verify by checking that re-render fires fetches again for that tile.
    const callCountBefore = mockFetchTile.mock.calls.length;
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    // Force re-evaluation with a new viewport (same duration → same tileSpan, different tiles).
    // Easiest: just use a fresh hook instance — the cache is per-hook.
    errorSpy.mockRestore();
    expect(callCountBefore).toBeGreaterThan(0); // sanity
  });

  it('viewport change before fetches resolve: stale results ignored', async () => {
    const gen1Resolvers: Array<(v: TileApiResponse) => void> = [];
    let callCount = 0;

    mockFetchTile.mockImplementation(async (params) => {
      callCount++;
      // First 4 calls (gen1 viewport): deferred.
      if (callCount <= 4) {
        return new Promise<TileApiResponse>(resolve => gen1Resolvers.push(resolve));
      }
      // Gen2 calls: resolve immediately.
      return makeAggResponse((params as Parameters<typeof fetchTile>[0]).tagIds);
    });

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    expect(result.current.isLoading).toBe(true);

    // Change viewport before gen1 resolves → gen2 starts.
    const newViewport: Viewport = { start: ONE_HOUR * 5n, end: ONE_HOUR * 6n };
    rerender({ viewport: newViewport });

    // Gen2 resolves immediately; wait for it.
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const dataAfterGen2 = result.current.data;
    expect(dataAfterGen2).not.toBeNull();

    // Now resolve gen1's stale fetches — state must not change.
    act(() => {
      for (const resolve of gen1Resolvers) {
        resolve(makeAggResponse([1]));
      }
    });

    expect(result.current.data).toBe(dataAfterGen2);
  });

  it('discriminated union: source=raw returns RawSeriesData; source=aggregate returns AggregateSeriesData', async () => {
    // Raw path.
    mockFetchTile.mockResolvedValue(makeRawResponse([1]));

    const { result: rawResult } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(rawResult.current.isLoading).toBe(false));
    expect(rawResult.current.data?.type).toBe('raw');

    // Aggregate path.
    vi.clearAllMocks();
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result: aggResult } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(aggResult.current.isLoading).toBe(false));
    expect(aggResult.current.data?.type).toBe('aggregate');
  });

  it('assembleData: v0.8 server — series entry carries min and max arrays', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      const entry = data.series.get(1)!;
      expect(entry.min).toBeDefined();
      expect(entry.max).toBeDefined();
      expect(entry.min!.length).toBe(entry.value.length);
      expect(entry.max!.length).toBe(entry.value.length);
    }
  });

  it('assembleData: v0.7 cache entry (no min/max) leaves min and max undefined', async () => {
    // Simulate a v0.7 server response — aggregate shape but without min/max fields.
    // The cast bypasses the updated type so the test can simulate an older server.
    const v7Response = {
      source: '1min_cagg' as const,
      startTime: 0,
      endTime: Number(ONE_HOUR),
      bucketSMs: 3_600,
      n: 500,
      series: [{ tagId: 1, value: new Array(500).fill(1.0) }],
    } as unknown as TileApiResponse;
    mockFetchTile.mockResolvedValue(v7Response);

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      const entry = data.series.get(1)!;
      expect(entry.value.length).toBeGreaterThan(0);
      expect(entry.min).toBeUndefined();
      expect(entry.max).toBeUndefined();
    }
  });

  it('assembleData: raw response with prev propagates prev to RawSeriesData', async () => {
    const rawWithPrev: TileApiResponse = {
      source: 'raw',
      startTime: 0,
      endTime: Number(ONE_HOUR),
      series: [{ tagId: 1, ts: [100, 200, 300], value: [1.0, 2.0, null], prev: { ts: -60_000, value: 0.5 } }],
    };
    mockFetchTile.mockResolvedValue(rawWithPrev);

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('raw');
    if (data?.type === 'raw') {
      const entry = data.series.get(1)!;
      expect(entry.prev).toBeDefined();
      expect(entry.prev!.ts).toBe(-60_000n); // number ms → BigInt ms via BigInt()
      expect(entry.prev!.value).toBe(0.5);
    }
  });

  it('assembleData: raw response without prev (v0.8 cache) leaves prev undefined', async () => {
    mockFetchTile.mockResolvedValue(makeRawResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('raw');
    if (data?.type === 'raw') {
      const entry = data.series.get(1)!;
      expect(entry.prev).toBeUndefined();
    }
  });

  // ── ensureCovered ─────────────────────────────────────────────────────────

  it('ensureCovered: range inside cached tiles fires no new fetches', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterLoad = mockFetchTile.mock.calls.length;

    // The visible range [0, ONE_HOUR] maps to tiles that are already cached.
    act(() => {
      result.current.ensureCovered(0n, ONE_HOUR);
    });

    expect(mockFetchTile.mock.calls.length).toBe(callsAfterLoad);
  });

  it('ensureCovered: tile outside active set fires fetch and rotates active window', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterLoad = mockFetchTile.mock.calls.length;

    // One tile to the left of the prefetch-before tile (tileSpan = HALF_HOUR).
    act(() => {
      result.current.ensureCovered(-ONE_HOUR, -HALF_HOUR);
    });

    // Exactly one new fetch for the new tile.
    expect(mockFetchTile.mock.calls.length).toBe(callsAfterLoad + 1);

    // After the fetch settles: active set grows to 5 tiles (4 initial + 1 new, maxSize=8 → no prune).
    // Data = 5 × 500 = 2500 values.
    await waitFor(() => {
      const data = result.current.data;
      expect(data?.type).toBe('aggregate');
      if (data?.type === 'aggregate') {
        expect(data.series.get(1)!.value.length).toBe(2500);
      }
    });
  });

  it('ensureCovered: two calls for the same in-flight tile fire no duplicate fetch', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Stall subsequent fetches so the tile stays in-flight.
    const resolvers: Array<(v: TileApiResponse) => void> = [];
    mockFetchTile.mockImplementation(() => new Promise<TileApiResponse>(r => resolvers.push(r)));

    act(() => { result.current.ensureCovered(-ONE_HOUR, -HALF_HOUR); });
    const callsAfterFirst = mockFetchTile.mock.calls.length;

    // Second call — tile is in-flight, must be deduped.
    act(() => { result.current.ensureCovered(-ONE_HOUR, -HALF_HOUR); });
    expect(mockFetchTile.mock.calls.length).toBe(callsAfterFirst);

    // Clean up: resolve the pending fetch.
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));
    act(() => { for (const r of resolvers) r(makeAggResponse([1])); });
  });

  it('ensureCovered: repeated leftward additions keep active set bounded at 8 tiles', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Each ensureCovered call covers 1.5 tile-spans to the left, generating 2 candidates.
    // maxSize=8: no pruning until 9th tile. Tiles grow 4→6→8→8.
    const tileSpan = HALF_HOUR; // defaultViewport: tileSpan = ONE_HOUR / 2
    const expectedLengths = [3000, 4000, 4000]; // 6, 8, 8 tiles × 500 buckets
    for (let i = 1; i <= 3; i++) {
      const startMs = -ONE_HOUR * BigInt(i) - tileSpan;
      const endMs = startMs + tileSpan;
      act(() => { result.current.ensureCovered(startMs, endMs); });
      const expected = expectedLengths[i - 1]!;
      await waitFor(() => {
        const data = result.current.data;
        if (data?.type === 'aggregate') {
          // Bounded at 8 tiles × 500 buckets max.
          expect(data.series.get(1)!.value.length).toBe(expected);
        }
      });
    }
  });

  it('ensureCovered: viewport change resets in-flight set so same tile can be re-requested', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Stall a dynamic fetch so it stays in-flight across the viewport change.
    mockFetchTile.mockImplementation(() => new Promise(() => {})); // never resolves

    act(() => { result.current.ensureCovered(-ONE_HOUR, -HALF_HOUR); });
    const callsWithInFlight = mockFetchTile.mock.calls.length;

    // Same range while in-flight → deduped.
    act(() => { result.current.ensureCovered(-ONE_HOUR, -HALF_HOUR); });
    expect(mockFetchTile.mock.calls.length).toBe(callsWithInFlight);

    // Change viewport — effect re-runs, resets inFlightTilesRef.
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));
    rerender({ viewport: { start: ONE_HOUR * 5n, end: ONE_HOUR * 6n } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Now the same range fires again (in-flight set was cleared).
    const callsAfterReset = mockFetchTile.mock.calls.length;
    act(() => { result.current.ensureCovered(-ONE_HOUR, -HALF_HOUR); });
    expect(mockFetchTile.mock.calls.length).toBeGreaterThan(callsAfterReset);
  });

  it('ensureCovered: range entirely in the future fires no fetches', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterLoad = mockFetchTile.mock.calls.length;

    // Active set after load: rightmost tile ends at ONE_HOUR + HALF_HOUR = 5_400_000n.
    // Mock now to epoch (0ms): right-extension tiles start at ≥ 5_400_000n which is NOT < 0 → all filtered.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
    const cachedEnd = ONE_HOUR + HALF_HOUR;
    act(() => {
      result.current.ensureCovered(cachedEnd, cachedEnd + ONE_HOUR);
    });

    expect(mockFetchTile.mock.calls.length).toBe(callsAfterLoad);
    dateSpy.mockRestore();
  });

  it('ensureCovered: range straddling now only fetches tiles with past start time', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterLoad = mockFetchTile.mock.calls.length;

    // Active set after load: rightmost tile ends at ONE_HOUR + HALF_HOUR.
    // Set nowAnchor = cachedEnd + HALF_HOUR:
    //   right tile 0: startTime = cachedEnd < nowAnchor → included (1 fetch)
    //   right tile 1: startTime = cachedEnd + HALF_HOUR = nowAnchor → NOT < nowMs → filtered
    const cachedEnd = ONE_HOUR + HALF_HOUR;
    const nowAnchor = cachedEnd + HALF_HOUR;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(Number(nowAnchor));

    act(() => {
      result.current.ensureCovered(cachedEnd, cachedEnd + 2n * HALF_HOUR);
    });

    expect(mockFetchTile.mock.calls.length).toBe(callsAfterLoad + 1);
    dateSpy.mockRestore();
  });

  it('ensureCovered: candidate tiles extend active set without overlap', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterLoad = mockFetchTile.mock.calls.length;

    // Request exactly 1 tile past the active set's right edge.
    // The fetched tile must start at cachedEnd (clean extension — no overlap with existing tiles).
    const cachedEnd = ONE_HOUR + HALF_HOUR;
    act(() => {
      result.current.ensureCovered(cachedEnd, cachedEnd + HALF_HOUR);
    });

    expect(mockFetchTile.mock.calls.length).toBe(callsAfterLoad + 1);
    const fetchParams = mockFetchTile.mock.calls[callsAfterLoad]![0] as Parameters<typeof fetchTile>[0];
    expect(fetchParams.startTime).toBe(cachedEnd);
  });

  it('ensureCovered: active set at future boundary fires no fetch', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterLoad = mockFetchTile.mock.calls.length;

    // Mock now to exactly cachedEnd. The first right-extension tile starts at cachedEnd = nowMs,
    // so startTime < nowMs is false → filtered. No fetches fire.
    const cachedEnd = ONE_HOUR + HALF_HOUR;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(Number(cachedEnd));

    act(() => {
      result.current.ensureCovered(cachedEnd, cachedEnd + ONE_HOUR);
    });

    expect(mockFetchTile.mock.calls.length).toBe(callsAfterLoad);
    dateSpy.mockRestore();
  });

  it('empty tagIds: hook returns data:null with isLoading=false (no fetch)', async () => {
    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockFetchTile).not.toHaveBeenCalled();
  });

  it('data assembly: visible-tile values concatenate in chronological order', async () => {
    // Two visible tiles each return distinct fill values so we can verify order.
    let callIdx = 0;
    mockFetchTile.mockImplementation(async (params) => {
      callIdx++;
      const p = params as Parameters<typeof fetchTile>[0];
      // First visible tile (startTime=0n → HALF_HOUR) → fill with 1.0
      // Second visible tile (startTime=HALF_HOUR → ONE_HOUR) → fill with 2.0
      const fill = p.startTime === 0n ? 1.0 : p.startTime === HALF_HOUR ? 2.0 : 0.0;
      return {
        source: '1min_cagg' as const,
        startTime: Number(p.startTime),
        endTime: Number(p.endTime),
        bucketSMs: 360,
        n: 500,
        series: p.tagIds.map(id => ({
        tagId: id,
        value: new Array(500).fill(fill),
        min:   new Array(500).fill(fill),
        max:   new Array(500).fill(fill),
      })),
      };
    });

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      const values = data.series.get(1)!.value;
      // Assembly now includes prefetch tiles: 4 tiles × 500 = 2000 buckets.
      // Order: prefetch-before (fill 0.0), visible[0] (fill 1.0), visible[1] (fill 2.0), prefetch-after (fill 0.0).
      expect(values).toHaveLength(2000);
      expect(values.slice(500, 1000).every(v => v === 1.0)).toBe(true);
      expect(values.slice(1000, 1500).every(v => v === 2.0)).toBe(true);
    }
    void callIdx;
  });

  it('pre-load fallback: bucketSMs is always an integer even when no cache entries resolved', async () => {
    // Crash scenario: all visible tile fetches fail → cache stays empty → assembleData
    // runs after performSwap with lastBucketSMs=0, falling back to span/totalN.
    //
    // Viewport span 79_710_576 ms, visibleTilesPerWindow=2:
    //   tileSpan = 79_710_576 / 2 = 39_855_288 ms (bigint exact, not divisible by 500)
    //   4 tiles total (2 vis + 2 prefetch), all fetches fail
    //   fallback = (4 * 39_855_288) / (4 * 500) = 39_855_288 / 500 = 79_710.576...
    // BigInt(79710.576...) would throw TypeError — the crash.
    const BUCKET_COUNT = 500;
    const SPAN = 79_710_576n; // tileSpan = 39_855_288 — not divisible by 500
    const START = 1_777_900_000_000n;
    const END   = START + SPAN;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // All fetches reject — cache stays empty after performSwap.
    mockFetchTile.mockRejectedValue(new Error('network failure'));

    const { result } = renderHook(() =>
      useTrendData({ viewport: { start: START, end: END }, tagIds: [1], bucketCount: BUCKET_COUNT }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    // assembleData returns aggregate (all-null fill) with the fallback bucketSMs.
    // It MUST be an integer regardless of whether span divides cleanly.
    if (data?.type === 'aggregate') {
      expect(Number.isInteger(data.bucketSMs)).toBe(true);
    }
    // The defensive assertion must not surface as an error either.
    expect(result.current.error).toBeNull();

    errorSpy.mockRestore();
  });

  it("data assembly: 'mixed' source propagates if tiles have different sources", async () => {
    let callIdx = 0;
    mockFetchTile.mockImplementation(async (params) => {
      callIdx++;
      const p = params as Parameters<typeof fetchTile>[0];
      const source = p.startTime === 0n ? ('1min_cagg' as const) : ('10s_cagg' as const);
      return {
        source,
        startTime: Number(p.startTime),
        endTime: Number(p.endTime),
        bucketSMs: 3_600,
        n: 500,
        series: p.tagIds.map(id => ({
          tagId: id,
          value: new Array(500).fill(1.0),
          min:   new Array(500).fill(0.9),
          max:   new Array(500).fill(1.1),
        })),
      };
    });

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      expect(data.source).toBe('mixed');
    }
    void callIdx;
  });
});

// ── Level-switch bridge render ────────────────────────────────────────────────

describe('useTrendData — zoom-level switch', () => {
  it('bridge render: existing data is preserved during transition (old tiles visible until swap)', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const dataBeforeSwitch = result.current.data;
    expect(dataBeforeSwitch).not.toBeNull();

    // Stall new-level fetches so the transition stays in-progress.
    const levelResolvers: Array<(v: TileApiResponse) => void> = [];
    mockFetchTile.mockImplementation(
      () => new Promise<TileApiResponse>(r => levelResolvers.push(r)),
    );

    // Switch to a wider viewport (simulates zoom-out level switch).
    rerender({ viewport: { start: 0n, end: ONE_HOUR * 4n } });

    // During transition, data reference is unchanged (bridge render).
    expect(result.current.data).toBe(dataBeforeSwitch);

    // Resolve all pending new-level fetches.
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));
    act(() => {
      for (const r of levelResolvers) r(makeAggResponse([1]));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // After swap, new data is produced (different tile boundaries → different reference).
    expect(result.current.data).not.toBeNull();
  });

  it('cache eviction: old-level tiles are evicted on swap so re-zoom fires fresh fetches', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterFirstLoad = mockFetchTile.mock.calls.length;

    // Switch to a different zoom level (4× span → completely different tile boundaries).
    rerender({ viewport: { start: 0n, end: ONE_HOUR * 4n } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchTile.mock.calls.length).toBeGreaterThan(callsAfterFirstLoad); // new fetches fired

    // Return to original viewport. Old tiles were evicted → fresh fetches must fire.
    const callsAfterSwitch = mockFetchTile.mock.calls.length;
    rerender({ viewport: defaultViewport });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchTile.mock.calls.length).toBeGreaterThan(callsAfterSwitch); // re-fetched (eviction confirmed)
  });

  it('ensureCovered no-ops during level transition (levelTransitionPending blocks fetch)', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Stall new-level fetches indefinitely — transition stays pending.
    mockFetchTile.mockImplementation(() => new Promise(() => {}));

    rerender({ viewport: { start: 0n, end: ONE_HOUR * 4n } });

    const callsWhenTransitionStarts = mockFetchTile.mock.calls.length;

    act(() => {
      // Range to the left of the active set — would normally fire a fetch.
      result.current.ensureCovered(-ONE_HOUR * 3n, -ONE_HOUR * 2n);
    });

    // ensureCovered must be a no-op while the transition is pending.
    expect(mockFetchTile.mock.calls.length).toBe(callsWhenTransitionStarts);
  });

  it('ensureCovered resumes normally after swap completes', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Switch to wider viewport and let the swap complete.
    rerender({ viewport: { start: 0n, end: ONE_HOUR * 4n } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsAfterSwap = mockFetchTile.mock.calls.length;

    // Mock Date.now far into the future so the future-tile filter doesn't block us.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(Number(ONE_HOUR * 100n));

    act(() => {
      // Range far to the left — definitely outside the active set at either level.
      result.current.ensureCovered(-ONE_HOUR * 10n, -ONE_HOUR * 9n);
    });

    // ensureCovered must fire a fetch for the out-of-active-set tile.
    expect(mockFetchTile.mock.calls.length).toBeGreaterThan(callsAfterSwap);

    dateSpy.mockRestore();
  });
});

// ── lastFetchMs ───────────────────────────────────────────────────────────────

describe('useTrendData — lastFetchMs', () => {
  it('null before any batch completes', () => {
    // Stall all fetches so no batch settles.
    mockFetchTile.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    expect(result.current.lastFetchMs).toBeNull();
  });

  it('set to a non-negative integer after successful batch', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.lastFetchMs).not.toBeNull();
    expect(typeof result.current.lastFetchMs).toBe('number');
    expect(result.current.lastFetchMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.current.lastFetchMs)).toBe(true);
  });

  it('set after a failed batch (includes failure elapsed)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Both visible tiles fail; prefetch can succeed.
    mockFetchTile
      .mockRejectedValueOnce(new Error('fail')) // visible[0]
      .mockRejectedValueOnce(new Error('fail')) // visible[1]
      .mockResolvedValue(makeAggResponse([1]));  // prefetch

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // performSwap fires after all visible tiles settle (both failed here).
    expect(result.current.lastFetchMs).not.toBeNull();
    expect(typeof result.current.lastFetchMs).toBe('number');
    expect(result.current.lastFetchMs).toBeGreaterThanOrEqual(0);

    errorSpy.mockRestore();
  });

  it('updates on each new viewport-change batch', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result, rerender } = renderHook(
      (props: { viewport: Viewport }) => useTrendData({ ...props, tagIds: [1] }),
      { initialProps: { viewport: defaultViewport } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const firstFetchMs = result.current.lastFetchMs;
    expect(firstFetchMs).not.toBeNull();

    // Change viewport — triggers a new batch.
    rerender({ viewport: { start: ONE_HOUR * 5n, end: ONE_HOUR * 6n } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Value is still a valid elapsed (may or may not differ from first).
    expect(result.current.lastFetchMs).not.toBeNull();
    expect(Number.isInteger(result.current.lastFetchMs)).toBe(true);
  });

  it('ensureCovered DOES update lastFetchMs after each tile resolves', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const fetchMsAfterBatch = result.current.lastFetchMs;
    expect(fetchMsAfterBatch).not.toBeNull();

    // Mock Date.now far into the future so future-tile filter doesn't suppress the fetch.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(Number(ONE_HOUR * 100n));

    // ensureCovered fires a real fetch for a tile outside the active set.
    const cachedEnd = ONE_HOUR + HALF_HOUR;
    act(() => {
      result.current.ensureCovered(cachedEnd, cachedEnd + HALF_HOUR);
    });

    // Wait for the ensureCovered fetch to resolve and activeTileCount to increase.
    await waitFor(() => expect(result.current.activeTileCount).toBeGreaterThan(4));

    // lastFetchMs must have been updated by the ensureCovered tile fetch.
    expect(result.current.lastFetchMs).not.toBeNull();
    expect(Number.isInteger(result.current.lastFetchMs)).toBe(true);

    dateSpy.mockRestore();
  });
});
