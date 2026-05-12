import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tilesForViewport, TREND_VIEWER_DEFAULTS } from './level.js';
import { makeTileCacheKey } from './tileCache.js';
import { TileCache } from './tileCache.js';
import { fetchTile } from './api.js';
import type { Tile, Viewport, TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { TileApiResponse } from './api.js';

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
  /** Evicts all cache entries whose tile range overlaps [startMs, endMs), prunes activeTilesRef,
   *  and bumps generationRef to drop in-flight fetches. Does NOT trigger a fetch. */
  evictRange: (startMs: bigint, endMs: bigint) => void;
  /** Drops the entire cache, resets the active set, and bumps generationRef.
   *  Called on every tailing↔fixed transition so the next fetch always starts clean. */
  evictAll: () => void;
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
        source:    res.source,
        responseTailTs,
        bucketSMs: res.bucketSMs,
        n:         res.n,
        value:     s.value,
        min:       s.min,
        max:       s.max,
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

  // Stable dep keys: tagIds array → joined string; Viewport object → component fields.
  const tagIdsKey = tagIds.join(',');
  const viewportStart = viewport.start;
  const viewportEnd = viewport.end;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tagIds.length === 0) {
      setHookResult({ data: null, isLoading: false, error: null });
      return;
    }

    const currentViewport: Viewport = { start: viewportStart, end: viewportEnd };

    // Tailing skip guard: suppress tile fetches while the viewport is just ticking
    // forward at the same span. Span changes (preset switch) always trigger a fetch.
    const currentSpan = currentViewport.end - currentViewport.start;
    const spanChanged = prevSpanRef.current !== null && prevSpanRef.current !== currentSpan;
    prevSpanRef.current = currentSpan;
    if (isTailing && !spanChanged && activeTilesRef.current.length > 0) {
      return;
    }

    const nowMs = BigInt(Date.now());
    const { visible, prefetch } = tilesForViewport({
      viewport: currentViewport,
      bucketCount,
      visibleTilesPerWindow,
      overfetchPerSide,
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
        fetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
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
        .catch(e => {
          if (generationRef.current !== generation) return;
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
        fetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
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
        .catch(e => {
          if (generationRef.current !== generation) return;
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
  }, [tagIdsKey, viewportStart, viewportEnd, bucketCount, visibleTilesPerWindow, overfetchPerSide, cache, isTailing]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureCovered = useCallback((startMs: bigint, endMs: bigint) => {
    // Block during zoom-level transition; pan visually works but no tile fetches
    // fire until performSwap completes and the new active set is in place.
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

    // Drop tiles whose start is at or past now (future tiles).
    const nowMs = BigInt(Date.now());
    const filtered = candidates.filter(t => t.startTime < nowMs);

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
        fetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
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
        .catch(e => {
          inFlightTilesRef.current.delete(tileKey);
          setLastFetchMs(Math.round(performance.now() - tileT0));
          if (generationRef.current !== gen) return;
          console.warn('[useTrendData] dynamic fetch failed', { tile, error: e });
        });
    }
  }, [tagIds, viewportStart, viewportEnd, bucketCount, visibleTilesPerWindow, cache]); // eslint-disable-line react-hooks/exhaustive-deps

  const evictRange = useCallback((startMs: bigint, endMs: bigint) => {
    // Bump generation — any in-flight fetch's .then() guard drops the stale result.
    generationRef.current++;
    // Clear in-flight set so subsequent ensureCovered calls can re-request evicted tiles.
    inFlightTilesRef.current.clear();

    // Delete all cache entries whose tile range overlaps [startMs, endMs).
    // Key format: "${tagId}:${startTime}:${endTime}:${bucketCount}".
    cache.deleteWhere((key) => {
      const parts = key.split(':');
      const tileStart = BigInt(parts[1]!);
      const tileEnd   = BigInt(parts[2]!);
      return tileStart < endMs && tileEnd > startMs;
    });

    // Prune activeTilesRef: keep only tiles whose range does NOT overlap [startMs, endMs).
    activeTilesRef.current = activeTilesRef.current.filter(
      tile => !(tile.startTime < endMs && tile.endTime > startMs),
    );

    // Update derived state.
    setActiveTileCount(activeTilesRef.current.length);
    setResponseTailTs(computeResponseTailTs(activeTilesRef.current, tagIds, cache, bucketCount));

    // Reassemble data from surviving active tiles so the chart reflects the eviction.
    try {
      const data = assembleData(activeTilesRef.current, tagIds, cache);
      setHookResult({ data, isLoading: false, error: null });
    } catch (e) {
      setHookResult({ data: null, isLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [tagIds, bucketCount, cache]); // eslint-disable-line react-hooks/exhaustive-deps

  const evictAll = useCallback(() => {
    generationRef.current++;
    inFlightTilesRef.current.clear();
    cache.deleteWhere(() => true);
    activeTilesRef.current = [];
    setActiveTileCount(0);
    setResponseTailTs(null);
  }, [cache]);

  return { ...hookResult, ensureCovered, evictRange, evictAll, swapCounter, activeTileCount, lastFetchMs, responseTailTs };
}
