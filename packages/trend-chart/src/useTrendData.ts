import { useEffect, useMemo, useRef, useState } from 'react';
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
  // Aggregate fields
  bucketS?: number;
  n?: number;
  value?: (number | null)[];
  // Raw fields
  ts?: bigint[];
  valueRaw?: (number | null)[];
}

function estimateCachedEntrySize(entry: CachedEntry): number {
  const valueLen = entry.value?.length ?? 0;
  const tsLen = entry.ts?.length ?? 0;
  const rawLen = entry.valueRaw?.length ?? 0;
  return (valueLen + tsLen + rawLen) * 8 + 100;
}

const DEFAULT_CACHE_CAPACITY = 50_000_000;

export interface UseTrendDataOptions {
  viewport: Viewport;
  tagIds: number[];
  bucketCount?: number;
  visibleTilesPerWindow?: number;
  overfetchPerSide?: number;
  cacheCapacityBytes?: number;
}

export interface UseTrendDataResult {
  data: TrendData | null;
  isLoading: boolean;
  error: string | null;
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
        ts: s.ts.map(t => BigInt(t)),
        valueRaw: s.value,
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
        source: res.source,
        bucketS: res.bucketS,
        n: res.n,
        value: s.value,
      });
    }
  }
}

function assembleData(
  visible: Tile[],
  tagIds: number[],
  cache: TileCache<CachedEntry>,
): TrendData | null {
  if (tagIds.length === 0 || visible.length === 0) return null;

  // Determine raw vs aggregate from the first available cache entry.
  let isRaw = false;
  outer: for (const tile of visible) {
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
    const series = new Map<number, { ts: bigint[]; value: (number | null)[] }>();
    for (const tagId of tagIds) {
      const ts: bigint[] = [];
      const value: (number | null)[] = [];
      for (const tile of visible) {
        const entry = cache.get(
          makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        );
        if (entry?.ts && entry.valueRaw) {
          ts.push(...entry.ts);
          value.push(...entry.valueRaw);
        }
      }
      series.set(tagId, { ts, value });
    }
    const result: RawSeriesData = {
      type: 'raw',
      source: 'raw',
      startTime: visible[0]!.startTime,
      endTime: visible[visible.length - 1]!.endTime,
      series,
    };
    return result;
  }

  // Aggregate path — one pass per tile.
  const series = new Map<number, (number | null)[]>();
  for (const tagId of tagIds) series.set(tagId, []);

  const tileSourceSet = new Set<string>();
  let totalN = 0;
  let lastBucketS = 0;

  for (const tile of visible) {
    // Find tile metadata (n, bucketS, source) from any available entry.
    let tileN = tile.bucketCount;
    let tileBucketS = 0;
    let tileSourceFound: string | undefined;
    const tileValues = new Map<number, (number | null)[]>();

    for (const tagId of tagIds) {
      const entry = cache.get(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
      );
      if (entry?.value !== undefined) {
        tileValues.set(tagId, entry.value);
        if (!tileSourceFound && entry.n !== undefined) {
          tileN = entry.n;
          tileBucketS = entry.bucketS ?? 0;
          tileSourceFound = entry.source;
        }
      }
    }

    if (tileSourceFound) tileSourceSet.add(tileSourceFound);
    if (tileBucketS > 0) lastBucketS = tileBucketS;
    totalN += tileN;

    for (const tagId of tagIds) {
      const values = tileValues.get(tagId) ?? new Array<null>(tileN).fill(null);
      series.get(tagId)!.push(...values);
    }
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
    lastBucketS > 0
      ? lastBucketS * 1000
      : totalN > 0
        ? Number(visible[visible.length - 1]!.endTime - visible[0]!.startTime) / totalN
        : 0;

  const result: AggregateSeriesData = {
    type: 'aggregate',
    source: effectiveSource,
    startTime: visible[0]!.startTime,
    endTime: visible[visible.length - 1]!.endTime,
    n: totalN,
    bucketSMs,
    series,
  };
  return result;
}

export function useTrendData(opts: UseTrendDataOptions): UseTrendDataResult {
  const {
    viewport,
    tagIds,
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

  const [hookResult, setHookResult] = useState<UseTrendDataResult>({
    data: null,
    isLoading: true,
    error: null,
  });

  // Incremented on each opts change; async callbacks from stale effects are ignored.
  const generationRef = useRef(0);

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
    const { visible, prefetch } = tilesForViewport({
      viewport: currentViewport,
      bucketCount,
      visibleTilesPerWindow,
      overfetchPerSide,
    });

    if (visible.length === 0) {
      setHookResult({ data: null, isLoading: false, error: null });
      return;
    }

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
      try {
        const data = assembleData(visible, tagIds, cache);
        setHookResult({ data, isLoading: false, error: null });
      } catch (e) {
        setHookResult({ data: null, isLoading: false, error: e instanceof Error ? e.message : String(e) });
      }
    };

    let resolvedCount = 0;
    const totalVisible = visible.length;

    const onVisibleTileSettled = () => {
      resolvedCount++;
      if (resolvedCount < totalVisible) return;
      finalize();
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

    // All visible tiles were already cached — finalize synchronously.
    if (resolvedCount === totalVisible) {
      finalize();
    }

    // ── Prefetch tiles (async, not render-blocking) ───────────────────────────
    for (const tile of prefetch) {
      const missing = getMissing(tile);
      if (missing.length === 0) continue;

      const groups = chunkArray(missing, 8);
      const promises = groups.map(group =>
        fetchTile({ tagIds: group, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }).then(
          res => {
            if (generationRef.current !== generation) return;
            storeTileResult(tile, res, cache);
          },
        ),
      );

      Promise.all(promises).catch(e => {
        if (generationRef.current !== generation) return;
        console.warn('[useTrendData] prefetch fetch failed', {
          tagIds: missing,
          startTime: tile.startTime,
          endTime: tile.endTime,
          error: e,
        });
      });
    }
  }, [tagIdsKey, viewportStart, viewportEnd, bucketCount, visibleTilesPerWindow, overfetchPerSide, cache]);

  return hookResult;
}
