import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { TREND_VIEWER_DEFAULTS, MIN_VIEWPORT_SPAN_MS, MAX_VIEWPORT_SPAN_MS } from './level.js';
import { TileCache } from './tileCache.js';
import type { ActiveTileEntry, Viewport } from './types.js';
import { estimateCachedEntrySize, assembleData, computeCommittedThroughTs } from './tileActiveSet.js';
import type { CachedEntry, HookState } from './tileActiveSet.js';
import { buildGatedFetchTile } from './gatedFetchTile.js';
import { runTileFetch } from './runTileFetch.js';

// Re-export for external consumers.
export { pruneAndAdd } from './tileActiveSet.js';

const DEFAULT_CACHE_CAPACITY = 50_000_000;

export interface UseTrendDataOptions {
  viewport: Viewport;
  tagIds: number[];
  /** When true, uses tile-aligned live path (overfetchRightCount=0, terminal-cache rule). */
  isLive?: boolean;
  /**
   * Current resolution (ms per bucket). Passed explicitly so fetch coverage tracks
   * modeViewport directly instead of a frozen cursor-centered dataViewport.
   * Defaults to deriving from viewport span when omitted (legacy / test path).
   */
  bucketSMs?: bigint;
  bucketCount?: number;
  visibleTilesPerWindow?: number;
  overfetchPerSide?: number;
  cacheCapacityBytes?: number;
}

export interface UseTrendDataResult extends HookState {
  swapCounter: number;
  activeTileCount: number;
  lastFetchMs: number | null;
  committedThroughTs: number | null;
  /** Stable ref to the active tile set. */
  activeTilesRef: MutableRefObject<ActiveTileEntry[]>;
  /**
   * Reset committedThroughTs to null for every NON-TERMINAL active entry so
   * the next runTileFetch sees them as unresolved (needsFetch line 140 → true)
   * and re-fetches them with a fresh watermark. Terminal entries are left
   * untouched. Called by TrendChartContainer on `!isLive → isLive` mode
   * transitions to refresh tiles preserved from the prior Fixed mode with a
   * stale committedThroughTs.
   */
  invalidateNonTerminalTiles: () => void;
}

function isViewportOverRange(viewport: Viewport): boolean {
  return (viewport.end - viewport.start) > MAX_VIEWPORT_SPAN_MS;
}

function isViewportUnderRange(viewport: Viewport): boolean {
  return (viewport.end - viewport.start) < MIN_VIEWPORT_SPAN_MS;
}

