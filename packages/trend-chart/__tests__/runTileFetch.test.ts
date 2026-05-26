import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTileFetch, needsFetch } from '../src/runTileFetch.js';
import type { TileFetchArgs } from '../src/runTileFetch.js';
import { TileCache, makeTileCacheKey } from '../src/tileCache.js';
import { estimateCachedEntrySize } from '../src/tileActiveSet.js';
import { REFETCH_LAG_MS } from '../src/level.js';
import type { CachedEntry, HookState } from '../src/tileActiveSet.js';
import type { ActiveTileEntry, AggregateSeriesData, Tile } from '../src/types.js';
import type { TileApiResponse } from '../src/api.js';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';

// ── Mock tilesForViewport to control which tiles the function sees ─────────────

const levelHoisted = vi.hoisted(() => ({ tilesForViewport: vi.fn() }));

vi.mock('../src/level.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/level.js')>();
  return { ...actual, tilesForViewport: levelHoisted.tilesForViewport };
});

// ── Tile fixtures ─────────────────────────────────────────────────────────────

const TILE_A: Tile = { startTime: 0n, endTime: 1_000_000n, bucketCount: 500 };
const TILE_B: Tile = { startTime: 1_000_000n, endTime: 2_000_000n, bucketCount: 500 };
const TILE_C: Tile = { startTime: 2_000_000n, endTime: 3_000_000n, bucketCount: 500 };

/** nowMs=0 keeps all test tiles (endTime ~1-3s from epoch) in the "future" from nowMs's
 *  perspective, so the "tile rolled comfortably into the past" branch never fires in most tests. */
const FAR_FUTURE_MS = 0n;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache(): TileCache<CachedEntry> {
  return new TileCache<CachedEntry>({ capacityBytes: 50 * 1024 * 1024, estimateSize: estimateCachedEntrySize });
}

/** Terminal response: committedThroughTs >= tile.endTime → entry goes to LRU. */
function makeTerminalResponse(tile: Tile, tagId = 1): TileApiResponse {
  return {
    source: '1min_cagg',
    startTime: Number(tile.startTime),
    endTime: Number(tile.endTime),
    committedThroughTs: Number(tile.endTime) + 1000,
    bucketSMs: 3600,
    n: 500,
    series: [{
      tagId,
      value: new Array<number>(500).fill(1.0),
      min:   new Array<number>(500).fill(0.9),
      max:   new Array<number>(500).fill(1.1),
    }],
  };
}

/** Non-terminal response: committedThroughTs < tile.endTime → entry held in entry.data. */
function makeNonTerminalResponse(tile: Tile, tagId = 1): TileApiResponse {
  return {
    source: '1min_cagg',
    startTime: Number(tile.startTime),
    endTime: Number(tile.endTime),
    committedThroughTs: Number(tile.endTime) - 5000,
    bucketSMs: 3600,
    n: 500,
    series: [{
      tagId,
      value: new Array<number>(500).fill(1.0),
      min:   new Array<number>(500).fill(0.9),
      max:   new Array<number>(500).fill(1.1),
    }],
  };
}

function makeAggData(tile: Tile): AggregateSeriesData {
  return {
    type: 'aggregate', source: '1min_cagg',
    startTime: tile.startTime, endTime: tile.endTime,
    n: 1, bucketSMs: 60000, series: new Map(),
  };
}

/** Builds a live-edge (non-terminal) entry with data held in entry.data. */
function makeNonTerminalEntry(tile: Tile): ActiveTileEntry {
  return {
    tile,
    committedThroughTs: Number(tile.endTime) - 5000,
    shape: 'aggregate',
    data: makeAggData(tile),
  };
}

/** Builds a terminal entry (data=null; data lives in cache). */
function makeTerminalEntry(tile: Tile, committedThroughTs: number): ActiveTileEntry {
  return { tile, committedThroughTs, shape: 'aggregate', data: null };
}

