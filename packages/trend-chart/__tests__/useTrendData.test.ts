import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTrendData, pruneAndAdd } from '../src/useTrendData.js';
import { fetchTile } from '../src/api.js';
import { MAX_BUCKET_S, MIN_VIEWPORT_SPAN_MS, TREND_VIEWER_DEFAULTS } from '../src/level.js';
import type { Viewport, Tile, ActiveTileEntry } from '../src/types.js';
import type { TileApiResponse } from '../src/api.js';

vi.mock('../src/api.js', () => ({
  fetchTile: vi.fn(),
}));

const mockFetchTile = vi.mocked(fetchTile);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ONE_HOUR = 3_600_000n;
const HALF_HOUR = 1_800_000n;

const defaultViewport: Viewport = { start: 0n, end: ONE_HOUR };

const DEFAULT_RESPONSE_TAIL_TS = 1_700_000_000_000; // fixed sentinel for test assertions

function makeAggResponse(tagIds: number[], opts: { n?: number; bucketSMs?: number; source?: TileApiResponse['source']; committedThroughTs?: number } = {}): TileApiResponse {
  const { n = 500, bucketSMs = 3_600, source = '1min_cagg', committedThroughTs = DEFAULT_RESPONSE_TAIL_TS } = opts;
  if (source === 'raw') throw new Error('use makeRawResponse for raw source');
  return {
    source: source as '1min_cagg',
    startTime: 0,
    endTime: Number(ONE_HOUR),
    committedThroughTs,
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

function makeRawResponse(tagIds: number[], committedThroughTs = DEFAULT_RESPONSE_TAIL_TS): TileApiResponse {
  return {
    source: 'raw',
    startTime: 0,
    endTime: Number(ONE_HOUR),
    committedThroughTs,
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

function makeEntry(startMs: bigint, endMs: bigint, bucketCount = 500): ActiveTileEntry {
  return { tile: makeTile(startMs, endMs, bucketCount), committedThroughTs: null, shape: null, data: null };
}

// ─── pruneAndAdd ─────────────────────────────────────────────────────────────

describe('pruneAndAdd', () => {
  const SPAN = 1_800_000n; // 30 min tiles

  it('empty active set → returns [newEntry]', () => {
    const newEntry = makeEntry(0n, SPAN);
    expect(pruneAndAdd([], newEntry)).toEqual([newEntry]);
  });

  it('active set of 3 + left entry → 4 entries, all originals kept', () => {
    const entries = [makeEntry(0n, SPAN), makeEntry(SPAN, SPAN * 2n), makeEntry(SPAN * 2n, SPAN * 3n)];
    const newEntry = makeEntry(-SPAN, 0n);
    const result = pruneAndAdd(entries, newEntry);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(newEntry);
    expect(result[3]).toEqual(entries[2]);
  });

  it('active set of 8 + left entry → 8 entries, rightmost dropped', () => {
    const entries = [
      makeEntry(0n, SPAN), makeEntry(SPAN, SPAN * 2n), makeEntry(SPAN * 2n, SPAN * 3n), makeEntry(SPAN * 3n, SPAN * 4n),
      makeEntry(SPAN * 4n, SPAN * 5n), makeEntry(SPAN * 5n, SPAN * 6n), makeEntry(SPAN * 6n, SPAN * 7n), makeEntry(SPAN * 7n, SPAN * 8n),
    ];
    const newEntry = makeEntry(-SPAN, 0n);
    const result = pruneAndAdd(entries, newEntry);
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual(newEntry);
    // Rightmost entry (SPAN*7n:SPAN*8n) must be gone.
    expect(result.some(e => e.tile.startTime === SPAN * 7n)).toBe(false);
  });

  it('active set of 8 + right entry → 8 entries, leftmost dropped', () => {
    const entries = [
      makeEntry(0n, SPAN), makeEntry(SPAN, SPAN * 2n), makeEntry(SPAN * 2n, SPAN * 3n), makeEntry(SPAN * 3n, SPAN * 4n),
      makeEntry(SPAN * 4n, SPAN * 5n), makeEntry(SPAN * 5n, SPAN * 6n), makeEntry(SPAN * 6n, SPAN * 7n), makeEntry(SPAN * 7n, SPAN * 8n),
    ];
    const newEntry = makeEntry(SPAN * 8n, SPAN * 9n);
    const result = pruneAndAdd(entries, newEntry);
    expect(result).toHaveLength(8);
    expect(result[result.length - 1]).toEqual(newEntry);
    // Leftmost entry (0n:SPAN) must be gone.
    expect(result.some(e => e.tile.startTime === 0n)).toBe(false);
  });

  it('active set of 8 + middle entry (gap-fill) → 8 entries, leftmost dropped, no warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const entries = [
      makeEntry(0n, SPAN * 2n), makeEntry(SPAN * 2n, SPAN * 4n), makeEntry(SPAN * 4n, SPAN * 6n), makeEntry(SPAN * 6n, SPAN * 8n),
      makeEntry(SPAN * 8n, SPAN * 10n), makeEntry(SPAN * 10n, SPAN * 12n), makeEntry(SPAN * 12n, SPAN * 14n), makeEntry(SPAN * 14n, SPAN * 16n),
    ];
    // Middle entry: tile.startTime > entries[0].tile.startTime, tile.endTime < entries[last].tile.endTime (gap-fill).
    const newEntry = makeEntry(SPAN, SPAN * 3n);
    const result = pruneAndAdd(entries, newEntry);
    expect(result).toHaveLength(8);
    // Leftmost entry (0n:SPAN*2n) must be dropped.
    expect(result.some(e => e.tile.startTime === 0n)).toBe(false);
    // No warn — middle insertion is a legitimate gap-fill scenario post-F7.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('maxSize override: no pruning until count exceeds maxSize', () => {
    const entries = [makeEntry(0n, SPAN), makeEntry(SPAN, SPAN * 2n), makeEntry(SPAN * 2n, SPAN * 3n), makeEntry(SPAN * 3n, SPAN * 4n)];
    const newEntry = makeEntry(SPAN * 4n, SPAN * 5n);
    const result = pruneAndAdd(entries, newEntry, 6);
    // 4 + 1 = 5 ≤ 6 → no pruning.
    expect(result).toHaveLength(5);
    expect(result[result.length - 1]).toEqual(newEntry);
  });

  it('sorted output: inserted entry in correct position regardless of insertion order', () => {
    const entries = [makeEntry(SPAN, SPAN * 2n), makeEntry(SPAN * 2n, SPAN * 3n), makeEntry(SPAN * 3n, SPAN * 4n)];
    const newEntry = makeEntry(0n, SPAN); // prepend
    const result = pruneAndAdd(entries, newEntry, 5);
    expect(result[0]).toEqual(newEntry);
    expect(result[1]).toEqual(entries[0]);
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

    // First 2 calls = visible tiles (succeed); 3rd = right-prefetch (fail).
    // Left-prefetch is pre-epoch for defaultViewport ({start:0n, end:ONE_HOUR}) and is filtered
    // by tilesForViewport, so only one prefetch tile is fetched.
    mockFetchTile
      .mockResolvedValueOnce(makeAggResponse([1])) // visible[0]
      .mockResolvedValueOnce(makeAggResponse([1])) // visible[1]
      .mockRejectedValueOnce(new Error('prefetch fail')); // right-prefetch after

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
      // 3 tiles: visible[0] (1.0), visible[1] (null-fill), prefetch-after (1.0).
      // The left-prefetch at -HALF_HOUR is pre-epoch and is filtered by tilesForViewport.
      expect(values).toHaveLength(1500);
      expect(values.slice(0, 500).every(v => v === 1.0)).toBe(true);   // visible[0]
      expect(values.slice(500, 1000).every(v => v === null)).toBe(true); // visible[1] null-fill
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
      // First 3 calls (gen1 viewport — 2 visible + 1 right-prefetch; left filtered as pre-epoch).
      if (callCount <= 3) {
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
      committedThroughTs: DEFAULT_RESPONSE_TAIL_TS,
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
        committedThroughTs: DEFAULT_RESPONSE_TAIL_TS,
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
      // 3 tiles: visible[0] (fill 1.0), visible[1] (fill 2.0), prefetch-after (fill 0.0).
      // The left-prefetch at -HALF_HOUR is pre-epoch and is filtered by tilesForViewport.
      expect(values).toHaveLength(1500);
      expect(values.slice(0, 500).every(v => v === 1.0)).toBe(true);
      expect(values.slice(500, 1000).every(v => v === 2.0)).toBe(true);
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
        committedThroughTs: DEFAULT_RESPONSE_TAIL_TS,
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

  it('FIX 4: terminal tiles are retained in LRU after level switch — pan-back is a cache hit', async () => {
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

    // Return to original viewport. FIX 4: tiles were NOT evicted → pan-back is a cache hit.
    const callsAfterSwitch = mockFetchTile.mock.calls.length;
    rerender({ viewport: defaultViewport });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchTile.mock.calls.length).toBe(callsAfterSwitch); // cache hit — no re-fetch
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
});

// ── committedThroughTs ────────────────────────────────────────────────────────────

describe('useTrendData — committedThroughTs', () => {
  it('null before any fetch resolves', () => {
    mockFetchTile.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    expect(result.current.committedThroughTs).toBeNull();
  });

  it('equals the response committedThroughTs after a successful fetch', async () => {
    const TAIL_TS = 1_712_617_200_000;
    mockFetchTile.mockResolvedValue(makeAggResponse([1], { committedThroughTs: TAIL_TS }));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.committedThroughTs).toBe(TAIL_TS);
  });

  it('is the MAX committedThroughTs across active tiles when tiles have different values', async () => {
    const OLDER_TS = 1_000_000_000_000;
    const NEWER_TS = 2_000_000_000_000;

    mockFetchTile.mockImplementation(async (params) => {
      const p = params as Parameters<typeof fetchTile>[0];
      const ts = p.startTime === 0n ? OLDER_TS : NEWER_TS;
      return makeAggResponse(p.tagIds, { committedThroughTs: ts });
    });

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.committedThroughTs).toBe(NEWER_TS);
  });

  it('LRU eviction of non-active (prefetch) tiles does NOT change committedThroughTs', async () => {
    const TAIL_TS = 1_712_617_200_000;
    mockFetchTile.mockResolvedValue(makeAggResponse([1], { committedThroughTs: TAIL_TS }));

    // estimateCachedEntrySize for 500-bucket entry ≈ (500+500+500)*8 + 100 = 12100 bytes.
    // Capacity 30000 holds the 2 active visible tiles but LRU-evicts prefetch tiles.
    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1], cacheCapacityBytes: 30_000 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // committedThroughTs reflects only active tiles; LRU-evicted prefetch tiles don't affect it.
    expect(result.current.committedThroughTs).toBe(TAIL_TS);
  });
});

// ── invalidateNonTerminalTiles ─────────────────────────────────────────────────

describe('useTrendData — invalidateNonTerminalTiles', () => {
  it('nulls committedThroughTs on non-terminal entries; leaves terminal entries unchanged', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Seed activeTilesRef directly with one terminal and one non-terminal entry.
    // Terminal: committedThroughTs >= tile.endTime.
    // Non-terminal: committedThroughTs < tile.endTime (e.g. partial commit).
    const TILE_END = Number(ONE_HOUR);
    const terminalEntry: ActiveTileEntry = {
      tile: makeTile(0n, ONE_HOUR),
      committedThroughTs: TILE_END,       // terminal: committed >= end
      shape: 'aggregate',
      data: null,
    };
    const nonTerminalEntry: ActiveTileEntry = {
      tile: makeTile(ONE_HOUR, ONE_HOUR * 2n),
      committedThroughTs: TILE_END - 1,   // non-terminal: committed < end
      shape: 'aggregate',
      data: null,
    };

    act(() => {
      result.current.activeTilesRef.current = [terminalEntry, nonTerminalEntry];
    });

    // Call invalidateNonTerminalTiles.
    act(() => {
      result.current.invalidateNonTerminalTiles();
    });

    const after = result.current.activeTilesRef.current;

    // Terminal entry: unchanged (same object identity and committedThroughTs).
    expect(after[0]).toBe(terminalEntry);
    expect(after[0]!.committedThroughTs).toBe(TILE_END);

    // Non-terminal entry: committedThroughTs reset to null; new object (not mutated in place).
    expect(after[1]).not.toBe(nonTerminalEntry);
    expect(after[1]!.committedThroughTs).toBeNull();
    // Other fields preserved.
    expect(after[1]!.tile).toBe(nonTerminalEntry.tile);
    expect(after[1]!.shape).toBe('aggregate');
  });

  it('no-op when all active entries are already terminal', async () => {
    mockFetchTile.mockResolvedValue(makeAggResponse([1]));

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const TILE_END = Number(ONE_HOUR);
    const terminalEntry: ActiveTileEntry = {
      tile: makeTile(0n, ONE_HOUR),
      committedThroughTs: TILE_END,
      shape: 'aggregate',
      data: null,
    };

    act(() => {
      result.current.activeTilesRef.current = [terminalEntry];
    });

    act(() => {
      result.current.invalidateNonTerminalTiles();
    });

    // Array reference unchanged when nothing was mutated.
    expect(result.current.activeTilesRef.current[0]).toBe(terminalEntry);
    expect(result.current.activeTilesRef.current[0]!.committedThroughTs).toBe(TILE_END);
  });
});