export function useTrendData(opts: UseTrendDataOptions): UseTrendDataResult {
  const {
    viewport,
    tagIds,
    isLive = false,
    bucketSMs: bucketSMsProp,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
    visibleTilesPerWindow = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow,
    overfetchPerSide = TREND_VIEWER_DEFAULTS.overfetchPerSide,
    cacheCapacityBytes = DEFAULT_CACHE_CAPACITY,
  } = opts;

  // Derive tileSpanMs from explicit bucketSMs when provided; otherwise fall back to
  // viewport-derived resolution (legacy path used by tests that don't pass bucketSMs).
  const tileSpanMs = bucketSMsProp !== undefined
    ? bucketSMsProp * BigInt(bucketCount)
    : (viewport.end - viewport.start) / BigInt(visibleTilesPerWindow);

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
  const [committedThroughTs, setCommittedThroughTs] = useState<number | null>(null);

  // Live-mode heartbeat: re-evaluates the freshness predicate every 2 s while in live mode
  // so the fetch effect fires even when the viewport is pinned (live-fixed).
  const [heartbeat, setHeartbeat] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setHeartbeat(c => c + 1), 2000);
    return () => clearInterval(id);
  }, [isLive]);

  // §5.6 refs — durable across effect runs.
  const activeTilesRef = useRef<ActiveTileEntry[]>([]);
  const inFlightTilesRef = useRef<Set<string>>(new Set());
  const tagGenerationRef = useRef(0);
  const tagIdsRef = useRef<number[]>(tagIds);
  const visibleKeysRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const firstFetchFiredAtRef = useRef<number | null>(null);

  // Ref-tracked isLive so the effect can read the current value without being in dep array.
  const isLiveRef = useRef<boolean>(isLive);
  isLiveRef.current = isLive;

  // Mount/unmount guard — prevents commit from touching state after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const tagIdsKey = tagIds.join(',');
  const viewportStart = viewport.start;
  const viewportEnd = viewport.end;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gatedFetchTile = useCallback(buildGatedFetchTile(), []);

  /**
   * §5.6 commit — called by runTileFetch after each activeTilesRef mutation.
   * Re-assembles data from the current active set, updates all derived state,
   * and sets lastFetchMs when the last in-flight fetch settles.
   *
   * Preserves previous data reference while visible tiles are still pending
   * (bridge render — TrendChartContainer's lastChartDataRef backs this up too).
   */
  const commit = useCallback(() => {
    if (!mountedRef.current) return;
    const current = activeTilesRef.current;
    setActiveTileCount(current.length);
    setCommittedThroughTs(computeCommittedThroughTs(current));

    const visibleKeys = visibleKeysRef.current;
    const allVisibleReady = current.every(e => {
      const key = `${e.tile.startTime}:${e.tile.endTime}`;
      return !visibleKeys.has(key) || e.committedThroughTs !== null;
    });

    if (allVisibleReady) {
      try {
        const data = assembleData(current, tagIdsRef.current, cache);
        setHookResult({ data, isLoading: false, error: null });
      } catch (ex) {
        setHookResult({ data: null, isLoading: false, error: ex instanceof Error ? ex.message : String(ex) });
      }
    } else {
      // Preserve previous data as a bridge while new tiles are loading.
      setHookResult(prev => ({ ...prev, isLoading: true, error: null }));
    }

    setSwapCounter(c => c + 1);

    if (inFlightTilesRef.current.size === 0 && firstFetchFiredAtRef.current !== null) {
      setLastFetchMs(Math.round(performance.now() - firstFetchFiredAtRef.current));
      firstFetchFiredAtRef.current = null;
    }
  }, [cache]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tagIds.length === 0) {
      setHookResult({ data: null, isLoading: false, error: null });
      return;
    }

    const currentViewport: Viewport = { start: viewportStart, end: viewportEnd };

    // Range guard applies only in history mode (live tiles may extend into the future).
    if (!isLiveRef.current) {
      if (isViewportOverRange(currentViewport)) return;
      if (isViewportUnderRange(currentViewport)) return;
    }

    runTileFetch({
      tagIds, bucketCount, tileSpanMs, overfetchPerSide,
      viewport: currentViewport, isLive: isLiveRef.current,
      cache, activeTilesRef, inFlightTilesRef,
      tagGenerationRef, tagIdsRef, visibleKeysRef,
      setHookResult,
      gatedFetchTile,
      nowMs: BigInt(Date.now()),
      commit,
      firstFetchFiredAtRef,
    });
  }, [tagIdsKey, viewportStart, viewportEnd, bucketCount, tileSpanMs, overfetchPerSide, cache, isLive, heartbeat, commit]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidateNonTerminalTiles = useCallback((): void => {
    const current = activeTilesRef.current;
    let mutated = false;
    const next = current.map(entry => {
      if (
        entry.committedThroughTs !== null &&
        entry.committedThroughTs < Number(entry.tile.endTime)
      ) {
        mutated = true;
        return { ...entry, committedThroughTs: null };
      }
      return entry;
    });
    if (mutated) activeTilesRef.current = next;
  }, []);

  return {
    ...hookResult,
    swapCounter,
    activeTileCount,
    lastFetchMs,
    committedThroughTs,
    activeTilesRef,
    invalidateNonTerminalTiles,
  };
}
