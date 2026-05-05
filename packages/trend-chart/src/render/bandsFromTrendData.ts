import type { TrendData } from '../types.js';

export interface BandArrays {
  /** X values in seconds (uPlot convention). Same grid as seriesFromTrendData xs. */
  xs: number[];
  /** Per-tag min arrays, same length as xs, in tagIds order. Null-filled when no band data. */
  mins: Array<(number | null)[]>;
  /** Per-tag max arrays, same length as xs, in tagIds order. Null-filled when no band data. */
  maxs: Array<(number | null)[]>;
}

/**
 * Returns null for the raw path (COV samples have no bucket aggregation).
 * For aggregate, xs match seriesFromTrendData xs exactly.
 * When a tag has no min/max (v0.7 cache entry), its arrays are null-filled.
 */
export function bandsFromTrendData(data: TrendData, tagIds: number[]): BandArrays | null {
  if (data.type !== 'aggregate') return null;

  const n = data.n;
  const bucketSs = data.bucketSMs / 1000;
  const startS = Number(data.startTime) / 1000;

  const xs: number[] = new Array(n);
  for (let k = 0; k < n; k++) {
    xs[k] = startS + k * bucketSs;
  }

  const nullFill: (number | null)[] = new Array(n).fill(null);

  const mins = tagIds.map(tagId => {
    const entry = data.series.get(tagId);
    if (!entry?.min) return nullFill.slice();
    return entry.min.slice(0, n) as (number | null)[];
  });

  const maxs = tagIds.map(tagId => {
    const entry = data.series.get(tagId);
    if (!entry?.max) return nullFill.slice();
    return entry.max.slice(0, n) as (number | null)[];
  });

  return { xs, mins, maxs };
}
