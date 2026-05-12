import type { TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { LiveTail, AggregateTail, RawTail } from './useLiveSubscription.js';

/**
 * Concatenates cached tile data with a live tail extension.
 *
 * Rules:
 *   cached === null          → null  (no data yet)
 *   live === null            → cached unchanged
 *   aggregate + aggregate    → merged array; live overrides overlap, LOCF fills gap;
 *                              when isTailing, cached is clipped to liveEndIndex to
 *                              prevent LOCF gapfill from after-prefetch tiles from
 *                              overwriting real live data past live's coverage end.
 *   raw + raw                → concatenated with dedup of live entries ≤ max(cached.ts)
 *   type mismatch            → cached returned unchanged + console.warn
 */
export function mergeTrendData(
  cached: TrendData | null,
  live: LiveTail,
  isTailing = false,
): TrendData | null {
  if (cached === null) return null;
  if (live === null) return cached;

  if (cached.type === 'aggregate' && live.mode === 'aggregate') {
    return mergeAggregate(cached, live, isTailing);
  }
  if (cached.type === 'raw' && live.mode === 'raw') {
    return mergeRaw(cached, live, isTailing);
  }

  // Should not happen when the container derives tailMode from cached.type.
  console.warn('[mergeTrendData] type mismatch: cached=%s live=%s', cached.type, live.mode);
  return cached;
}

// ─── Aggregate merge ──────────────────────────────────────────────────────────

function mergeAggregate(
  cached: AggregateSeriesData,
  live: AggregateTail,
  isTailing: boolean,
): AggregateSeriesData {
  // Index into cached's bucket array where live data begins.
  const liveStartIndex = Number(
    (live.startMs - cached.startTime) / BigInt(cached.bucketSMs),
  );

  // Union of all tag IDs across cached and live.
  const allTagIds = new Set([...cached.series.keys(), ...live.perTag.keys()]);

  // Max live length across all tags — used for the tailing clip boundary.
  let maxLiveLen = 0;
  for (const liveArrs of live.perTag.values()) {
    if (liveArrs.value.length > maxLiveLen) maxLiveLen = liveArrs.value.length;
  }
  const liveEndIndex = liveStartIndex + maxLiveLen;

  // In tailing mode, clip cached to liveEndIndex so LOCF gapfill from the
  // after-prefetch tile (which covers future buckets the server backfilled at
  // fetch time) does not replace real live data past live's coverage end.
  // Guard: only clip when liveEndIndex > 0 (i.e. live has data that extends
  // past cached.startTime); an empty live tail (liveEndIndex ≤ 0) is a no-op.
  const effectiveCachedN = (isTailing && liveEndIndex > 0)
    ? Math.min(cached.n, Math.max(0, liveEndIndex))
    : cached.n;

  // Total bucket count: effective cached extent or live extent, whichever is larger.
  const totalN = Math.max(effectiveCachedN, liveEndIndex);

  const newSeries = new Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>();

  for (const tagId of allTagIds) {
    const cachedArrs = cached.series.get(tagId);
    const liveArrs   = live.perTag.get(tagId) ?? { value: [], min: [], max: [] };

    // Last cached values — used as LOCF for any gap between effectiveCachedN and liveStartIndex.
    const lastCachedV   = cachedArrs ? (cachedArrs.value[effectiveCachedN - 1] ?? null) : null;
    const lastCachedMin = cachedArrs?.min ? (cachedArrs.min[effectiveCachedN - 1] ?? null) : null;
    const lastCachedMax = cachedArrs?.max ? (cachedArrs.max[effectiveCachedN - 1] ?? null) : null;

    const value: (number | null)[] = [];
    const min:   (number | null)[] = [];
    const max:   (number | null)[] = [];

    for (let i = 0; i < totalN; i++) {
      const li = i - liveStartIndex;
      const inLive = li >= 0 && li < liveArrs.value.length;

      if (inLive) {
        value.push(liveArrs.value[li] ?? null);
        min.push(liveArrs.min[li] ?? null);
        max.push(liveArrs.max[li] ?? null);
      } else if (cachedArrs && i < effectiveCachedN) {
        value.push(cachedArrs.value[i] ?? null);
        min.push(cachedArrs.min ? (cachedArrs.min[i] ?? null) : null);
        max.push(cachedArrs.max ? (cachedArrs.max[i] ?? null) : null);
      } else {
        // Gap between effectiveCachedN and liveStartIndex, or tag absent from cached:
        // LOCF from the last known cached value.
        value.push(lastCachedV);
        min.push(lastCachedMin);
        max.push(lastCachedMax);
      }
    }

    newSeries.set(tagId, { value, min, max });
  }

  return {
    ...cached,
    n: totalN,
    endTime: cached.startTime + BigInt(totalN) * BigInt(cached.bucketSMs),
    series: newSeries,
  };
}

// ─── Raw merge ────────────────────────────────────────────────────────────────

function mergeRaw(cached: RawSeriesData, live: RawTail, isTailing: boolean): RawSeriesData {
  const allTagIds = new Set([...cached.series.keys(), ...live.perTag.keys()]);

  const newSeries = new Map<RawSeriesData['series'] extends Map<number, infer V> ? number : never, {
    ts: bigint[];
    value: (number | null)[];
    prev?: { ts: bigint; value: number | null };
  }>();

  let newEndTime = cached.endTime;

  for (const tagId of allTagIds) {
    const cachedEntry = cached.series.get(tagId) ?? { ts: [], value: [] };
    const liveEntry   = live.perTag.get(tagId)   ?? { ts: [], value: [] };

    const minLiveTs = liveEntry.ts.length > 0 ? liveEntry.ts[0]! : null;

    let mergedTs: bigint[];
    let mergedValue: (number | null)[];

    if (isTailing && minLiveTs !== null) {
      // Tailing: live wins for the overlap region. Drop cached entries whose
      // ts >= minLiveTs so future-fetched LOCF gapfill from a newly-loaded tile
      // does not overwrite real live data.
      const cachedTsFiltered:    bigint[]          = [];
      const cachedValueFiltered: (number | null)[] = [];
      for (let i = 0; i < cachedEntry.ts.length; i++) {
        if (cachedEntry.ts[i]! < minLiveTs) {
          cachedTsFiltered.push(cachedEntry.ts[i]!);
          cachedValueFiltered.push(cachedEntry.value[i] ?? null);
        }
      }
      mergedTs    = [...cachedTsFiltered,    ...liveEntry.ts];
      mergedValue = [...cachedValueFiltered, ...liveEntry.value.map(v => v ?? null)];
    } else {
      // Fixed mode (or no live data): keep existing behaviour — dedup live
      // entries that overlap cached's tail.
      const maxCachedTs = cachedEntry.ts.length > 0
        ? cachedEntry.ts[cachedEntry.ts.length - 1]!
        : null;

      const liveTsFiltered:    bigint[]          = [];
      const liveValueFiltered: (number | null)[] = [];
      for (let i = 0; i < liveEntry.ts.length; i++) {
        if (maxCachedTs === null || liveEntry.ts[i]! > maxCachedTs) {
          liveTsFiltered.push(liveEntry.ts[i]!);
          liveValueFiltered.push(liveEntry.value[i] ?? null);
        }
      }
      mergedTs    = [...cachedEntry.ts,    ...liveTsFiltered];
      mergedValue = [...cachedEntry.value, ...liveValueFiltered];
    }

    if (mergedTs.length > 0) {
      const lastTs = mergedTs[mergedTs.length - 1]!;
      if (lastTs > newEndTime) newEndTime = lastTs;
    }

    const entry: { ts: bigint[]; value: (number | null)[]; prev?: { ts: bigint; value: number | null } } = {
      ts: mergedTs,
      value: mergedValue,
    };
    if (cachedEntry.prev) entry.prev = cachedEntry.prev;

    newSeries.set(tagId, entry);
  }

  return { ...cached, endTime: newEndTime, series: newSeries };
}
