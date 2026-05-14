import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { tilesForViewport } from './level.js';
import { TileCache, makeTileCacheKey } from './tileCache.js';
import type { Tile, Viewport } from './types.js';
import type { GatedFetchFn } from './gatedFetchTile.js';
import {
  chunkArray,
  assembleData,
  computeResponseTailTs,
  storeTileResult,
} from './tileActiveSet.js';
import type { CachedEntry, HookState } from './tileActiveSet.js';

export interface HistoryTileFetchArgs {
  tagIds: number[];
  bucketCount: number;
  visibleTilesPerWindow: number;
  overfetchPerSide: number;
  viewport: Viewport;
  /** Pre-read from liveExitRefetchPendingRef; flag already reset to false by caller. */
  isLiveExitRefetch: boolean;
  cache: TileCache<CachedEntry>;
  /** Snapshot of activeTilesRef.current at call time, for selective eviction in performSwap. */
  oldActiveTiles: Tile[];
  generationRef: MutableRefObject<number>;
  activeTilesRef: MutableRefObject<Tile[]>;
  inFlightTilesRef: MutableRefObject<Set<string>>;
  finalizeRef: MutableRefObject<(() => void) | null>;
  levelTransitionPendingRef: MutableRefObject<boolean>;
  setHookResult: Dispatch<SetStateAction<HookState>>;
  setSwapCounter: Dispatch<SetStateAction<number>>;
  setActiveTileCount: Dispatch<SetStateAction<number>>;
  setLastFetchMs: Dispatch<SetStateAction<number | null>>;
  setResponseTailTs: Dispatch<SetStateAction<number | null>>;
  setRangeExceeded: Dispatch<SetStateAction<boolean>>;
  gatedFetchTile: GatedFetchFn;
}

/**
 * Runs the isTailing=false (history) branch of the main useTrendData effect.
 * Caller is responsible for resetting spineLoadedRef/spineFetchInFlightRef and
 * reading+clearing liveExitRefetchPendingRef before calling. Caller is also
 * responsible for returning the effect cleanup (finalizeRef.current = null).
 */
export function runHistoryTileFetch(args: HistoryTileFetchArgs): void {
  const {
    tagIds, bucketCount, visibleTilesPerWindow, overfetchPerSide, viewport,
    isLiveExitRefetch, cache, oldActiveTiles,
    generationRef, activeTilesRef, inFlightTilesRef, finalizeRef, levelTransitionPendingRef,
    setHookResult, setSwapCounter, setActiveTileCount, setLastFetchMs, setResponseTailTs, setRangeExceeded,
    gatedFetchTile,
  } = args;

  const nowMs = BigInt(Date.now());
  const { visible, prefetch } = tilesForViewport({
    viewport,
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

  // activeTilesRef is NOT reset here — bridge render keeps old data visible
  // until all new visible tiles have settled.
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
}
