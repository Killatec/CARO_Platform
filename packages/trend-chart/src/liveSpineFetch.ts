import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { Tile, Viewport, TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { TileApiResponse } from './api.js';
import type { GatedFetchFn } from './gatedFetchTile.js';
import { isClientFetchSentinel } from './gatedFetchTile.js';
import type { HookState } from './tileActiveSet.js';
import { chunkArray } from './tileActiveSet.js';

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

export interface LiveSpineFetchArgs {
  tagIds: number[];
  bucketCount: number;
  visibleTilesPerWindow: number;
  viewport: Viewport;
  spanChanged: boolean;
  gatedFetchTile: GatedFetchFn;
  spineLoadedRef: MutableRefObject<boolean>;
  spineFetchInFlightRef: MutableRefObject<boolean>;
  generationRef: MutableRefObject<number>;
  activeTilesRef: MutableRefObject<Tile[]>;
  inFlightTilesRef: MutableRefObject<Set<string>>;
  setHookResult: Dispatch<SetStateAction<HookState>>;
  setSwapCounter: Dispatch<SetStateAction<number>>;
  setLastFetchMs: Dispatch<SetStateAction<number | null>>;
  setResponseTailTs: Dispatch<SetStateAction<number | null>>;
  setActiveTileCount: Dispatch<SetStateAction<number>>;
}

/**
 * Runs the isTailing=true branch of the main useTrendData effect.
 * Returns early (no-op) if the span is unchanged and the spine is already
 * loaded or in-flight. Caller is responsible for returning the effect cleanup.
 */
export function runLiveSpineFetch(args: LiveSpineFetchArgs): void {
  const {
    tagIds, bucketCount, visibleTilesPerWindow, viewport, spanChanged,
    gatedFetchTile,
    spineLoadedRef, spineFetchInFlightRef, generationRef,
    activeTilesRef, inFlightTilesRef,
    setHookResult, setSwapCounter, setLastFetchMs, setResponseTailTs, setActiveTileCount,
  } = args;

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
    startTime: viewport.start,
    endTime: viewport.end,
    bucketCount: visibleTilesPerWindow * bucketCount,
  };

  const generation = ++generationRef.current;
  const batchT0 = performance.now();
  setHookResult(prev => ({ ...prev, isLoading: true }));

  spineFetchInFlightRef.current = true;
  // Promise resolution order: generation check FIRST, then clear the flag.
  //
  // Safe under the current three-bump invariant for generationRef.current.
  // Every code path that bumps generationRef past a pending live-spine
  // fetch's captured generation also leaves spineFetchInFlightRef in a
  // consistent state for the new generation:
  //
  //   - this function (line above, ++generationRef.current): the new live
  //     fetch re-sets the flag to true immediately after.
  //   - useTrendData.ts:167-168 (history-mode entry): explicitly clears
  //     the flag to false BEFORE runHistoryTileFetch bumps the generation.
  //   - useTrendData.ts:304-311 (evictAll): clears the flag and bumps the
  //     generation atomically.
  //
  // Consequence: a stale-generation .then/.catch returning early WITHOUT
  // clearing the flag is always a no-op — the flag is already in the right
  // state for whatever generation is now current. Inverting the order
  // (clear-before-gen-check) would not be wrong today but accomplishes
  // nothing, and would become actively incorrect if a fourth gen-bump path
  // were added that did NOT clear the flag. If you find yourself adding
  // such a path, also clear spineFetchInFlightRef there OR migrate to a
  // per-generation ref pattern.
  //
  // Audit 2026-05-15 BUG-2: examined; closed as no-defect.
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
    if (isClientFetchSentinel(e)) return;
    console.error('[useTrendData] live spine fetch failed', { tagIds, error: e });
    setHookResult({ data: null, isLoading: false, error: e instanceof Error ? e.message : String(e) });
  });
}
