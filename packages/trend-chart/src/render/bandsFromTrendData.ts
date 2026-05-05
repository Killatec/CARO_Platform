import type { TrendData } from '../types.js';

export interface BandArrays {
  /** X values in seconds (uPlot convention). */
  xs: number[];
  /** Per-tag min arrays, same length as xs, in tagIds order. */
  mins: Array<(number | null)[]>;
  /** Per-tag max arrays, same length as xs, in tagIds order.
   *  In raw mode mins[i] === maxs[i] — same array reference, zero-area band. */
  maxs: Array<(number | null)[]>;
}

/**
 * Converts TrendData into the always-band data shape `{ xs, mins[], maxs[] }`.
 *
 * Aggregate path: xs = epoch-aligned bucket timestamps; mins/maxs from per-tag
 *   band data. Tags with no min/max (v0.7 cache entries) receive null-filled arrays.
 *
 * Raw path: xs = sorted union of all tag ts arrays (COV timestamps in seconds);
 *   per-tag values are forward-filled. mins[i] === maxs[i] (same array reference) so
 *   the band fill polygon collapses to zero area — only the max-series 1px stroke is
 *   visible, rendering the stepped line.
 */
export function bandsFromTrendData(data: TrendData, tagIds: number[]): BandArrays {
  if (data.type === 'aggregate') {
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

  // Raw path: forward-fill per-tag values on the union timestamp grid.
  const allTsSet = new Set<bigint>();
  for (const tagId of tagIds) {
    const s = data.series.get(tagId);
    if (s) {
      for (const t of s.ts) allTsSet.add(t);
    }
  }

  if (allTsSet.size === 0) {
    const empty: (number | null)[] = [];
    // Return same empty array for all tags — mins === maxs for consistency.
    const empties = tagIds.map(() => empty);
    return { xs: [], mins: empties, maxs: empties };
  }

  const sortedTs = Array.from(allTsSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const xs = sortedTs.map(t => Number(t) / 1000);

  const values: Array<(number | null)[]> = tagIds.map(tagId => {
    const s = data.series.get(tagId);
    if (!s) return new Array<number | null>(sortedTs.length).fill(null);

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

  // mins === maxs: same outer array so mins[i] === maxs[i] for every tag.
  // Zero-area band; only the max-series stroke renders the line.
  return { xs, mins: values, maxs: values };
}
