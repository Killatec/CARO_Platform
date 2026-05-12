import { TS_BUCKET_ORIGIN_MS, floorDiv } from './level.js';

function bucketStartFor(moduleTs: bigint, bucketSMs: bigint): bigint {
  return TS_BUCKET_ORIGIN_MS + floorDiv(moduleTs - TS_BUCKET_ORIGIN_MS, bucketSMs) * bucketSMs;
}

/**
 * Processes a ring of raw samples into closed aggregate buckets.
 *
 * Applies the same three-case rule as useLiveSubscription's accumulator:
 *   - Normal  (all non-null):  emit (last, min, max),   lkv = last
 *   - Mixed-null (any null):   emit (null, null, null),  lkv = null
 *   - Empty  (no events):      emit (lkv, lkv, lkv),    lkv unchanged
 *
 * Only entries with rangeStart ≤ moduleTs < rangeEnd are processed.
 * The last open bucket (containing the most recent entry) is NOT closed —
 * consistent with the streaming accumulator's open-bucket semantics.
 *
 * Phase 1: utility extracted for future use by mergeTrendData (Phase 2).
 * useLiveSubscription's accumulator still uses its own inline logic.
 */
export function closeBucketsFromRing(
  entries: { moduleTs: bigint; value: number | null }[],
  bucketSMs: number,
  rangeStart: bigint,
  rangeEnd: bigint,
): {
  ts: bigint[];
  value: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  nullCount: number[];
} {
  const bSMs = BigInt(bucketSMs);
  const ts: bigint[] = [];
  const value: (number | null)[] = [];
  const min: (number | null)[] = [];
  const max: (number | null)[] = [];
  const nullCount: number[] = [];

  let lastKnownValue: number | null = null;

  let openStart: bigint | null = null;
  let openLast: number | null = null;
  let openMin: number | null = null;
  let openMax: number | null = null;
  let openNullCount = 0;
  let openValueCount = 0;

  function resetOpen(): void {
    openStart = null;
    openLast = null;
    openMin = null;
    openMax = null;
    openNullCount = 0;
    openValueCount = 0;
  }

  function closeBucket(bucketStart: bigint): void {
    let v: number | null, mn: number | null, mx: number | null, nc: number;
    if (openNullCount > 0) {
      v = null; mn = null; mx = null; nc = openNullCount;
      lastKnownValue = null;
    } else if (openValueCount === 0) {
      v = lastKnownValue; mn = v; mx = v; nc = 0;
    } else {
      v = openLast; mn = openMin; mx = openMax; nc = 0;
      lastKnownValue = v;
    }
    ts.push(bucketStart);
    value.push(v);
    min.push(mn);
    max.push(mx);
    nullCount.push(nc);
    resetOpen();
  }

  function addToOpen(v: number | null): void {
    if (v === null) {
      openNullCount++;
      openLast = null;
    } else {
      openValueCount++;
      openLast = v;
      openMin = openMin === null ? v : Math.min(openMin, v);
      openMax = openMax === null ? v : Math.max(openMax, v);
    }
  }

  for (const entry of entries) {
    if (entry.moduleTs < rangeStart || entry.moduleTs >= rangeEnd) continue;

    const bucketStart = bucketStartFor(entry.moduleTs, bSMs);

    if (openStart === null) {
      openStart = bucketStart;
      addToOpen(entry.value);
      continue;
    }

    if (bucketStart === openStart) {
      addToOpen(entry.value);
      continue;
    }

    if (bucketStart < openStart) {
      // Out-of-order: drop silently (matches accumulator behaviour)
      continue;
    }

    // Entry is in a later bucket: close current, fill intermediate empties, open new
    const prevStart = openStart;
    closeBucket(prevStart);

    let nextStart = prevStart + bSMs;
    while (nextStart < bucketStart) {
      openStart = nextStart;
      closeBucket(nextStart);
      nextStart += bSMs;
    }

    openStart = bucketStart;
    addToOpen(entry.value);
  }

  // Last open bucket is NOT closed — matches streaming accumulator semantics
  return { ts, value, min, max, nullCount };
}
