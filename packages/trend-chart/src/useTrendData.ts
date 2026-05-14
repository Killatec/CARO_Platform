import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tilesForViewport, TREND_VIEWER_DEFAULTS, MAX_BUCKET_S } from './level.js';

import { makeTileCacheKey } from './tileCache.js';
import { TileCache } from './tileCache.js';
import { fetchTile } from './api.js';
import type { Tile, Viewport, TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { TileApiResponse } from './api.js';

/**
 * Assembles one or more tile API responses (from parallel tag-group fetches of
 * the same tile) directly into a TrendData object, bypassing the LRU cache.
 * Used exclusively by the live-spine path so history-mode cache is untouched.
 *
 * Groups for the same tile always return the same source — the server picks CAG
 * level by (span, bucketCount), which is tile-uniform. If sources disagree across
 * groups it means a server-side inconsistency; a console.warn fires in that case
 * and the result falls back to 'mixed'.
 */
export function assembleLiveSpine(
  responses: TileApiResponse[],
  tile: Tile,
  tagIds: number[],
): TrendData | null {
  if (responses.length === 0 || tagIds.length === 0) return null;

  const firstAgg = responses.find(r => r.source !== 'raw');
  const isRaw = firstAgg === undefined;

  if (isRaw) {
    const series = new Map<number, { ts: bigint[]; value: (number | null)[]; prev?: { ts: bigint; value: number | null } }>();
    for (const res of responses) {
      if (res.source !== 'raw') continue;
      for (const s of res.series) {
        series.set(s.tagId, {
          ts: s.ts.map(t => BigInt(t)),
          value: s.value,
          ...(s.prev ? { prev: { ts: BigInt(s.prev.ts), value: s.prev.value } } : {}),
        });
      }
    }
    for (const tagId of tagIds) {
      if (!series.has(tagId)) series.set(tagId, { ts: [], value: [] });
    }
    const result: RawSeriesData = {
      type: 'raw',
      source: 'raw',
      startTime: tile.startTime,
      endTime: tile.endTime,
      series,
    };
    return result;
  }

  // Aggregate path — n and bucketSMs are tile-uniform across all groups.
  const { n, bucketSMs } = firstAgg!;
  const sources = new Set(
    responses.filter(r => r.source !== 'raw').map(r => r.source),
  );
  if (sources.size > 1) {
    // The server picks CAG level by (span, bucketCount) — tile-uniform across
    // groups — so this branch is unreachable in normal operation. If it fires,
    // a server-side inconsistency has produced mixed levels for the same tile.
    console.warn(
      '[assembleLiveSpine] unexpected: multiple sources across tag groups for the same tile',
      [...sources],
    );
  }
  const effectiveSource: AggregateSeriesData['source'] =
    sources.size === 1
      ? (sources.values().next().value as AggregateSeriesData['source'])
      : 'mixed';

  const seriesMap = new Map<number, { value: (number | null)[]; min?: (number | null)[]; max?: (number | null)[] }>();
  for (const res of responses) {
    if (res.source === 'raw') continue;
    for (const s of res.series) {
      seriesMap.set(s.tagId, { value: s.value, min: s.min, max: s.max });
    }
  }
  const nullFill = new Array<null>(n).fill(null);
  for (const tagId of tagIds) {
    if (!seriesMap.has(tagId)) seriesMap.set(tagId, { value: [...nullFill] });
  }

  const result: AggregateSeriesData = {
    type: 'aggregate',
    source: effectiveSource,
    startTime: tile.startTime,
    endTime: tile.endTime,
    n,
    bucketSMs,
    series: seriesMap,
  };
  return result;
}

// Per-(tagId, tile) cache entry.
type TileSource = TileApiResponse['source'];

interface CachedEntry {
  source: TileSource;
  /** Server Date.now() from the response that populated this entry. */
  responseTailTs?: number;
  // Aggregate fields
  bucketSMs?: number;
  n?: number;
  value?:    (number | null)[];
  min?:      (number | null)[];
  max?:      (number | null)[];
  // Raw fields
  ts?:       bigint[];
  valueRaw?: (number | null)[];
  prev?:     { ts: bigint; value: number | null };
}

function estimateCachedEntrySize(entry: CachedEntry): number {
  const valueLen = entry.value?.length ?? 0;
  const minLen   = entry.min?.length   ?? 0;
  const maxLen   = entry.max?.length   ?? 0;
  const tsLen    = entry.ts?.length    ?? 0;
  const rawLen   = entry.valueRaw?.length ?? 0;
  return (valueLen + minLen + maxLen + tsLen + rawLen) * 8 + 100;
}

const DEFAULT_CACHE_CAPACITY = 50_000_000;
const MAX_ACTIVE_TILES = 8;

export interface UseTrendDataOptions {
  viewport: Viewport;
  tagIds: number[];
  /** When true, tile fetches are suppressed while the viewport span is unchanged
   *  and at least one active tile exists — the live buffer drives rendering. */
  isTailing?: boolean;
  bucketCount?: number;
  visibleTilesPerWindow?: number;
  overfetchPerSide?: number;
  cacheCapacityBytes?: number;
}

interface HookState {
  data: TrendData | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseTrendDataResult extends HookState {
  ensureCovered: (startMs: bigint, endMs: bigint) => void;
  /** Returns the time bounds of the current active tile set, or null if no tiles are active.
   *  Used by checkAndExtendXCoverage to derive cached extent from tile metadata rather than
   *  u.data[0], which is unreliable in raw mode when samples don't reach tile edges. */
  getActiveRange: () => { startMs: bigint; endMs: bigint } | null;
  /**
   * Clears the entire LRU cache and resets activeTilesRef. Called on every
   * fixed→tailing transition (TrendChartContainer.dispatchModeAction) to ensure
   * each Live exit fetches fresh tiles — eliminates Gap B (stale CAG-lag nulls
   * accumulating in cache across sessions). Also available for test cleanup.
   */
  evictAll: () => void;
  /** Forces the main effect to re-run the history fetch path, using an asymmetric
   *  overfetch (1 LEFT, 0 RIGHT) — used on live → fixed transition. */
  refetchHistory: () => void;
  /** True when the most recent visible-tile fetch failed with INVALID_BUCKET_S
   *  (viewport span exceeds server's supported range). Cleared on next successful
   *  fetch. Consumers can render a "Range too wide" message instead of the chart. */
  rangeExceeded: boolean;
  swapCounter: number;
  activeTileCount: number;
  /** Wall-clock ms of the most recent viewport-change batch (visible tiles only).
   *  null until the first batch settles. Includes failed batches. */
  lastFetchMs: number | null;
  /** Most recent server-captured tail timestamp across active tiles. null until first fetch resolves. */
  responseTailTs: number | null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function storeTileResult(
  tile: Tile,
  res: TileApiResponse,
  cache: TileCache<CachedEntry>,
): void {
  const responseTailTs = res.responseTailTs;

  if (res.source === 'raw') {
    for (const s of res.series) {
      const key = makeTileCacheKey({
        tagId: s.tagId,
        startTime: tile.startTime,
        endTime: tile.endTime,
        bucketCount: tile.bucketCount,
      });
      cache.set(key, {
        source: 'raw',
        responseTailTs,
        ts: s.ts.map(t => BigInt(t)),
        valueRaw: s.value,
        ...(s.prev ? { prev: { ts: BigInt(s.prev.ts), value: s.prev.value } } : {}),
      });
    }
  } else {
    for (const s of res.series) {
      const key = makeTileCacheKey({
        tagId: s.tagId,
        startTime: tile.startTime,
        endTime: tile.endTime,
        bucketCount: tile.bucketCount,
      });
      cache.set(key, {
        source:      res.source,
        responseTailTs,
        bucketSMs:   res.bucketSMs,
        n:           res.n,
        value:       s.value,
        min:         s.min,
        max:         s.max,
      });
    }
  }
}

function assembleData(
  tilesInOrder: Tile[],
  tagIds: number[],
  cache: TileCache<CachedEntry>,
): TrendData | null {
  if (tagIds.length === 0 || tilesInOrder.length === 0) return null;

  // Determine raw vs aggregate from the first available cache entry.
  let isRaw = false;
  outer: for (const tile of tilesInOrder) {
    for (const tagId of tagIds) {
      const entry = cache.get(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
      );
      if (entry) {
        isRaw = entry.source === 'raw';
        break outer;
      }
    }
  }

  if (isRaw) {
    const series = new Map<number, { ts: bigint[]; value: (number | null)[]; prev?: { ts: bigint; value: number | null } }>();
    for (const tagId of tagIds) {
      const ts: bigint[] = [];
      const value: (number | null)[] = [];
      let prev: { ts: bigint; value: number | null } | undefined;
      for (const tile of tilesInOrder) {
        const entry = cache.get(
          makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        );
        if (entry?.ts && entry.valueRaw) {
          ts.push(...entry.ts);
          value.push(...entry.valueRaw);
          // Use the leftmost tile's prev — it has the earliest preceding sample.
          if (prev === undefined && entry.prev) prev = entry.prev;
        }
      }
      series.set(tagId, prev !== undefined ? { ts, value, prev } : { ts, value });
    }
    const result: RawSeriesData = {
      type: 'raw',
      source: 'raw',
      startTime: tilesInOrder[0]!.startTime,
      endTime: tilesInOrder[tilesInOrder.length - 1]!.endTime,
      series,
    };
    return result;
  }

  // Aggregate path — one pass per tile.
  type AggTagAccum = {
    value:     (number | null)[];
    mins:      (number | null)[];
    maxs:      (number | null)[];
    hasAllMin: boolean; // false when any present cache entry lacks min (v0.7 hit)
  };
  const perTag = new Map<number, AggTagAccum>();
  for (const tagId of tagIds) {
    perTag.set(tagId, { value: [], mins: [], maxs: [], hasAllMin: true });
  }

  const tileSourceSet = new Set<string>();
  let totalN = 0;
  let lastBucketSMs = 0;

  for (const tile of tilesInOrder) {
    let tileN = tile.bucketCount;
    let tileBucketSMs = 0;
    let tileSourceFound: string | undefined;
    const tileData = new Map<number, { value: (number|null)[]; min?: (number|null)[]; max?: (number|null)[] }>();

    for (const tagId of tagIds) {
      const entry = cache.get(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
      );
      if (entry?.value !== undefined) {
        tileData.set(tagId, { value: entry.value, min: entry.min, max: entry.max });
        if (!tileSourceFound && entry.n !== undefined) {
          tileN = entry.n;
          tileBucketSMs = entry.bucketSMs ?? 0;
          tileSourceFound = entry.source;
        }
      }
    }

    if (tileSourceFound) tileSourceSet.add(tileSourceFound);
    if (tileBucketSMs > 0) lastBucketSMs = tileBucketSMs;
    totalN += tileN;

    const nullFill = new Array<null>(tileN).fill(null);
    for (const tagId of tagIds) {
      const te = perTag.get(tagId)!;
      const td = tileData.get(tagId);
      te.value.push(...(td?.value ?? nullFill));
      te.mins.push(...(td?.min   ?? nullFill));
      te.maxs.push(...(td?.max   ?? nullFill));
      // Present entry with no min = v0.7 cache hit → disable bands for this tag.
      if (td !== undefined && td.min === undefined) te.hasAllMin = false;
    }
  }

  const series = new Map<number, { value: (number|null)[]; min?: (number|null)[]; max?: (number|null)[] }>();
  for (const tagId of tagIds) {
    const te = perTag.get(tagId)!;
    series.set(tagId, te.hasAllMin
      ? { value: te.value, min: te.mins, max: te.maxs }
      : { value: te.value },
    );
  }

  let effectiveSource: AggregateSeriesData['source'];
  if (tileSourceSet.has('mixed') || tileSourceSet.size > 1) {
    effectiveSource = 'mixed';
  } else if (tileSourceSet.size === 1) {
    effectiveSource = tileSourceSet.values().next().value as AggregateSeriesData['source'];
  } else {
    effectiveSource = 'mixed';
  }

  const bucketSMs =
    lastBucketSMs > 0
      ? lastBucketSMs
      : totalN > 0
        ? Math.round(Number(tilesInOrder[tilesInOrder.length - 1]!.endTime - tilesInOrder[0]!.startTime) / totalN)
        : 0;

  if (!Number.isInteger(bucketSMs)) {
    throw new Error(`useTrendData: bucketSMs must be integer, got ${bucketSMs}`);
  }

  const result: AggregateSeriesData = {
    type: 'aggregate',
    source: effectiveSource,
    startTime: tilesInOrder[0]!.startTime,
    endTime: tilesInOrder[tilesInOrder.length - 1]!.endTime,
    n: totalN,
    bucketSMs,
    series,
  };
  return result;
}

/**
 * Derives the maximum responseTailTs across active tiles from the cache.
 * Returns null if no active tile has a responseTailTs entry.
 */
function computeResponseTailTs(
  activeTiles: Tile[],
  tagIds: number[],
  cache: TileCache<CachedEntry>,
  bucketCount: number,
): number | null {
  let max: number | null = null;
  for (const tile of activeTiles) {
    for (const tagId of tagIds) {
      const entry = cache.get(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount }),
      );
      if (entry?.responseTailTs !== undefined) {
        if (max === null || entry.responseTailTs > max) max = entry.responseTailTs;
        break; // all tags in a tile share the same responseTailTs; no need to check others
      }
    }
  }
  return max;
}

/**
 * Add `newTile` to `activeSet` and prune to `maxSize`, dropping from the side
 * farthest from `newTile`. Returns the new sorted active set.
 *
 * - newTile left of extent  → drop rightmost tile.
 * - newTile right of extent → drop leftmost tile.
 * - newTile in the middle (defensive, shouldn't happen) → drop leftmost, warn.
 */
export function pruneAndAdd(activeSet: Tile[], newTile: Tile, maxSize = MAX_ACTIVE_TILES): Tile[] {
  if (activeSet.length === 0) return [newTile];
  const sorted = [...activeSet, newTile].sort((a, b) => Number(a.startTime - b.startTime));
  if (sorted.length <= maxSize) return sorted;

  const isLeftEnd = newTile.startTime < activeSet[0]!.startTime;
  const isRightEnd = newTile.endTime > activeSet[activeSet.length - 1]!.endTime;
  if (isLeftEnd) return sorted.slice(0, maxSize);
  if (isRightEnd) return sorted.slice(sorted.length - maxSize);
  console.warn('[useTrendData] pruneAndAdd: newTile is in the middle of activeSet — unexpected',
    'activeSet=', activeSet.map(t => `[${Number(t.startTime)},${Number(t.endTime)}]`).join(' '),
    'newTile=', `[${Number(newTile.startTime)},${Number(newTile.endTime)}]`);
  return sorted.slice(sorted.length - maxSize);
}

export function useTrendData(opts: UseTrendDataOptions): UseTrendDataResult {
  const {
    viewport,
    tagIds,
    isTailing = false,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
    visibleTilesPerWindow = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow,
    overfetchPerSide = TREND_VIEWER_DEFAULTS.overfetchPerSide,
    cacheCapacityBytes = DEFAULT_CACHE_CAPACITY,
  } = opts;

  const cache = useMemo(
    () =>
      new TileCache<CachedEntry>({
        capacityBytes: cacheCapacityBytes,
        estimateSize: estimateCachedEntrySize,
      }),
    [cacheCapacityBytes],
  );

  const [hookResult, setHookResult] = useState<HookState>({
    data: null,
    isLoading: true,
    error: null,
  });
  const [swapCounter, setSwapCounter] = useState(0);
  const [activeTileCount, setActiveTileCount] = useState<number>(0);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);
  const [responseTailTs, setResponseTailTs] = useState<number | null>(null);
  const [historyRefetchVersion, setHistoryRefetchVersion] = useState<number>(0);
  const [rangeExceeded, setRangeExceeded] = useState(false);

  // Tracks the previous viewport span; used to detect preset changes during tailing.
  const prevSpanRef = useRef<bigint | null>(null);

  // Incremented on each opts change; async callbacks from stale effects are ignored.
  const generationRef = useRef(0);
  // Bounded active tile set fed into uPlot; NOT immediately reset on effect re-run —
  // reset is deferred until new visible tiles settle (bridge render).
  const activeTilesRef = useRef<Tile[]>([]);
  const inFlightTilesRef = useRef<Set<string>>(new Set());
  // Points at the latest finalize closure; cleared on effect cleanup.
  const finalizeRef = useRef<(() => void) | null>(null);
  // True between effect re-run and the performSwap point; blocks ensureCovered
  // so pan fetches don't fire during a zoom-level transition.
  const levelTransitionPendingRef = useRef<boolean>(false);
  // True once the live-spine fetch has settled for the current viewport span.
  // Parallel to the history path's `activeTilesRef.current.length > 0` skip guard.
  const spineLoadedRef = useRef<boolean>(false);
  // True while a spine fetch is in-flight; prevents 4 Hz tick re-fires from
  // launching duplicate requests before the first one settles.
  const spineFetchInFlightRef = useRef<boolean>(false);
  // Set by refetchHistory() before the version bump; read and consumed by the
  // history branch to use asymmetric overfetch (1 left, 0 right) on live → fixed.
  const liveExitRefetchPendingRef = useRef<boolean>(false);
  // Ref-tracked isTailing so the effect can read the current value without
  // being in the dep array — mode flip and viewport cascade arrive in separate
  // renders; putting isTailing in deps caused a stale-viewport fetch on entry.
  const isTailingRef = useRef<boolean>(isTailing);
  isTailingRef.current = isTailing;

  // Stable dep keys: tagIds array → joined string; Viewport object → component fields.
  const tagIdsKey = tagIds.join(',');
  const viewportStart = viewport.start;
  const viewportEnd = viewport.end;

  // Single chokepoint for all tile fetches. Checks per-tile bucketS against the server cap
  // before calling fetchTile — any new fetch site added later MUST use this wrapper.
  const gatedFetchTile = useCallback(
    (args: Parameters<typeof fetchTile>[0]) => {
      // Defense in depth: upstream tilesForViewport and ensureCovered filters should prevent
      // pre-epoch tiles, but guard here in case a future call site bypasses those filters.
      if (args.startTime < 0n) {
        return Promise.reject(
          Object.assign(new Error('tile start before epoch — skipped client-side'),
                        { code: 'CLIENT_PRE_EPOCH' }),
        );
      }
      const tileSpanMs = Number(args.endTime - args.startTime);
      const bucketS    = tileSpanMs / (args.bucketCount * 1000);
      if (bucketS > MAX_BUCKET_S) {
        setRangeExceeded(true);
        return Promise.reject(
          Object.assign(new Error('viewport over range — fetch skipped client-side'),
                        { code: 'CLIENT_OVER_RANGE' }),
        );
      }
      setRangeExceeded(false);
      return fetchTile(args);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tagIds.length === 0) {
      setHookResult({ data: null, isLoading: false, error: null });
      return;
    }

    const currentViewport: Viewport = { start: viewportStart, end: viewportEnd };

    const currentSpan = currentViewport.end - currentViewport.start;
    const spanChanged = prevSpanRef.current !== null && prevSpanRef.current !== currentSpan;
    prevSpanRef.current = currentSpan;

    // ── Live-spine path: bypass cache entirely ────────────────────────────────
    // One tile spanning the full viewport at history-mode resolution
    // (visibleTilesPerWindow × bucketCount = 1000 buckets at defaults). The
    // cache is never read or written. activeTilesRef stays empty so:
    //   • ensureCovered's `activeTilesRef.current.length === 0` guard fires first
    //     (line ~644) — live mode never triggers pan-prefetch fetches.
    //   • levelTransitionPendingRef is never set in this branch; it lives
    //     exclusively in the history path below.
    if (isTailingRef.current) {
      if (!spanChanged && (spineLoadedRef.current || spineFetchInFlightRef.current)) return;
      spineLoadedRef.current = false;
      // Clear any history-mode residue so ensureCovered stays a no-op.
      activeTilesRef.current = [];
      inFlightTilesRef.current.clear();
      setActiveTileCount(0);

      // Tile bounds = viewport bounds exactly. tilesForViewport aligns to a
      // tile-grid for cache-key stability across viewport translations, which
      // is a history-mode concern. The live path doesn't reuse tiles and
      // doesn't cache, so alignment would only introduce a left-side gap
      // (up to one tileSpan) for viewports that don't land on a grid boundary.
      const spineTile: Tile = {
        startTime: currentViewport.start,
        endTime: currentViewport.end,
        bucketCount: visibleTilesPerWindow * bucketCount,
      };

      const generation = ++generationRef.current;
      const batchT0 = performance.now();
      setHookResult(prev => ({ ...prev, isLoading: true }));

      spineFetchInFlightRef.current = true;
      Promise.all(
        chunkArray(tagIds, 8).map(group =>
          gatedFetchTile({ tagIds: group, startTime: spineTile.startTime, endTime: spineTile.endTime, bucketCount: spineTile.bucketCount }),
        ),
      ).then(responses => {
        if (generationRef.current !== generation) return;
        spineFetchInFlightRef.current = false;
        const data = assembleLiveSpine(responses, spineTile, tagIds);
        setHookResult({ data, isLoading: false, error: null });
        setSwapCounter(c => c + 1);
        setLastFetchMs(Math.round(performance.now() - batchT0));
        const maxTailTs = responses.reduce((m, r) => Math.max(m, r.responseTailTs), 0);
        setResponseTailTs(maxTailTs > 0 ? maxTailTs : null);
        spineLoadedRef.current = true;
      }).catch((e: Error & { code?: string }) => {
        if (generationRef.current !== generation) return;
        spineFetchInFlightRef.current = false;
        if (e.code === 'CLIENT_OVER_RANGE' || e.code === 'CLIENT_PRE_EPOCH') return;
        console.error('[useTrendData] live spine fetch failed', { tagIds, error: e });
        setHookResult({ data: null, isLoading: false, error: e instanceof Error ? e.message : String(e) });
      });

      return () => { finalizeRef.current = null; };
    }

    // ── History-mode path ─────────────────────────────────────────────────────
    // Reset spine sentinels so a subsequent live entry always triggers a fresh fetch.
    spineLoadedRef.current = false;
    spineFetchInFlightRef.current = false;

    // Live → fixed refetch: skip the right-side prefetch tile (the user is panning
    // back in time; the future-side tile would be useless here). The flag is reset
    // after reading so subsequent normal-history fetches use the default overfetch.
    const isLiveExitRefetch = liveExitRefetchPendingRef.current;
    liveExitRefetchPendingRef.current = false;

    const nowMs = BigInt(Date.now());
    const { visible, prefetch } = tilesForViewport({
      viewport: currentViewport,
      bucketCount,
      visibleTilesPerWindow,
      overfetchPerSide,
      overfetchRightCount: isLiveExitRefetch ? 0 : undefined,
      nowMs,
    });

    if (visible.length === 0) {
      setHookResult({ data: null, isLoading: false, error: null });
      return;
    }

    // Wall-clock start of this viewport-change batch. performSwap() is the natural
    // end boundary — it fires when all visible tiles have settled (success or failure).
    const batchT0 = performance.now();

    // Capture old active set for selective eviction on swap.
    // activeTilesRef is NOT reset here — bridge render keeps old data visible
    // until all new visible tiles have settled.
    const oldActiveTiles = activeTilesRef.current;
    inFlightTilesRef.current.clear();
    levelTransitionPendingRef.current = true;

    const newSorted = [...prefetch, ...visible].sort(
      (a, b) => Number(a.startTime - b.startTime),
    );

    const generation = ++generationRef.current;
    let batchHasRangeExceeded = false;

    const getMissing = (tile: Tile): number[] =>
      tagIds.filter(
        tagId =>
          !cache.has(
            makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
          ),
      );

    const finalize = () => {
      if (generationRef.current !== generation) return;
      const allTiles = activeTilesRef.current;
      try {
        const data = assembleData(allTiles, tagIds, cache);
        setHookResult({ data, isLoading: false, error: null });
      } catch (e) {
        setHookResult({ data: null, isLoading: false, error: e instanceof Error ? e.message : String(e) });
      }
    };

    finalizeRef.current = finalize;

    // Called once all new visible tiles have settled. Evicts old active tiles
    // that are not in the new tile set (cursor-anchored level-switch tiles can't
    // be reused), then atomically swaps to the new active set and clears the
    // transition-pending flag.
    const performSwap = () => {
      if (generationRef.current !== generation) return;
      const newTileKeys = new Set(newSorted.map(t => `${t.startTime}:${t.endTime}`));
      for (const tile of oldActiveTiles) {
        if (!newTileKeys.has(`${tile.startTime}:${tile.endTime}`)) {
          for (const tagId of tagIds) {
            cache.delete(makeTileCacheKey({
              tagId,
              startTime: tile.startTime,
              endTime: tile.endTime,
              bucketCount: tile.bucketCount,
            }));
          }
        }
      }
      activeTilesRef.current = newSorted;
      setActiveTileCount(newSorted.length);
      levelTransitionPendingRef.current = false;
      setLastFetchMs(Math.round(performance.now() - batchT0));
      setResponseTailTs(computeResponseTailTs(newSorted, tagIds, cache, bucketCount));
      if (!batchHasRangeExceeded) setRangeExceeded(false);
      finalize();
      setSwapCounter(c => c + 1);
    };

    let resolvedCount = 0;
    const totalVisible = visible.length;

    const onVisibleTileSettled = () => {
      resolvedCount++;
      if (resolvedCount < totalVisible) return;
      performSwap();
    };

    setHookResult(prev => ({ ...prev, isLoading: true }));

    // ── Visible tiles ─────────────────────────────────────────────────────────
    for (const tile of visible) {
      const missing = getMissing(tile);
      if (missing.length === 0) {
        resolvedCount++;
        continue;
      }

      const groups = chunkArray(missing, 8);
      const promises = groups.map(group =>
        gatedFetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
          res => {
            if (generationRef.current !== generation) return;
            storeTileResult(tile, res, cache);
          },
        ),
      );

      Promise.all(promises)
        .then(() => {
          if (generationRef.current !== generation) return;
          onVisibleTileSettled();
        })
        .catch((e: Error & { code?: string }) => {
          if (generationRef.current !== generation) return;
          if (e.code === 'CLIENT_OVER_RANGE') {
            batchHasRangeExceeded = true; // prevents performSwap from clearing rangeExceeded
            onVisibleTileSettled();
            return;
          }
          if (e.code === 'CLIENT_PRE_EPOCH') {
            // Defensive: upstream filter should prevent pre-epoch visible tiles; silent skip.
            onVisibleTileSettled();
            return;
          }
          if (e.code === 'INVALID_BUCKET_S') {
            batchHasRangeExceeded = true;
            setRangeExceeded(true);
          }
          console.error('[useTrendData] visible tile fetch failed', {
            tagIds: missing,
            startTime: tile.startTime,
            endTime: tile.endTime,
            error: e,
          });
          // Not cached — next opts change will retry. assembleData null-fills on cache miss.
          onVisibleTileSettled();
        });
    }

    // ── Prefetch tiles (async, not render-blocking) ───────────────────────────
    for (const tile of prefetch) {
      const missing = getMissing(tile);
      if (missing.length === 0) {
        continue;
      }

      const groups = chunkArray(missing, 8);
      const promises = groups.map(group =>
        gatedFetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
          res => {
            if (generationRef.current !== generation) return;
            storeTileResult(tile, res, cache);
          },
        ),
      );

      Promise.all(promises)
        .then(() => {
          if (generationRef.current !== generation) return;
          // Don't finalize during a transition — wait for performSwap to set the new active set first.
          if (levelTransitionPendingRef.current) return;
          finalize();
        })
        .catch((e: Error & { code?: string }) => {
          if (generationRef.current !== generation) return;
          if (e.code === 'CLIENT_OVER_RANGE' || e.code === 'CLIENT_PRE_EPOCH') return;
          console.warn('[useTrendData] prefetch fetch failed', {
            tagIds: missing,
            startTime: tile.startTime,
            endTime: tile.endTime,
            error: e,
          });
        });
    }

    // All visible tiles were already cached — performSwap synchronously after the
    // prefetch loop so the prefetch loop's cache checks run before any eviction.
    if (resolvedCount === totalVisible) {
      performSwap();
    }

    return () => {
      finalizeRef.current = null;
    };
  }, [tagIdsKey, viewportStart, viewportEnd, bucketCount, visibleTilesPerWindow, overfetchPerSide, cache, historyRefetchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureCovered = useCallback((startMs: bigint, endMs: bigint) => {
    if (levelTransitionPendingRef.current) return;
    if (tagIds.length === 0) return;
    const active = activeTilesRef.current;
    if (active.length === 0) return;

    const tileSpanMs = (viewportEnd - viewportStart) / BigInt(visibleTilesPerWindow);
    if (tileSpanMs === 0n) return;

    const cachedStart = active[0]!.startTime;
    const cachedEnd = active[active.length - 1]!.endTime;
    const candidates: Tile[] = [];

    // Extend left: walk backward from cachedStart until startMs is covered.
    let leftEnd = cachedStart;
    while (leftEnd > startMs) {
      candidates.push({ startTime: leftEnd - tileSpanMs, endTime: leftEnd, bucketCount });
      leftEnd -= tileSpanMs;
    }

    // Extend right: walk forward from cachedEnd until endMs is covered.
    let rightStart = cachedEnd;
    while (rightStart < endMs) {
      candidates.push({ startTime: rightStart, endTime: rightStart + tileSpanMs, bucketCount });
      rightStart += tileSpanMs;
    }

    // Drop tiles that are pre-epoch (TS_BUCKET_ORIGIN_MS alignment can push the left-neighbor
    // before Unix epoch when active tiles are epoch-adjacent) or in the future.
    const nowMs = BigInt(Date.now());
    const filtered = candidates.filter(t => t.startTime >= 0n && t.startTime < nowMs);

    const gen = generationRef.current;

    for (const tile of filtered) {
      const tileKey = `${tile.startTime}:${tile.endTime}:${tile.bucketCount}`;

      // Already in the active set — nothing to do.
      if (activeTilesRef.current.some(t => t.startTime === tile.startTime && t.endTime === tile.endTime)) {
        continue;
      }

      // A fetch is already in-flight for this tile — deduplicate.
      if (inFlightTilesRef.current.has(tileKey)) continue;

      const missing = tagIds.filter(
        tagId =>
          !cache.has(
            makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
          ),
      );

      if (missing.length === 0) {
        // Tile is fully in LRU cache (e.g. pan-back scenario) — update active set immediately.
        activeTilesRef.current = pruneAndAdd(activeTilesRef.current, tile);
        setActiveTileCount(activeTilesRef.current.length);
        finalizeRef.current?.();
        continue;
      }

      // Pan-induced fetches update lastFetchMs per-tile (last-settle-wins).
      // This mirrors the viewport-change path so the indicator always reflects wire latency.
      const tileT0 = performance.now();
      inFlightTilesRef.current.add(tileKey);

      const groups = chunkArray(missing, 8);
      const promises = groups.map(group =>
        gatedFetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
          res => {
            if (generationRef.current !== gen) return;
            storeTileResult(tile, res, cache);
          },
        ),
      );

      Promise.all(promises)
        .then(() => {
          inFlightTilesRef.current.delete(tileKey);
          setLastFetchMs(Math.round(performance.now() - tileT0));
          if (generationRef.current !== gen) return;
          activeTilesRef.current = pruneAndAdd(activeTilesRef.current, tile);
          setActiveTileCount(activeTilesRef.current.length);
          setResponseTailTs(computeResponseTailTs(activeTilesRef.current, tagIds, cache, bucketCount));
          finalizeRef.current?.();
        })
        .catch((e: Error & { code?: string }) => {
          inFlightTilesRef.current.delete(tileKey);
          if (e.code === 'CLIENT_OVER_RANGE' || e.code === 'CLIENT_PRE_EPOCH') return;
          setLastFetchMs(Math.round(performance.now() - tileT0));
          if (generationRef.current !== gen) return;
          console.warn('[useTrendData] dynamic fetch failed', { tile, error: e });
        });
    }
  }, [tagIds, viewportStart, viewportEnd, bucketCount, visibleTilesPerWindow, cache]); // eslint-disable-line react-hooks/exhaustive-deps

  const evictAll = useCallback(() => {
    generationRef.current++;
    inFlightTilesRef.current.clear();
    cache.deleteWhere(() => true);
    activeTilesRef.current = [];
    setActiveTileCount(0);
    setResponseTailTs(null);
    spineLoadedRef.current = false;
    spineFetchInFlightRef.current = false;
  }, [cache]);

  const refetchHistory = useCallback(() => {
    liveExitRefetchPendingRef.current = true;
    setHistoryRefetchVersion(v => v + 1);
  }, []);

  const getActiveRange = useCallback((): { startMs: bigint; endMs: bigint } | null => {
    const active = activeTilesRef.current;
    if (active.length === 0) return null;
    return {
      startMs: active[0]!.startTime,
      endMs: active[active.length - 1]!.endTime,
    };
  }, []);

  return { ...hookResult, ensureCovered, getActiveRange, evictAll, refetchHistory, rangeExceeded, swapCounter, activeTileCount, lastFetchMs, responseTailTs };
}
