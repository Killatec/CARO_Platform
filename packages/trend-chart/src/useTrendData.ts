import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TREND_VIEWER_DEFAULTS } from './level.js';
import { TileCache, makeTileCacheKey } from './tileCache.js';
import type { Tile, Viewport, TrendData } from './types.js';
import {
  estimateCachedEntrySize,
  chunkArray,
  pruneAndAdd,
  computeResponseTailTs,
  storeTileResult,
} from './tileActiveSet.js';
import type { CachedEntry, HookState } from './tileActiveSet.js';
import { buildGatedFetchTile } from './gatedFetchTile.js';
import { assembleLiveSpine, runLiveSpineFetch } from './liveSpineFetch.js';
import { runHistoryTileFetch } from './historyTileFetch.js';

// Re-exports for external consumers (tests import pruneAndAdd and assembleLiveSpine
// directly from this module via the original path).
export { pruneAndAdd } from './tileActiveSet.js';
export { assembleLiveSpine } from './liveSpineFetch.js';

const DEFAULT_CACHE_CAPACITY = 50_000_000;

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

export interface UseTrendDataResult extends HookState {
  ensureCovered: (startMs: bigint, endMs: bigint) => void;
  /** Returns the time bounds and tile width of the current active tile set, or null if empty.
   *  Used by checkAndExtendXCoverage so both the threshold check (panThresholdCheck) and the
   *  candidate loop (ensureCovered) use the same tile width — the active set's actual geometry. */
  getActiveRange: () => { startMs: bigint; endMs: bigint; tileSpanMs: bigint } | null;
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

  // Single chokepoint for all tile fetches. Every fetch site MUST use this wrapper.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gatedFetchTile = useCallback(buildGatedFetchTile(setRangeExceeded), []);

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

    // ── Live-spine path ───────────────────────────────────────────────────────
    // One tile spanning the full viewport at history-mode resolution. The cache
    // is never read or written. activeTilesRef stays empty so ensureCovered's
    // `active.length === 0` guard fires first — live mode never triggers
    // pan-prefetch fetches. levelTransitionPendingRef is never set here; it
    // lives exclusively in the history path.
    if (isTailingRef.current) {
      runLiveSpineFetch({
        tagIds, bucketCount, visibleTilesPerWindow,
        viewport: currentViewport, spanChanged, gatedFetchTile,
        spineLoadedRef, spineFetchInFlightRef, generationRef,
        activeTilesRef, inFlightTilesRef,
        setHookResult, setSwapCounter, setLastFetchMs, setResponseTailTs, setActiveTileCount,
      });
      return () => { finalizeRef.current = null; };
    }

    // ── History-mode path ─────────────────────────────────────────────────────
    // Reset spine sentinels so a subsequent live entry always triggers a fresh fetch.
    spineLoadedRef.current = false;
    spineFetchInFlightRef.current = false;

    // Live → fixed refetch: skip the right-side prefetch tile. The flag is reset
    // here so subsequent normal-history fetches use the default overfetch.
    const isLiveExitRefetch = liveExitRefetchPendingRef.current;
    liveExitRefetchPendingRef.current = false;

    const oldActiveTiles = activeTilesRef.current;

    runHistoryTileFetch({
      tagIds, bucketCount, visibleTilesPerWindow, overfetchPerSide,
      viewport: currentViewport, isLiveExitRefetch, cache, oldActiveTiles,
      generationRef, activeTilesRef, inFlightTilesRef, finalizeRef, levelTransitionPendingRef,
      setHookResult, setSwapCounter, setActiveTileCount, setLastFetchMs, setResponseTailTs, setRangeExceeded,
      gatedFetchTile,
    });

    return () => {
      finalizeRef.current = null;
    };
  }, [tagIdsKey, viewportStart, viewportEnd, bucketCount, visibleTilesPerWindow, overfetchPerSide, cache, historyRefetchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureCovered = useCallback((startMs: bigint, endMs: bigint) => {
    if (levelTransitionPendingRef.current) return;
    if (tagIds.length === 0) return;
    const active = activeTilesRef.current;
    if (active.length === 0) return;

    // Derive tileSpanMs from the active set's tile widths, NOT from the current viewport.
    // Active set tiles are uniform-width by construction (one tilesForViewport call), so
    // active[0] is reliable. Using viewport-derived width during the in-flight window of
    // a zoom commit produces candidates that don't align with the active set's grid,
    // which then overlap existing tiles when added — handoff §11.C regression.
    const tileSpanMs = active[0]!.endTime - active[0]!.startTime;
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

  const getActiveRange = useCallback((): { startMs: bigint; endMs: bigint; tileSpanMs: bigint } | null => {
    const active = activeTilesRef.current;
    if (active.length === 0) return null;
    return {
      startMs:    active[0]!.startTime,
      endMs:      active[active.length - 1]!.endTime,
      tileSpanMs: active[0]!.endTime - active[0]!.startTime,
    };
  }, []);

  return { ...hookResult, ensureCovered, getActiveRange, evictAll, refetchHistory, rangeExceeded, swapCounter, activeTileCount, lastFetchMs, responseTailTs };
}
