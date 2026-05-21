import { TileCache, makeTileCacheKey } from './tileCache.js';
import type { Tile, ActiveTileEntry, TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
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
  entries: ActiveTileEntry[],
  tagIds: number[],
  cache: TileCache<CachedEntry>,
): TrendData | null {
  if (tagIds.length === 0 || entries.length === 0) return null;

  // Determine raw vs aggregate from the first available source (entry.data or cache).
  let isRaw = false;
  outer: for (const entry of entries) {
    if (entry.data !== null) {
      isRaw = entry.data.type === 'raw';
      break outer;
    }
    const { tile } = entry;
    for (const tagId of tagIds) {
      const cached = cache.get(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
      );
      if (cached) {
        isRaw = cached.source === 'raw';
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
      for (const entry of entries) {
        // Uncached live-edge entry: read from entry.data
        if (entry.data !== null && entry.data.type === 'raw') {
          const s = entry.data.series.get(tagId);
          if (s) {
            ts.push(...s.ts);
            value.push(...s.value);
            if (prev === undefined && s.prev) prev = s.prev;
          }
          continue;
        }
        const { tile } = entry;
        const cached = cache.get(
          makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        );
        if (cached?.ts && cached.valueRaw) {
          ts.push(...cached.ts);
          value.push(...cached.valueRaw);
          // Use the leftmost tile's prev — it has the earliest preceding sample.
          if (prev === undefined && cached.prev) prev = cached.prev;
        }
      }
      series.set(tagId, prev !== undefined ? { ts, value, prev } : { ts, value });
    }
    const result: RawSeriesData = {
      type: 'raw',
      source: 'raw',
      startTime: entries[0]!.tile.startTime,
      endTime: entries[entries.length - 1]!.tile.endTime,
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

  for (const entry of entries) {
    const { tile } = entry;
    let tileN = tile.bucketCount;
    let tileBucketSMs = 0;
    let tileSourceFound: string | undefined;
    const tileData = new Map<number, { value: (number|null)[]; min?: (number|null)[]; max?: (number|null)[] }>();

    // Uncached live-edge entry: read from entry.data instead of LRU.
    if (entry.data !== null && entry.data.type === 'aggregate') {
      for (const tagId of tagIds) {
        const s = entry.data.series.get(tagId);
        if (s) tileData.set(tagId, s);
      }
      tileN = entry.data.n;
      tileBucketSMs = entry.data.bucketSMs;
      tileSourceFound = entry.data.source;
    } else {
      for (const tagId of tagIds) {
        const cached = cache.get(
          makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        );
        if (cached?.value !== undefined) {
          tileData.set(tagId, { value: cached.value, min: cached.min, max: cached.max });
          if (!tileSourceFound && cached.n !== undefined) {
            tileN = cached.n;
            tileBucketSMs = cached.bucketSMs ?? 0;
            tileSourceFound = cached.source;
          }
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
        ? Math.round(Number(entries[entries.length - 1]!.tile.endTime - entries[0]!.tile.startTime) / totalN)
        : 0;

  if (!Number.isInteger(bucketSMs)) {
    throw new Error(`useTrendData: bucketSMs must be integer, got ${bucketSMs}`);
  }

  const result: AggregateSeriesData = {
    type: 'aggregate',
    source: effectiveSource,
    startTime: entries[0]!.tile.startTime,
    endTime: entries[entries.length - 1]!.tile.endTime,
    n: totalN,
    bucketSMs,
    series,
  };
  return result;
}

/** Constructs a terminal (cached) ActiveTileEntry from a fetch response. data=null because
 *  the response has already been stored in the LRU by the caller. */
export function makeActiveTileEntry(tile: Tile, res: TileApiResponse): ActiveTileEntry {
  return {
    tile,
    responseTailTs: res.responseTailTs,
    shape: res.source === 'raw' ? 'raw' : 'aggregate',
    data: null,
  };
}

/** Constructs an ActiveTileEntry from a CachedEntry on cache hit. data=null because
 *  the entry is in the LRU. */
export function makeActiveTileEntryFromCache(tile: Tile, cached: CachedEntry): ActiveTileEntry {
  return {
    tile,
    responseTailTs: cached.responseTailTs ?? null,
    shape: cached.source === 'raw' ? 'raw' : 'aggregate',
    data: null,
  };
}

/**
 * Synthesizes a null TrendData object for a failed tile refetch (§4.3).
 * All value/min/max buckets are null (aggregate) or empty arrays (raw).
 * Caller is responsible for storing this in the LRU and updating the entry's
 * responseTailTs = Number(tile.endTime).
 */
export function synthesizeNullTile(
  tile: Tile,
  shape: 'raw' | 'aggregate',
  tagIds: number[],
): AggregateSeriesData | RawSeriesData {
  if (shape === 'aggregate') {
    const n = tile.bucketCount;
    const bucketSMs = n > 0 ? Number(tile.endTime - tile.startTime) / n : 0;
    const nullArr = (): (number | null)[] => new Array<null>(n).fill(null);
    const series = new Map<number, { value: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>();
    for (const tagId of tagIds) {
      series.set(tagId, { value: nullArr(), min: nullArr(), max: nullArr() });
    }
    const result: AggregateSeriesData = {
      type: 'aggregate',
      source: 'mixed',
      startTime: tile.startTime,
      endTime: tile.endTime,
      n,
      bucketSMs,
      series,
    };
    return result;
  }
  // Raw: empty series per tag.
  const series = new Map<number, { ts: bigint[]; value: (number | null)[] }>();
  for (const tagId of tagIds) {
    series.set(tagId, { ts: [], value: [] });
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

/**
 * Stores a synthesized null tile into the LRU cache so the terminal-cache rule
 * is satisfied and the refetch trigger predicate becomes false (§4.3).
 * responseTailTs is set to Number(tile.endTime) so responseTailTs >= endTime.
 */
export function storeNullTile(
  tile: Tile,
  shape: 'raw' | 'aggregate',
  tagIds: number[],
  cache: TileCache<CachedEntry>,
): void {
  const responseTailTs = Number(tile.endTime);
  const n = tile.bucketCount;
  if (shape === 'aggregate') {
    const bucketSMs = n > 0 ? Number(tile.endTime - tile.startTime) / n : 0;
    const nullArr = (): (number | null)[] => new Array<null>(n).fill(null);
    for (const tagId of tagIds) {
      cache.set(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        { source: 'mixed', responseTailTs, bucketSMs, n, value: nullArr(), min: nullArr(), max: nullArr() },
      );
    }
  } else {
    for (const tagId of tagIds) {
      cache.set(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        { source: 'raw', responseTailTs, ts: [], valueRaw: [] },
      );
    }
  }
}

/**
 * Derives the maximum responseTailTs across active-tile entries.
 * Reads responseTailTs directly from each entry — no cache lookup.
 * Returns null if all entries have null responseTailTs (no fetches resolved yet).
 */
export function computeResponseTailTs(entries: ActiveTileEntry[]): number | null {
  let max: number | null = null;
  for (const entry of entries) {
    if (entry.responseTailTs !== null) {
      if (max === null || entry.responseTailTs > max) max = entry.responseTailTs;
    }
  }
  return max;
}

/**
 * Add `newEntry` to `activeSet` and prune to `maxSize`.
 *
 * - newEntry left of extent  → drop rightmost entry.
 * - newEntry right of extent → drop leftmost entry.
 * - newEntry in the middle (gap-fill or extension into a discontiguous region)
 *   → drop leftmost entry.
 */
export function pruneAndAdd(activeSet: ActiveTileEntry[], newEntry: ActiveTileEntry, maxSize = MAX_ACTIVE_TILES): ActiveTileEntry[] {
  if (activeSet.length === 0) return [newEntry];
  const sorted = [...activeSet, newEntry].sort((a, b) => Number(a.tile.startTime - b.tile.startTime));
  if (sorted.length <= maxSize) return sorted;

  const isLeftEnd = newEntry.tile.startTime < activeSet[0]!.tile.startTime;
  if (isLeftEnd) return sorted.slice(0, maxSize);
  return sorted.slice(sorted.length - maxSize);
}
