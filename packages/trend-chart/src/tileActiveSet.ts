import { TileCache, makeTileCacheKey } from './tileCache.js';
import type { Tile, ActiveTileEntry, TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { TileApiResponse } from './api.js';

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
  /** DbPipeline commit watermark (ms since epoch) from the response that populated this entry. */
  committedThroughTs?: number;
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
  const committedThroughTs = res.committedThroughTs;

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
        committedThroughTs,
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
        source:            res.source,
        committedThroughTs,
        bucketSMs:         res.bucketSMs,
        n:                 res.n,
        value:             s.value,
        min:               s.min,
        max:               s.max,
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
  //
  // `hasAllMin` is a defensive flag: it stays true as long as every present
  // tile entry for a tag carries a min/max pair, and flips to false the first
  // time a present entry is missing one. The flag is read at the end of the
  // loop to decide whether to emit bands (`{ value, min, max }`) or fall back
  // to a value-only series.
  //
  // In normal operation the flag never flips: the TileApiResponse type requires
  // min/max on every aggregate response, so storeTileResult cannot write a cache
  // entry without them, and entry.data on a non-terminal tile is built from the
  // same response type. The flag exists so future cache-shape variants (or any
  // path that bypasses the type system) degrade to "no bands for that tag"
  // rather than rendering a partial band that would be visually misleading.
  type AggTagAccum = {
    value:     (number | null)[];
    mins:      (number | null)[];
    maxs:      (number | null)[];
    hasAllMin: boolean;
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
      // Defensive: a present entry without min disables bands for this tag
      // — see the AggTagAccum type comment above for the rationale.
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
    committedThroughTs: res.committedThroughTs,
    shape: res.source === 'raw' ? 'raw' : 'aggregate',
    data: null,
  };
}

/** Constructs an ActiveTileEntry from a CachedEntry on cache hit. data=null because
 *  the entry is in the LRU. */
export function makeActiveTileEntryFromCache(tile: Tile, cached: CachedEntry): ActiveTileEntry {
  return {
    tile,
    committedThroughTs: cached.committedThroughTs ?? null,
    shape: cached.source === 'raw' ? 'raw' : 'aggregate',
    data: null,
  };
}

/**
 * Stores a synthesized null tile into the LRU cache so the terminal-cache rule
 * is satisfied and the refetch trigger predicate becomes false (§4.3).
 * committedThroughTs is set to Number(tile.endTime) so committedThroughTs >= endTime.
 */
export function storeNullTile(
  tile: Tile,
  shape: 'raw' | 'aggregate',
  tagIds: number[],
  cache: TileCache<CachedEntry>,
): void {
  const committedThroughTs = Number(tile.endTime);
  const n = tile.bucketCount;
  if (shape === 'aggregate') {
    const bucketSMs = n > 0 ? Number(tile.endTime - tile.startTime) / n : 0;
    const nullArr = (): (number | null)[] => new Array<null>(n).fill(null);
    for (const tagId of tagIds) {
      cache.set(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        { source: 'mixed', committedThroughTs, bucketSMs, n, value: nullArr(), min: nullArr(), max: nullArr() },
      );
    }
  } else {
    for (const tagId of tagIds) {
      cache.set(
        makeTileCacheKey({ tagId, startTime: tile.startTime, endTime: tile.endTime, bucketCount: tile.bucketCount }),
        { source: 'raw', committedThroughTs, ts: [], valueRaw: [] },
      );
    }
  }
}

/**
 * Derives the maximum committedThroughTs across active-tile entries.
 * Reads committedThroughTs directly from each entry — no cache lookup.
 * Returns null if all entries have null committedThroughTs (no fetches resolved yet).
 */
export function computeCommittedThroughTs(entries: ActiveTileEntry[]): number | null {
  let max: number | null = null;
  for (const entry of entries) {
    if (entry.committedThroughTs !== null) {
      if (max === null || entry.committedThroughTs > max) max = entry.committedThroughTs;
    }
  }
  return max;
}

