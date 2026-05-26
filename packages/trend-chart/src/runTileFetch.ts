import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { tilesForViewport, REFETCH_LAG_MS } from './level.js';
import { TileCache, makeTileCacheKey } from './tileCache.js';
import type { Tile, ActiveTileEntry, Viewport, AggregateSeriesData, RawSeriesData } from './types.js';
import type { TileApiResponse } from './api.js';
import type { GatedFetchFn } from './gatedFetchTile.js';
import { isClientFetchSentinel } from './gatedFetchTile.js';
import {
  chunkArray,
  assembleData,
  computeCommittedThroughTs,
  storeTileResult,
  storeNullTile,
  makeActiveTileEntryFromCache,
} from './tileActiveSet.js';
import type { CachedEntry, HookState } from './tileActiveSet.js';

export interface TileFetchArgs {
  tagIds: number[];
  bucketCount: number;
  tileSpanMs: bigint;
  overfetchPerSide: number;
  viewport: Viewport;
  /** true when called from the Live path (overfetchRightCount=0, terminal-cache rule). */
  isLive: boolean;
  cache: TileCache<CachedEntry>;
  activeTilesRef: MutableRefObject<ActiveTileEntry[]>;
  inFlightTilesRef: MutableRefObject<Set<string>>;
  /** Bumped only on tagIds change; never on viewport or heartbeat. Run-independent dedup guard. */
  tagGenerationRef: MutableRefObject<number>;
  /** Ref-tracked tagIds — synced at the top of each runTileFetch call. */
  tagIdsRef: MutableRefObject<number[]>;
  /** Set of tile keys in the VISIBLE set for the current run. Updated on every call. */
  visibleKeysRef: MutableRefObject<Set<string>>;
  setHookResult: Dispatch<SetStateAction<HookState>>;
  gatedFetchTile: GatedFetchFn;
  /** Current wall-clock time in ms (BigInt). Passed in so tests can inject deterministic values. */
  nowMs: bigint;
  /** Stable commit callback from useTrendData — re-renders after each resolve. */
  commit: () => void;
  /** Set when the first fetch of a batch fires; cleared in commit when inFlight reaches 0. */
  firstFetchFiredAtRef: MutableRefObject<number | null>;
}

/**
 * Assembles parallel tile-group responses (fetched for the same tile, split by tagId batch
 * to avoid overlong query strings) into a single TrendData for storing in entry.data.
 * Used for uncached (non-terminal) live-edge tiles that are not written to the LRU.
 */
function assembleResponses(
  responses: TileApiResponse[],
  tile: Tile,
  tagIds: number[],
): AggregateSeriesData | RawSeriesData | null {
  if (responses.length === 0 || tagIds.length === 0) return null;

  const isRaw = responses.every(r => r.source === 'raw');

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
      type: 'raw', source: 'raw',
      startTime: tile.startTime, endTime: tile.endTime,
      series,
    };
    return result;
  }

  // Aggregate path — n and bucketSMs are tile-uniform across all groups.
  const firstAgg = responses.find(r => r.source !== 'raw');
  if (!firstAgg) return null;
  const { n, bucketSMs } = firstAgg;

  const sources = new Set(responses.filter(r => r.source !== 'raw').map(r => r.source));
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
    type: 'aggregate', source: effectiveSource,
    startTime: tile.startTime, endTime: tile.endTime,
    n, bucketSMs, series: seriesMap,
  };
  return result;
}

/**
 * §5.2 freshness predicate: returns true iff `tile` needs a network fetch.
 * Exported for direct unit testing; `runTileFetch` calls it with a snapshot of
 * activeTilesRef.current captured before the fetch loop begins.
 */
export function needsFetch(
  tile: Tile,
  tagIds: number[],
  cache: TileCache<CachedEntry>,
  activeTiles: ActiveTileEntry[],
  isLive: boolean,
  nowMs: bigint,
  viewportEnd: bigint,
): boolean {
  const allCached = tagIds.every(tagId =>
    cache.has(makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount })),
  );
  if (allCached) return false;

  const entry = activeTiles.find(
    e => e.tile.startTime === tile.startTime && e.tile.endTime === tile.endTime,
  );
  if (!entry) return true;
  if (entry.committedThroughTs === null) return true;

  // Tile has rolled comfortably into the past → re-fetch to get a terminal (cached) copy.
  if (Number(tile.endTime) <= Number(nowMs) - REFETCH_LAG_MS) return true;

  // Live: line 143 handles tiles that have rolled into the past; the WS tail
  // handles the live-edge tile in steady state; invalidateNonTerminalTiles
  // handles Fixed→Live transitions. No other mid-flight live re-fetch.
  if (isLive) return false;

  // Fixed/historical: data is fresh if it reaches the viewport end.
  return entry.committedThroughTs < Number(viewportEnd);
}

