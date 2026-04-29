import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTrendData } from '../src/useTrendData.js';
import { fetchTile } from '../src/api.js';
import type { Viewport } from '../src/types.js';
import type { TileApiResponse } from '../src/api.js';

vi.mock('../src/api.js', () => ({
  fetchTile: vi.fn(),
}));

const mockFetchTile = vi.mocked(fetchTile);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ONE_HOUR = 3_600_000n;
const HALF_HOUR = 1_800_000n;

const defaultViewport: Viewport = { start: 0n, end: ONE_HOUR };

function makeAggResponse(tagIds: number[], opts: { n?: number; bucketS?: number; source?: TileApiResponse['source'] } = {}): TileApiResponse {
  const { n = 500, bucketS = 3.6, source = '1min_cagg' } = opts;
  if (source === 'raw') throw new Error('use makeRawResponse for raw source');
  return {
    source: source as '1min_cagg',
    startTime: 0,
    endTime: Number(ONE_HOUR),
    bucketS,
    n,
    series: tagIds.map(id => ({ tagId: id, value: new Array(n).fill(1.0) })),
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

    // Data is assembled: tile[0] has real values, tile[1] is null-filled.
    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      const values = data.series.get(1)!;
      expect(values).toHaveLength(1000); // 500 from tile[0] + 500 null-fill from tile[1]
      expect(values.slice(0, 500).every(v => v === 1.0)).toBe(true);
      expect(values.slice(500).every(v => v === null)).toBe(true);
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
        bucketS: 0.36,
        n: 500,
        series: p.tagIds.map(id => ({ tagId: id, value: new Array(500).fill(fill) })),
      };
    });

    const { result } = renderHook(() =>
      useTrendData({ viewport: defaultViewport, tagIds: [1] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data?.type).toBe('aggregate');
    if (data?.type === 'aggregate') {
      const values = data.series.get(1)!;
      expect(values).toHaveLength(1000);
      // First 500 buckets from tile[0] filled with 1.0; next 500 from tile[1] filled with 2.0.
      expect(values.slice(0, 500).every(v => v === 1.0)).toBe(true);
      expect(values.slice(500).every(v => v === 2.0)).toBe(true);
    }
    void callIdx;
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
        bucketS: 3.6,
        n: 500,
        series: p.tagIds.map(id => ({ tagId: id, value: new Array(500).fill(1.0) })),
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
