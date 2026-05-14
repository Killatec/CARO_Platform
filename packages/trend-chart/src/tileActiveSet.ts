import { TileCache, makeTileCacheKey } from './tileCache.js';
import type { Tile, TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { TileApiResponse } from './api.js';

export const MAX_ACTIVE_TILES = 8;

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Per-(tagId, tile) cache entry.
type TileSource = TileApiResponse['source'];

export interface CachedEntry {
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

export function estimateCachedEntrySize(entry: CachedEntry): number {
  const valueLen = entry.value?.length ?? 0;
  const minLen   = entry.min?.length   ?? 0;
  const maxLen   = entry.max?.length   ?? 0;
  const tsLen    = entry.ts?.length    ?? 0;
  const rawLen   = entry.valueRaw?.length ?? 0;
  return (valueLen + minLen + maxLen + tsLen + rawLen) * 8 + 100;
}

export interface HookState {
  data: TrendData | null;
  isLoading: boolean;
  error: string | null;
}

export function storeTileResult(
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

export function assembleData(
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
export function computeResponseTailTs(
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
 * Add `newTile` to `activeSet` and prune to `maxSize`.
 *
 * - newTile left of extent  → drop rightmost tile.
 * - newTile right of extent → drop leftmost tile.
 * - newTile in the middle (gap-fill or extension into a discontiguous region)
 *   → drop leftmost tile.
 */
export function pruneAndAdd(activeSet: Tile[], newTile: Tile, maxSize = MAX_ACTIVE_TILES): Tile[] {
  if (activeSet.length === 0) return [newTile];
  const sorted = [...activeSet, newTile].sort((a, b) => Number(a.startTime - b.startTime));
  if (sorted.length <= maxSize) return sorted;

  const isLeftEnd = newTile.startTime < activeSet[0]!.startTime;
  if (isLeftEnd) return sorted.slice(0, maxSize);
  return sorted.slice(sorted.length - maxSize);
}