/**
 * Unified tile-fetch orchestration — §5.1 v1.5 / §5.6 run-independent resolve flow.
 *
 * Per run:
 *   1. Compute required tile set via tilesForViewport.
 *   2. Sort; update visibleKeysRef.
 *   3. Tag-change detection → bump tagGenerationRef only on tag change.
 *   4. resolveEntry: existing entry (identity) > LRU cache > placeholder.
 *      Build nextActive; any tag change forces a commit even when toFetch is empty.
 *   5. toFetch = need-it tiles not already in inFlightTilesRef.
 *   6. No-op: toFetch empty + same tags + element-wise identity → early return.
 *   7. activeTilesRef = nextActive; commit().
 *   8. Fire fetches — resolve handlers are run-independent (see §5.6).
 */
export function runTileFetch(args: TileFetchArgs): void {
  const {
    tagIds, bucketCount, tileSpanMs, overfetchPerSide, viewport,
    isLive, cache,
    activeTilesRef, inFlightTilesRef, tagGenerationRef, tagIdsRef, visibleKeysRef,
    setHookResult,
    gatedFetchTile,
    nowMs, commit, firstFetchFiredAtRef,
  } = args;

  // Step 1: compute required tile set.
  const { visible, prefetch } = tilesForViewport({
    viewport,
    tileSpanMs,
    bucketCount,
    overfetchPerSide,
    overfetchRightCount: isLive ? 0 : undefined,
    nowMs,
  });

  if (visible.length === 0) {
    setHookResult({ data: null, isLoading: false, error: null });
    return;
  }

  // Step 2: sort required set; update visibleKeysRef.
  const newSorted = [...prefetch, ...visible].sort(
    (a, b) => Number(a.startTime - b.startTime),
  );
  visibleKeysRef.current = new Set(visible.map(t => `${t.startTime}:${t.endTime}`));

  // Step 3: tag-change detection — bump tagGenerationRef only on change.
  const prevTagIds = tagIdsRef.current;
  const sameTagIds =
    tagIds.length === prevTagIds.length &&
    tagIds.every((id, i) => id === prevTagIds[i]);
  if (!sameTagIds) {
    tagGenerationRef.current++;
    tagIdsRef.current = [...tagIds];
  }
  const gen = tagGenerationRef.current;

  // Step 4: resolveEntry — returns SAME OBJECT when entry is already correct (load-bearing
  // for the no-op identity check in step 6).
  const resolveEntry = (tile: Tile): ActiveTileEntry => {
    // Existing active entry with data (terminal or non-terminal) — preserve identity.
    const active = activeTilesRef.current.find(
      e => e.tile.startTime === tile.startTime && e.tile.endTime === tile.endTime,
    );
    if (active && active.committedThroughTs !== null) return active;
    // LRU cache hit → terminal-mirror (new object, triggers no-op to fail for new tiles).
    for (const tagId of tagIds) {
      const e = cache.get(makeTileCacheKey({
        tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount,
      }));
      if (e) return makeActiveTileEntryFromCache(tile, e);
    }
    // Existing placeholder — preserve identity.
    if (active) return active;
    // New placeholder.
    return { tile, committedThroughTs: null, shape: null, data: null };
  };

  const nextActive = newSorted.map(resolveEntry);

  // Step 5: tiles that need a fetch and are not already in flight.
  const activeTilesSnapshot = activeTilesRef.current;
  const predicate = (tile: Tile) =>
    needsFetch(tile, tagIds, cache, activeTilesSnapshot, isLive, nowMs, viewport.end);

  const toFetch = newSorted.filter(tile => {
    if (!predicate(tile)) return false;
    return !inFlightTilesRef.current.has(`${tile.startTime}:${tile.endTime}`);
  });

  // Step 6: pure no-op — tile set unchanged, tags unchanged, nothing to fetch.
  if (
    toFetch.length === 0 &&
    sameTagIds &&
    nextActive.length === activeTilesRef.current.length &&
    nextActive.every((e, i) => e === activeTilesRef.current[i])
  ) {
    return;
  }

  // Step 7: publish new active set and commit.
  activeTilesRef.current = nextActive;
  commit();

  // Step 8: fire fetches — resolve flow is run-independent (§5.6).
  for (const tile of toFetch) {
    const key = `${tile.startTime}:${tile.endTime}`;
    const isVisible = visibleKeysRef.current.has(key);

    inFlightTilesRef.current.add(key);
    if (firstFetchFiredAtRef.current === null) {
      firstFetchFiredAtRef.current = performance.now();
    }

    const missing = tagIds.filter(tagId =>
      !cache.has(makeTileCacheKey({
        tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount,
      })),
    );
    // Fall back to full tagIds if all happen to be cached (predicate fired on stale entry).
    const fetchTagIds = missing.length > 0 ? missing : tagIds;
    const groups = chunkArray(fetchTagIds, 8);
    const groupPromises = groups.map(group =>
      gatedFetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
    );

    Promise.all(groupPromises)
      .then(responses => {
        inFlightTilesRef.current.delete(key);

        // Safety: no groups fetched → can't determine terminal status, skip.
        if (responses.length === 0) return;
        // Min: tile is complete only when every group's response confirms it.
        const minCommittedTs = responses.reduce((m, r) => Math.min(m, r.committedThroughTs), responses[0]!.committedThroughTs);
        const isTerminal = minCommittedTs >= Number(tile.endTime);

        if (isTerminal) {
          // Terminal resolves write LRU unconditionally — durable regardless of which run fired.
          for (const res of responses) storeTileResult(tile, res, cache);
          const idx = activeTilesRef.current.findIndex(
            e => e.tile.startTime === tile.startTime && e.tile.endTime === tile.endTime,
          );
          if (idx !== -1) {
            const firstRes = responses[0];
            const shape: 'raw' | 'aggregate' = firstRes?.source === 'raw' ? 'raw' : 'aggregate';
            const newEntries = [...activeTilesRef.current];
            newEntries[idx] = { tile, committedThroughTs: minCommittedTs, shape, data: null };
            activeTilesRef.current = newEntries;
            commit();
          }
        } else {
          // Non-terminal: patch in place only if tags unchanged and tile still in active set.
          if (gen !== tagGenerationRef.current) return;
          const idx = activeTilesRef.current.findIndex(
            e => e.tile.startTime === tile.startTime && e.tile.endTime === tile.endTime,
          );
          if (idx === -1) return;
          const data = assembleResponses(responses, tile, tagIds);
          const firstRes = responses[0];
          const shape: 'raw' | 'aggregate' = firstRes?.source === 'raw' ? 'raw' : 'aggregate';
          const newEntries = [...activeTilesRef.current];
          newEntries[idx] = { tile, committedThroughTs: minCommittedTs, shape, data };
          activeTilesRef.current = newEntries;
          commit();
        }
      })
      .catch((e: Error & { code?: string }) => {
        inFlightTilesRef.current.delete(key);
        if (isClientFetchSentinel(e)) return;

        if (isVisible) {
          console.error('[useTrendData] visible tile fetch failed', {
            tagIds: missing,
            startTime: tile.startTime,
            endTime: tile.endTime,
            error: e,
          });
        } else {
          console.warn('[useTrendData] prefetch fetch failed', {
            tagIds: missing,
            startTime: tile.startTime,
            endTime: tile.endTime,
            error: e,
          });
        }

        const idx = activeTilesRef.current.findIndex(
          en => en.tile.startTime === tile.startTime && en.tile.endTime === tile.endTime,
        );
        if (idx === -1) return;

        const existingEntry = activeTilesRef.current[idx]!;
        // §4.3: cache a null tile if shape is known, preventing a retry storm.
        if (existingEntry.shape !== null) {
          storeNullTile(tile, existingEntry.shape, tagIds, cache);
        }
        // Mark as settled (committedThroughTs set) so allVisibleReady can advance.
        const newEntries = [...activeTilesRef.current];
        newEntries[idx] = {
          tile,
          committedThroughTs: Number(tile.endTime),
          shape: existingEntry.shape,
          data: null,
        };
        activeTilesRef.current = newEntries;
        commit();
      });
  }
}