/** Seeds the cache with a terminal entry for the given tile/tagId. */
function seedCache(cache: TileCache<CachedEntry>, tile: Tile, tagId: number, committedThroughTs: number): void {
  cache.set(
    makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
    { source: '1min_cagg', committedThroughTs, bucketSMs: 3600, n: 500, value: [1.0], min: [0.9], max: [1.1] },
  );
}

/** Builds minimal TileFetchArgs with sane defaults. */
function makeArgs(
  cache: TileCache<CachedEntry>,
  overrides: Partial<TileFetchArgs> = {},
): TileFetchArgs {
  const tagIds = overrides.tagIds ?? [1];
  return {
    tagIds,
    bucketCount: 500,
    tileSpanMs: 500_000n,
    overfetchPerSide: 0,
    viewport: { start: 0n, end: 1_000_000n },
    isLive: true,
    cache,
    activeTilesRef: { current: [] } as MutableRefObject<ActiveTileEntry[]>,
    inFlightTilesRef: { current: new Set<string>() } as MutableRefObject<Set<string>>,
    tagGenerationRef: { current: 0 } as MutableRefObject<number>,
    tagIdsRef: { current: [...tagIds] } as MutableRefObject<number[]>,
    visibleKeysRef: { current: new Set<string>() } as MutableRefObject<Set<string>>,
    setHookResult: vi.fn() as Dispatch<SetStateAction<HookState>>,
    gatedFetchTile: vi.fn(),
    nowMs: FAR_FUTURE_MS,
    commit: vi.fn(),
    firstFetchFiredAtRef: { current: null } as MutableRefObject<number | null>,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_A], prefetch: [] });
});

