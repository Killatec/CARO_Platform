import type { TrendData } from '../types.js';

export interface SeriesArrays {
  /** X values in seconds (uPlot convention). */
  xs: number[];
  /** Per-tag Y value arrays, same length as xs, in tagIds order. */
  ys: Array<(number | null)[]>;
}

/**
 * Converts TrendData into uPlot's data array shape [xs, ys1, ys2, ...].
 *
 * Aggregate path: xs are epoch-aligned bucket start times in seconds.
 * Raw path: xs are the union of all tag ts arrays sorted ascending; each tag's
 * values are forward-filled between its own change points.
 */
export function seriesFromTrendData(data: TrendData, tagIds: number[]): SeriesArrays {
  if (data.type === 'aggregate') {
    const n = data.n;
    const bucketSs = data.bucketSMs / 1000;
    const startS = Number(data.startTime) / 1000;

    const xs: number[] = new Array(n);
    for (let k = 0; k < n; k++) {
      xs[k] = startS + k * bucketSs;
    }

    // Aggregate mode: band series (min/max) replace the value line.
    // Callers use bandsFromTrendData for the actual series data.
    return { xs, ys: [] };
  }

  // Raw path: collect union of all ts values, sort, forward-fill per tag.
  const allTsSet = new Set<bigint>();
  for (const tagId of tagIds) {
    const s = data.series.get(tagId);
    if (s) {
      for (const t of s.ts) allTsSet.add(t);
    }
  }

  if (allTsSet.size === 0) {
    return { xs: [], ys: tagIds.map(() => []) };
  }

  const sortedTs = Array.from(allTsSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const xs = sortedTs.map(t => Number(t) / 1000);

  const ys = tagIds.map(tagId => {
    const s = data.series.get(tagId);
    if (!s) return new Array<number | null>(sortedTs.length).fill(null);

    // Build a lookup map from ts → value for this tag.
    const valueAtTs = new Map<bigint, number | null>();
    for (let i = 0; i < s.ts.length; i++) {
      valueAtTs.set(s.ts[i]!, s.value[i] ?? null);
    }

    let lastValue: number | null = null;
    return sortedTs.map(t => {
      if (valueAtTs.has(t)) {
        lastValue = valueAtTs.get(t)!;
      }
      return lastValue;
    });
  });

  return { xs, ys };
}
