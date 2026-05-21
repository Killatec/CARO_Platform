import type { TrendData, AggregateSeriesData, RawSeriesData } from './types.js';
import type { LiveTail, AggregateTail, RawTail } from './useLiveSubscription.js';

/**
 * Combines cached tile data with a live tail using the unified coverage rule (§5.2):
 *
 *   - cached === null          → null  (no data yet)
 *   - live === null or empty   → cached unchanged (fast-path)
 *   - aggregate mode: live's coverage = [liveStartBucketTs, liveEndBucketTs].
 *     Within those bucket indices, live owns value/min/max (nulls included).
 *     Cached is clipped at max(0, liveEndIndex) when the live tail extends past
 *     cached.startTime; otherwise cached.n is kept.
 *   - raw mode: live's coverage = [minLiveTs, maxLiveTs].
 *     Cached entries with ts ≥ minLiveTs are dropped; live entries are appended.
 *   - type mismatch            → cached returned unchanged + console.warn
 *
 * No isTailing parameter — the rule is mode-agnostic. The fast-path handles
 * fixed-mode steady state (empty/null live tail) with zero cost.
 */
export function mergeTrendData(
  cached: TrendData | null,
  live: LiveTail,
  opts?: { seamResponseTailTs?: number | null },
): TrendData | null {
  if (cached === null) return null;
  if (live === null) return cached;

  if (cached.type === 'aggregate' && live.mode === 'aggregate') {
    // Fast-path: empty live tail
    let anyEntry = false;
    for (const a of live.perTag.values()) {
      if (a.value.length > 0) { anyEntry = true; break; }
    }
    if (!anyEntry) return cached;
    return mergeAggregate(cached, live, opts?.seamResponseTailTs ?? null);
  }

  if (cached.type === 'raw' && live.mode === 'raw') {
    // Fast-path: empty live tail
    let anyEntry = false;
    for (const e of live.perTag.values()) {
      if (e.ts.length > 0) { anyEntry = true; break; }
    }
    if (!anyEntry) return cached;
    return mergeRaw(cached, live);
  }

  // Should not happen when the container derives tailMode from cached.type.
  console.warn('[mergeTrendData] type mismatch: cached=%s live=%s', cached.type, live.mode);
  return cached;
}

// ─── Aggregate merge ──────────────────────────────────────────────────────────

function mergeAggregate(
  cached: AggregateSeriesData,
  live: AggregateTail,
  seamResponseTailTs: number | null,
): AggregateSeriesData {
  if (cached.bucketSMs !== Number(live.bucketSMs)) return cached;

  // Index into cached's bucket array where live coverage begins.
  const liveStartIndex = Number(
    (live.startMs - cached.startTime) / BigInt(cached.bucketSMs),
  );

  let maxLiveLen = 0;
  for (const liveArrs of live.perTag.values()) {
    if (liveArrs.value.length > maxLiveLen) maxLiveLen = liveArrs.value.length;
  }
  const liveEndIndex = liveStartIndex + maxLiveLen;

  // Clip cached at max(0, liveEndIndex) when live data extends past cached.startTime
  // (liveEndIndex > 0); live wins on its coverage range. When the live tail does not
  // overlap cached, cached.n is kept unchanged.
  const effectiveCachedN = liveEndIndex > 0
    ? Math.min(cached.n, Math.max(0, liveEndIndex))
    : cached.n;

  const totalN = Math.max(effectiveCachedN, liveEndIndex);

  // Seam bucket: the bucket that contains seamResponseTailTs (where the tile's coverage
  // ends mid-bucket and the live accumulator picks up). At this index both tile and live
  // have partial data, so we combine their min/max instead of letting live overwrite.
  const seamBucketIndex = seamResponseTailTs !== null
    ? Math.max(0, Math.floor(Number(BigInt(seamResponseTailTs) - cached.startTime) / cached.bucketSMs))
    : -1;

  const allTagIds = new Set([...cached.series.keys(), ...live.perTag.keys()]);

  const newSeries = new Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>();

  for (const tagId of allTagIds) {
    const cachedArrs = cached.series.get(tagId);
    const liveArrs   = live.perTag.get(tagId) ?? { value: [], min: [], max: [] };

    // LOCF seed for gap between effectiveCachedN and liveStartIndex.
    const lastCachedV   = cachedArrs ? (cachedArrs.value[effectiveCachedN - 1] ?? null) : null;
    const lastCachedMin = cachedArrs?.min ? (cachedArrs.min[effectiveCachedN - 1] ?? null) : null;
    const lastCachedMax = cachedArrs?.max ? (cachedArrs.max[effectiveCachedN - 1] ?? null) : null;

    const value: (number | null)[] = [];
    const min:   (number | null)[] = [];
    const max:   (number | null)[] = [];

    for (let i = 0; i < totalN; i++) {
      const li     = i - liveStartIndex;
      const inLive = li >= 0 && li < liveArrs.value.length;

      if (inLive) {
        value.push(liveArrs.value[li] ?? null);
        // At the seam bucket, tile and live both have partial coverage: combine min/max.
        if (i === seamBucketIndex && cachedArrs && i < effectiveCachedN) {
          const cm = cachedArrs.min ? (cachedArrs.min[i] ?? null) : null;
          const cx = cachedArrs.max ? (cachedArrs.max[i] ?? null) : null;
          const lm = liveArrs.min[li] ?? null;
          const lx = liveArrs.max[li] ?? null;
          min.push(cm !== null && lm !== null ? Math.min(cm, lm) : cm ?? lm);
          max.push(cx !== null && lx !== null ? Math.max(cx, lx) : cx ?? lx);
        } else {
          min.push(liveArrs.min[li] ?? null);
          max.push(liveArrs.max[li] ?? null);
        }
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

function mergeRaw(cached: RawSeriesData, live: RawTail): RawSeriesData {
  const allTagIds = new Set([...cached.series.keys(), ...live.perTag.keys()]);

  const newSeries = new Map<number, {
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

    if (minLiveTs !== null) {
      // Live wins for ts ≥ minLiveTs: drop cached entries at/after minLiveTs.
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
      // No live data for this tag: keep cached unchanged.
      mergedTs    = [...cachedEntry.ts];
      mergedValue = [...cachedEntry.value];
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