/** Flushes pending microtasks — covers the Promise.all → .then() chain inside runTileFetch. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ── §5.2 freshness predicate unit tests (all 8 branches) ─────────────────────

describe('needsFetch — §5.2 freshness predicate', () => {
  const viewportEnd = TILE_A.endTime;

  it('branch 1: all tags in LRU cache → false', () => {
    const cache = makeCache();
    seedCache(cache, TILE_A, 1, Number(TILE_A.endTime) + 1000);
    expect(needsFetch(TILE_A, [1], cache, [], false, FAR_FUTURE_MS, viewportEnd)).toBe(false);
  });

  it('branch 2: no active entry for tile → true', () => {
    const cache = makeCache();
    expect(needsFetch(TILE_A, [1], cache, [], false, FAR_FUTURE_MS, viewportEnd)).toBe(true);
  });

  it('branch 3: active entry has committedThroughTs=null → true', () => {
    const cache = makeCache();
    const entry: ActiveTileEntry = { tile: TILE_A, committedThroughTs: null, shape: null, data: null };
    expect(needsFetch(TILE_A, [1], cache, [entry], false, FAR_FUTURE_MS, viewportEnd)).toBe(true);
  });

  it('branch 4: tile.endTime <= nowMs - REFETCH_LAG_MS → true (rolled out)', () => {
    const cache = makeCache();
    const entry: ActiveTileEntry = { tile: TILE_A, committedThroughTs: Number(TILE_A.endTime) + 100, shape: 'aggregate', data: null };
    // nowMs is exactly REFETCH_LAG_MS past tile.endTime
    const nowMs = TILE_A.endTime + BigInt(REFETCH_LAG_MS);
    expect(needsFetch(TILE_A, [1], cache, [entry], false, nowMs, viewportEnd)).toBe(true);
  });

  it('live mode → false (WS tail handles steady state; invalidateNonTerminalTiles handles Fixed→Live)', () => {
    const cache = makeCache();
    const entry = makeNonTerminalEntry(TILE_A);
    expect(needsFetch(TILE_A, [1], cache, [entry], true, FAR_FUTURE_MS, viewportEnd)).toBe(false);
  });

  it('fixed mode, committedThroughTs < viewport.end → true (stale historical)', () => {
    const cache = makeCache();
    const entry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: Number(viewportEnd) - 1,
      shape: 'aggregate',
      data: null,
    };
    expect(needsFetch(TILE_A, [1], cache, [entry], false, FAR_FUTURE_MS, viewportEnd)).toBe(true);
  });

  it('fixed mode, committedThroughTs >= viewport.end → false (fresh historical)', () => {
    const cache = makeCache();
    const entry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: Number(viewportEnd),
      shape: 'aggregate',
      data: null,
    };
    expect(needsFetch(TILE_A, [1], cache, [entry], false, FAR_FUTURE_MS, viewportEnd)).toBe(false);
  });

  it('multi-tag: any tag missing from LRU proceeds to entry check', () => {
    const cache = makeCache();
    // tagId 1 is cached; tagId 2 is not
    seedCache(cache, TILE_A, 1, Number(TILE_A.endTime) + 1000);
    // No active entry → entry absent → true
    expect(needsFetch(TILE_A, [1, 2], cache, [], false, FAR_FUTURE_MS, viewportEnd)).toBe(true);
  });
});

// ── runTileFetch: STORM GUARD regression tests ────────────────────────────────

describe('STORM GUARD: live mode — no spurious re-fetches', () => {
  it('same tile + non-terminal entry → pure no-op (no fetch, no commit)', () => {
    const cache = makeCache();
    const entry = makeNonTerminalEntry(TILE_A);
    const gatedFetchTile = vi.fn();
    const commit = vi.fn();
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [entry] };

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, commit, activeTilesRef,
      isLive: true,
      nowMs: FAR_FUTURE_MS,
    }));

    expect(gatedFetchTile).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    // Pure no-op: activeTilesRef unchanged
    expect(activeTilesRef.current[0]).toBe(entry);
  });

  it('same tile + any committedThroughTs in live mode → no fetch (isLive branch returns false)', () => {
    const cache = makeCache();
    const viewport = { start: 0n, end: 1_000_000n };
    const entry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: Number(TILE_A.endTime) - 5000,
      shape: 'aggregate',
      data: makeAggData(TILE_A),
    };
    const gatedFetchTile = vi.fn();
    const commit = vi.fn();
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [entry] };

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, commit, activeTilesRef,
      isLive: true, viewport, nowMs: FAR_FUTURE_MS,
    }));

    expect(gatedFetchTile).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

// ── runTileFetch: viewport boundary and cache-hit cases ──────────────────────

describe('runTileFetch: viewport boundary and cache cases', () => {
  it('new tile (no active entry) → fetch fires', async () => {
    const cache = makeCache();
    const gatedFetchTile = vi.fn().mockResolvedValue(makeTerminalResponse(TILE_A));

    runTileFetch(makeArgs(cache, { gatedFetchTile }));
    await flushAsync();

    expect(gatedFetchTile).toHaveBeenCalledTimes(1);
  });

  it('boundary crossing: viewport moved to new tile → fetch fires, commit called', async () => {
    const cache = makeCache();
    const entry = makeNonTerminalEntry(TILE_A);
    const gatedFetchTile = vi.fn().mockResolvedValue(makeTerminalResponse(TILE_B));
    const commit = vi.fn();
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [entry] };

    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_B], prefetch: [] });

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, commit, activeTilesRef,
      isLive: true, nowMs: FAR_FUTURE_MS,
    }));
    await flushAsync();

    expect(gatedFetchTile).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalled();
  });

  it('all-cached region pan: different tile keys but both in LRU → no fetch, commit fires', async () => {
    const cache = makeCache();
    // Both TILE_A and TILE_B cached
    seedCache(cache, TILE_A, 1, Number(TILE_A.endTime) + 1000);
    seedCache(cache, TILE_B, 1, Number(TILE_B.endTime) + 1000);
    const entry = makeTerminalEntry(TILE_A, Number(TILE_A.endTime) + 1000);
    const gatedFetchTile = vi.fn();
    const commit = vi.fn();
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [entry] };

    // Viewport panned to TILE_B
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_B], prefetch: [] });

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, commit, activeTilesRef,
      isLive: false,
      viewport: { start: TILE_B.startTime, end: TILE_B.endTime },
      nowMs: FAR_FUTURE_MS,
    }));
    await flushAsync();

    // No network fetch, but commit fires to update activeTilesRef.
    expect(gatedFetchTile).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalled();
  });
});

// ── FIX 4: Terminal tiles are not evicted when rolling out of the active set ──

describe('FIX 4: terminal tiles retained in LRU after roll-out', () => {
  it('terminal tile remains in LRU when it rolls out of the active set', async () => {
    const cache = makeCache();
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [] };

    // Run 1: TILE_A is visible. Genuine miss → terminal response → cached.
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_A], prefetch: [] });
    const gatedFetchTile = vi.fn().mockResolvedValue(makeTerminalResponse(TILE_A));
    runTileFetch(makeArgs(cache, { gatedFetchTile, activeTilesRef, inFlightTilesRef }));
    await flushAsync();

    const keyA = makeTileCacheKey({ tagId: 1, startTime: TILE_A.startTime, endTime: TILE_A.endTime, bucketCount: TILE_A.bucketCount });
    expect(cache.has(keyA)).toBe(true);

    // Run 2: viewport rolls to TILE_B.
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_B], prefetch: [] });
    gatedFetchTile.mockResolvedValue(makeTerminalResponse(TILE_B));
    runTileFetch(makeArgs(cache, {
      gatedFetchTile, activeTilesRef, inFlightTilesRef,
    }));
    await flushAsync();

    // FIX 4: TILE_A must still be in the LRU (not deleted by any eviction).
    expect(cache.has(keyA)).toBe(true);
  });

  it('rolled-back tile is a cache hit — no new fetch on pan-back', async () => {
    const cache = makeCache();
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [] };
    const gatedFetchTile = vi.fn();

    // Run 1: fetch TILE_A → terminal, cached.
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_A], prefetch: [] });
    gatedFetchTile.mockResolvedValue(makeTerminalResponse(TILE_A));
    runTileFetch(makeArgs(cache, { gatedFetchTile, activeTilesRef, inFlightTilesRef }));
    await flushAsync();
    const callsAfterRun1 = gatedFetchTile.mock.calls.length;

    // Run 2: roll to TILE_B.
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_B], prefetch: [] });
    gatedFetchTile.mockResolvedValue(makeTerminalResponse(TILE_B));
    runTileFetch(makeArgs(cache, {
      gatedFetchTile, activeTilesRef, inFlightTilesRef,
    }));
    await flushAsync();

    // Run 3: roll back to TILE_A — must be a cache hit, no new fetch.
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_A], prefetch: [] });
    runTileFetch(makeArgs(cache, {
      gatedFetchTile, activeTilesRef, inFlightTilesRef,
    }));
    await flushAsync();

    expect(gatedFetchTile.mock.calls.length).toBe(callsAfterRun1 + 1);
  });
});

// ── §5.6 DUPLICATE-FETCH REGRESSION ──────────────────────────────────────────

describe('§5.6 DUPLICATE-FETCH REGRESSION: inFlightTilesRef dedup across runs', () => {
  it('3 synchronous runs before first fetch resolves → gatedFetchTile called exactly once per tile', async () => {
    const cache = makeCache();
    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn().mockImplementation(
      () => new Promise<TileApiResponse>(r => { resolveA = r; }),
    );
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const tagGenerationRef: MutableRefObject<number> = { current: 0 };
    const tagIdsRef: MutableRefObject<number[]> = { current: [1] };
    const visibleKeysRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [] };
    const commit = vi.fn();

    const sharedArgs = makeArgs(cache, {
      gatedFetchTile, inFlightTilesRef, tagGenerationRef, tagIdsRef, visibleKeysRef,
      activeTilesRef, commit,
    });

    // 3 synchronous runs — only the first should fire gatedFetchTile.
    runTileFetch(sharedArgs);
    runTileFetch(sharedArgs);
    runTileFetch(sharedArgs);

    expect(gatedFetchTile).toHaveBeenCalledTimes(1);

    // Resolve; commit should fire.
    resolveA(makeTerminalResponse(TILE_A));
    await flushAsync();

    expect(commit).toHaveBeenCalled();
  });

  it('in-flight key cleared on resolve — next run re-fetches if predicate fires (committedThroughTs=null)', async () => {
    const cache = makeCache();
    // Use fixed mode + committedThroughTs=null to trigger branch 2 (entry.committedThroughTs === null → true).
    const viewport = { start: 0n, end: 1_000_000n };
    const nullEntry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: null,
      shape: null,
      data: null,
    };

    let resolveFirst: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn()
      .mockImplementationOnce(() => new Promise<TileApiResponse>(r => { resolveFirst = r; }))
      .mockResolvedValue(makeNonTerminalResponse(TILE_A));

    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [nullEntry] };

    // Run 1: committedThroughTs=null → fire fetch (pending).
    runTileFetch(makeArgs(cache, {
      gatedFetchTile, inFlightTilesRef, activeTilesRef,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));
    expect(gatedFetchTile).toHaveBeenCalledTimes(1);
    expect(inFlightTilesRef.current.size).toBe(1);

    // Run 2 before resolve — same tile still in flight → no new fetch.
    runTileFetch(makeArgs(cache, {
      gatedFetchTile, inFlightTilesRef, activeTilesRef,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));
    expect(gatedFetchTile).toHaveBeenCalledTimes(1);

    // Settle run 1's fetch (non-terminal — committedThroughTs still < viewportEnd).
    resolveFirst(makeNonTerminalResponse(TILE_A));
    await flushAsync();

    // Key deleted from inFlight. Entry.committedThroughTs < viewportEnd → run 3 can re-fetch.
    expect(inFlightTilesRef.current.size).toBe(0);
    runTileFetch(makeArgs(cache, {
      gatedFetchTile, inFlightTilesRef, activeTilesRef,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));
    expect(gatedFetchTile).toHaveBeenCalledTimes(2);
  });
});

// ── §5.6 RUN-INDEPENDENT RESOLVE ─────────────────────────────────────────────

describe('§5.6 run-independent resolve: result applied regardless of later runs', () => {
  it('terminal resolve patches activeTilesRef and commits after 2 extra runs pre-resolve', async () => {
    const cache = makeCache();
    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn().mockImplementation(
      () => new Promise<TileApiResponse>(r => { resolveA = r; }),
    );
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const tagGenerationRef: MutableRefObject<number> = { current: 0 };
    const tagIdsRef: MutableRefObject<number[]> = { current: [1] };
    const visibleKeysRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [] };
    const commit = vi.fn();

    const sharedArgs = makeArgs(cache, {
      gatedFetchTile, inFlightTilesRef, tagGenerationRef, tagIdsRef, visibleKeysRef,
      activeTilesRef, commit,
    });

    // Run 1 fires the fetch; runs 2 and 3 are no-ops (in-flight guard).
    runTileFetch(sharedArgs);
    runTileFetch(sharedArgs);
    runTileFetch(sharedArgs);

    const commitCallsBefore = (commit as ReturnType<typeof vi.fn>).mock.calls.length;

    // Resolve — result must land in the active set.
    resolveA(makeTerminalResponse(TILE_A));
    await flushAsync();

    expect((commit as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(commitCallsBefore);
    // Terminal: data=null (entry reads from LRU); LRU has the tile.
    expect(activeTilesRef.current[0]?.committedThroughTs).toBeGreaterThan(0);
    expect(activeTilesRef.current[0]?.data).toBeNull();
  });

  it('non-terminal resolve patches entry.data in place', async () => {
    const cache = makeCache();
    // Use fixed mode + stale committedThroughTs (< viewport.end) to trigger the predicate.
    const nullEntry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: null,
      shape: null,
      data: null,
    };
    const viewport = { start: 0n, end: 1_000_000n };

    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn().mockImplementation(
      () => new Promise<TileApiResponse>(r => { resolveA = r; }),
    );
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [nullEntry] };
    const commit = vi.fn();

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, inFlightTilesRef, activeTilesRef, commit,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    // Resolve non-terminal.
    resolveA(makeNonTerminalResponse(TILE_A));
    await flushAsync();

    // entry.data should be populated (non-terminal).
    expect(activeTilesRef.current[0]?.data).not.toBeNull();
    expect(commit).toHaveBeenCalled();
  });
});

// ── §5.6 TAG GENERATION: non-terminal stale drop on tag change ────────────────

describe('§5.6 tag generation: non-terminal resolves respect tagGenerationRef', () => {
  it('non-terminal result dropped when tagGenerationRef advanced before resolve', async () => {
    const cache = makeCache();
    // Use fixed mode + committedThroughTs=null so the predicate fires.
    const nullEntry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: null,
      shape: null,
      data: null,
    };
    const viewport = { start: 0n, end: 1_000_000n };

    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn().mockImplementation(
      () => new Promise<TileApiResponse>(r => { resolveA = r; }),
    );
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const tagGenerationRef: MutableRefObject<number> = { current: 0 };
    const tagIdsRef: MutableRefObject<number[]> = { current: [1] };
    const visibleKeysRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [nullEntry] };
    const commit = vi.fn();

    // Run 1: fires a non-terminal fetch with gen=0.
    runTileFetch(makeArgs(cache, {
      tagIds: [1],
      gatedFetchTile, inFlightTilesRef, tagGenerationRef, tagIdsRef,
      visibleKeysRef, activeTilesRef, commit,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    // Tag change before resolve → bump generation.
    tagGenerationRef.current++;
    tagIdsRef.current = [1, 2];

    const commitCallsBefore = (commit as ReturnType<typeof vi.fn>).mock.calls.length;

    // Resolve with non-terminal — gen mismatch → must NOT patch activeTilesRef, must NOT commit.
    resolveA(makeNonTerminalResponse(TILE_A));
    await flushAsync();

    expect((commit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(commitCallsBefore);
    // Active entry unchanged (still the original staleEntry, or the one set by step 7).
    // The key invariant: commit was NOT called by the non-terminal resolve.
  });

  it('terminal result writes LRU even when tagGenerationRef advanced', async () => {
    const cache = makeCache();
    // Use fixed mode + committedThroughTs=null so the predicate fires.
    const nullEntry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: null,
      shape: null,
      data: null,
    };
    const viewport = { start: 0n, end: 1_000_000n };

    const gatedFetchTile = vi.fn().mockResolvedValue(makeTerminalResponse(TILE_A));
    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const tagGenerationRef: MutableRefObject<number> = { current: 0 };
    const tagIdsRef: MutableRefObject<number[]> = { current: [1] };
    const visibleKeysRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [nullEntry] };

    runTileFetch(makeArgs(cache, {
      tagIds: [1],
      gatedFetchTile, inFlightTilesRef, tagGenerationRef, tagIdsRef,
      visibleKeysRef, activeTilesRef,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    // Tag change before resolve.
    tagGenerationRef.current++;

    await flushAsync();

    // LRU must have the terminal entry regardless.
    const keyA = makeTileCacheKey({ tagId: 1, startTime: TILE_A.startTime, endTime: TILE_A.endTime, bucketCount: TILE_A.bucketCount });
    expect(cache.has(keyA)).toBe(true);
  });
});

// ── §5.6 VIEWPORT MOVE BEFORE RESOLVE ────────────────────────────────────────

describe('§5.6 viewport move before resolve: stale result dropped for non-terminal', () => {
  it('regression: committedThroughTs < tile.endTime → non-terminal, NOT cached', async () => {
    const cache = makeCache();
    // Fixed mode: committedThroughTs=null triggers the predicate (branch 2).
    const nullEntry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: null,
      shape: null,
      data: null,
    };
    const viewport = { start: 0n, end: 1_000_000n };

    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn().mockImplementation(
      () => new Promise<TileApiResponse>(r => { resolveA = r; }),
    );
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [nullEntry] };
    const commit = vi.fn();

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, activeTilesRef, commit,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    // Response where committedThroughTs is 500 ms BEFORE tile.endTime — NOT terminal.
    resolveA({
      source: '1min_cagg',
      startTime: Number(TILE_A.startTime),
      endTime: Number(TILE_A.endTime),
      committedThroughTs: Number(TILE_A.endTime) - 500,
      bucketSMs: 3600,
      n: 500,
      series: [{ tagId: 1, value: [1.0], min: [0.9], max: [1.1] }],
    });
    await flushAsync();

    const key = makeTileCacheKey({ tagId: 1, startTime: TILE_A.startTime, endTime: TILE_A.endTime, bucketCount: TILE_A.bucketCount });
    expect(cache.has(key)).toBe(false); // must NOT be in LRU
    expect(activeTilesRef.current[0]?.data).not.toBeNull(); // data held in entry
  });

  it('regression: committedThroughTs >= tile.endTime → terminal, goes to LRU', async () => {
    const cache = makeCache();
    const viewport = { start: 0n, end: 1_000_000n };

    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn().mockImplementation(
      () => new Promise<TileApiResponse>(r => { resolveA = r; }),
    );
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [] };
    const commit = vi.fn();

    runTileFetch(makeArgs(cache, {
      gatedFetchTile, activeTilesRef, commit,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    // Response where committedThroughTs exactly equals tile.endTime — terminal.
    resolveA({
      source: '1min_cagg',
      startTime: Number(TILE_A.startTime),
      endTime: Number(TILE_A.endTime),
      committedThroughTs: Number(TILE_A.endTime), // exactly at endTime → terminal
      bucketSMs: 3600,
      n: 500,
      series: [{ tagId: 1, value: [1.0], min: [0.9], max: [1.1] }],
    });
    await flushAsync();

    const key = makeTileCacheKey({ tagId: 1, startTime: TILE_A.startTime, endTime: TILE_A.endTime, bucketCount: TILE_A.bucketCount });
    expect(cache.has(key)).toBe(true); // must be in LRU
    expect(activeTilesRef.current[0]?.data).toBeNull(); // data in LRU, not entry
  });

  it('non-terminal resolve for off-screen tile skipped without error', async () => {
    const cache = makeCache();
    // Fixed mode + committedThroughTs=null triggers the predicate for TILE_A.
    const nullEntry: ActiveTileEntry = {
      tile: TILE_A,
      committedThroughTs: null,
      shape: null,
      data: null,
    };
    const viewport = { start: 0n, end: 1_000_000n };

    let resolveA: (v: TileApiResponse) => void = () => {};
    const gatedFetchTile = vi.fn()
      .mockImplementationOnce(() => new Promise<TileApiResponse>(r => { resolveA = r; }))
      // TILE_B's fetch is stalled so it doesn't add a spurious commit before the assertion.
      .mockImplementation(() => new Promise<TileApiResponse>(() => {}));

    const inFlightTilesRef: MutableRefObject<Set<string>> = { current: new Set() };
    const tagGenerationRef: MutableRefObject<number> = { current: 0 };
    const tagIdsRef: MutableRefObject<number[]> = { current: [1] };
    const visibleKeysRef: MutableRefObject<Set<string>> = { current: new Set() };
    const activeTilesRef: MutableRefObject<ActiveTileEntry[]> = { current: [nullEntry] };
    const commit = vi.fn();

    // Run 1: fire fetch for TILE_A.
    runTileFetch(makeArgs(cache, {
      tagIds: [1], gatedFetchTile, inFlightTilesRef, tagGenerationRef, tagIdsRef,
      visibleKeysRef, activeTilesRef, commit,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    // Viewport changes to TILE_B — activeTilesRef now has TILE_B's placeholder.
    levelHoisted.tilesForViewport.mockReturnValue({ visible: [TILE_B], prefetch: [] });
    runTileFetch(makeArgs(cache, {
      tagIds: [1], gatedFetchTile, inFlightTilesRef, tagGenerationRef, tagIdsRef,
      visibleKeysRef, activeTilesRef, commit,
      isLive: false, viewport, nowMs: FAR_FUTURE_MS,
    }));

    const commitCallsBeforeResolve = (commit as ReturnType<typeof vi.fn>).mock.calls.length;

    // Resolve TILE_A's non-terminal fetch — tile is no longer in active set → drop.
    resolveA(makeNonTerminalResponse(TILE_A));
    await flushAsync();

    // No extra commit from the stale non-terminal resolve.
    expect((commit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(commitCallsBeforeResolve);
  });
});
