/** One tile request — maps directly to the GET /api/v1/trends/tile wire params. */
export interface Tile {
  startTime: bigint;
  endTime: bigint;
  bucketCount: number;
}

/** The chart's currently visible time region. */
export interface Viewport {
  start: bigint;
  end: bigint;
}

/** Assembled data for the aggregate (CAG) path. */
export interface AggregateSeriesData {
  type: 'aggregate';
  source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'mixed';
  startTime: bigint;
  endTime: bigint;
  /** Total bucket count across all visible tiles. */
  n: number;
  /** Bucket width in milliseconds; for the resolution indicator. */
  bucketSMs: number;
  /** tagId → value array of length n. */
  series: Map<number, (number | null)[]>;
}

/** Assembled data for the raw (COV) path. */
export interface RawSeriesData {
  type: 'raw';
  source: 'raw';
  startTime: bigint;
  endTime: bigint;
  /** tagId → irregular change-of-value arrays. */
  series: Map<number, { ts: bigint[]; value: (number | null)[] }>;
}

export type TrendData = AggregateSeriesData | RawSeriesData;
