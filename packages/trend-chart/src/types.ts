/** One tile request — maps directly to the GET /api/v1/trends/tile wire params. */
export interface Tile {
  startTime: bigint;
  endTime: bigint;
  bucketCount: number;
}

/**
 * A slot in the bounded active-tile set.
 * committedThroughTs and shape are null until the first fetch for this tile resolves.
 */
export interface ActiveTileEntry {
  tile: Tile;
  /** DbPipeline commit watermark (ms since epoch) from the response. null until first fetch resolves. */
  committedThroughTs: number | null;
  /**
   * 'raw' for source==='raw' responses; 'aggregate' for tag_samples / *_cagg / mixed.
   * null until first fetch resolves.
   * Used by storeNullTile on refetch failure to produce the correct shape.
   */
  shape: 'raw' | 'aggregate' | null;
  /**
   * When set, the tile is uncached (committedThroughTs < tile.endTime) and this field
   * holds the assembled response data for rendering. Cached (terminal) entries set
   * this to null — data is read from the LRU by assembleData.
   */
  data: AggregateSeriesData | RawSeriesData | null;
}

/** The chart's currently visible time region. */
export interface Viewport {
  start: bigint;
  end: bigint;
}

/** Assembled data for the aggregate (CAG) path. */
export interface AggregateSeriesData {
  type: 'aggregate';
  source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'tag_samples' | 'mixed';
  startTime: bigint;
  endTime: bigint;
  /** Total bucket count across all visible tiles. */
  n: number;
  /** Bucket width in milliseconds; for the resolution indicator. */
  bucketSMs: number;
  /** tagId → per-bucket arrays of length n. min/max are undefined only when a
   *  v0.7 cache entry (no bands) is present; renderers guard `if (entry.min)`. */
  series: Map<number, {
    value: (number | null)[];
    min?:  (number | null)[];
    max?:  (number | null)[];
  }>;
}

/** Assembled data for the raw (COV) path. */
export interface RawSeriesData {
  type: 'raw';
  source: 'raw';
  startTime: bigint;
  endTime: bigint;
  /** tagId → irregular change-of-value arrays with optional bounded-prev seed. */
  series: Map<number, {
    ts: bigint[];
    value: (number | null)[];
    /** Most recent sample before startTime (§5.5 bounded-prev, v0.9+). */
    prev?: { ts: bigint; value: number | null };
  }>;
}

export type TrendData = AggregateSeriesData | RawSeriesData;
