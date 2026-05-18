import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHmiContext } from '@caro/hmi-context';
import { TS_BUCKET_ORIGIN_MS, floorDiv } from './level.js';
import type { AggregateSeriesData, RawSeriesData, TrendData } from './types.js';
import { mergeTrendData } from './mergeTrendData.js';

/**
 * Per-tag bounded buffer for samples arriving during the fetch-in-flight
 * window. Trimmed by `responseTailTs - 1000ms` on every tile response,
 * so effective contents are samples newer than the most recent tile's
 * request entry time. Capacity bounds the pathological case of an
 * unusually slow fetch (cold CAG query, network blip) at ~5 s of live
 * history at 4 Hz. The ring's role narrowed when the original
 * "ring-survives-transition" architecture was abandoned in favor of
 * eviction-on-live-entry — state-change replay is bounded by the same
 * fetch window, so a small capacity suffices.
 */
export const TREND_RING_CAPACITY = 20;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AggregateTail {
  mode: 'aggregate';
  /** Start time (ms since epoch) of the first closed bucket across all tags. */
  startMs: bigint;
  /** Bucket size in ms, echoes the input bucketSMs. */
  bucketSMs: bigint;
  /** Per-tag closed-bucket arrays. All same length within a tag. */
  perTag: Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>;
}

export interface RawTail {
  mode: 'raw';
  /** Per-tag arrays of (moduleTs, value) pairs in arrival order. */
  perTag: Map<number, { ts: bigint[]; value: (number | null)[] }>;
}

export type LiveTail = AggregateTail | RawTail | null;

export interface UseLiveSubscriptionOptions {
  tagIds: number[];
  /** null until the first tile fetch lands. */
  trimThreshold: number | null;
  /** Whether the chart is in live mode. Defaults to false. */
  isLive?: boolean;
  /** Bucket size in ms from the current CAG level. null until first tile resolves. */
  bucketSMs?: bigint | null;
  /** Last known value per tag from the rightmost cached tile, for LOCF seeding. */
  seedFromCachedTile?: Map<number, number | boolean | string | null> | null;
  /**
   * 'aggregate' when cached tile source is a CAG, 'raw' when source === 'raw'.
   * null when no cached tile exists yet. When null, tail is always null.
   */
  tailMode?: 'aggregate' | 'raw' | null;
  /**
   * Current viewport span in ms. Raw buffers are trimmed to 2×viewportSpanMs so
   * memory is bounded to ~2 spans of recent data regardless of session length.
   * Defaults to 60_000n (1 min) when omitted.
   */
  viewportSpanMs?: bigint;
  /**
   * Called once per TREND_DELTA frame with the max moduleTs seen across all
   * per-tag callbacks. Fired via queueMicrotask so all tags in the same
   * synchronous WS frame are coalesced into one call.
   */
  onDataReceived?: (maxModuleTs: number) => void;
}

export interface UseLiveSubscriptionResult {
  /**
   * Clears ring, accumulator, raw-buffer, and unified-buffer state.
   * Increments the generation counter as its FIRST action so any in-flight
   * seedFromSpineFetch calls become stale immediately. Synchronous; safe to
   * call inside dispatchModeAction wrappers.
   */
  commitAndDrain(): void;
  /**
   * Returns max(sessionHighWaterMark, currentMaxAcrossSubscribedTags).
   * Returns null before the first TREND_DELTA frame arrives in the session.
   * Monotonic-non-decreasing within a session — the high-water-mark floor
   * prevents regression when the max-providing tag is removed. Reset to null
   * by commitAndDrain. See proposal §4 preamble / §11 glossary.
   */
  getLatestSampleTs(): bigint | null;
  /**
   * Returns the current generation counter. Incremented by commitAndDrain
   * (even when the buffer is empty). Callers capture this at fetch-dispatch
   * time and pass it to seedFromSpineFetch; arrivals whose generation no
   * longer matches are dropped silently. See proposal §4.4 / §11 glossary.
   */
  getCurrentGeneration(): number;
  /**
   * Merges a per-tag spine fetch result into the unified buffer, applying
   * live-wins-on-coverage once at seed time (same rule as mergeTrendData,
   * applied once instead of per-render). Drops silently if `generation`
   * does not match the current generation counter — i.e. a commitAndDrain
   * was called after the fetch was dispatched.
   *
   * Aggregate: clips spine at the first live bucket's start so WS-accumulated
   * entries always win on their coverage range.
   * Raw: drops spine entries with ts >= minLiveTs (the first raw-buffer entry).
   */
  seedFromSpineFetch(
    tagId: number,
    series: AggregateSeriesData | RawSeriesData,
    generation: number,
  ): void;
  /**
   * Returns the unified buffer — spine (seeded via seedFromSpineFetch) merged
   * with the current WS-accumulated tail — in the same TrendData shape that
   * mergeTrendData returns. Returns null when no spine has been seeded yet.
   * Phase 2a: thin view over existing ring + accumulator + rawBuffers with the
   * spine stored alongside. No callers wired yet.
   */
  getBufferSnapshot(): TrendData | null;
  /**
   * Live tail extension for chart rendering. null when not tailing, when
   * tailMode is null, or when no data has closed/arrived yet.
   */
  tail: LiveTail;
}

// ─── Internal types ───────────────────────────────────────────────────────────

type TrendSample = { moduleTs: number; value: number | boolean | string | null };

interface OpenBucket {
  startMs: bigint;
  lastTs: number;
  /** Most-recent value by moduleTs order, including null. */
  last: number | null;
  /** Running min of non-null values; null if none yet. */
  min: number | null;
  /** Running max of non-null values; null if none yet. */
  max: number | null;
  nullCount: number;
  valueCount: number;
}

interface AccumulatorState {
  openBucket: OpenBucket | null;
  closed: { value: (number | null)[]; min: (number | null)[]; max: (number | null)[] };
  /** startMs of the first closed bucket, set on first close. */
  firstClosedStartMs: bigint | null;
  /** LOCF seed for empty-bucket close; null if no good value ever seen. */
  lastKnownValue: number | null;
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function toNumericValue(v: number | boolean | string | null): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

/**
 * Returns true when `existing` and `incoming` share the same fetch identity —
 * i.e. they came from the same spine fetch (same tile range, same dispatch
 * shape). Used by seedFromSpineFetch to decide whether to mutate the existing
 * shared series map (same fetch, subsequent tag) or replace it wholesale (new
 * fetch with different preset/range/bucketSMs).
 */
function spineMetadataMatches(
  existing: TrendData | null,
  incoming: AggregateSeriesData | RawSeriesData,
): boolean {
  if (existing === null) return false;
  if (existing.type !== incoming.type) return false;
  if (existing.startTime !== incoming.startTime) return false;
  if (existing.source !== incoming.source) return false;
  if (existing.type === 'aggregate' && incoming.type === 'aggregate') {
    if (existing.endTime !== incoming.endTime) return false;
    if (existing.bucketSMs !== incoming.bucketSMs) return false;
    if (existing.n !== incoming.n) return false;
  }
  if (existing.type === 'raw' && incoming.type === 'raw') {
    if (existing.endTime !== incoming.endTime) return false;
  }
  return true;
}

/**
 * Floor-aligned bucket start for `moduleTs` on the TS_BUCKET_ORIGIN_MS grid.
 * Uses floorDiv so pre-origin timestamps are handled correctly.
 */
function bucketStartFor(moduleTs: number, bucketSMs: bigint): bigint {
  const ts = BigInt(moduleTs);
  return TS_BUCKET_ORIGIN_MS + floorDiv(ts - TS_BUCKET_ORIGIN_MS, bucketSMs) * bucketSMs;
}

function newOpenBucket(startMs: bigint): OpenBucket {
  return { startMs, lastTs: 0, last: null, min: null, max: null, nullCount: 0, valueCount: 0 };
}

function addToOpenBucket(b: OpenBucket, moduleTs: number, numValue: number | null): void {
  b.lastTs = moduleTs;
  b.valueCount++;
  if (numValue === null) {
    b.nullCount++;
    b.last = null;  // last tracks most-recent-by-ts, including null values
  } else {
    b.last = numValue;
    b.min = b.min === null ? numValue : Math.min(b.min, numValue);
    b.max = b.max === null ? numValue : Math.max(b.max, numValue);
  }
}

/** Three-case rule from §5.4. Sets state.openBucket to null after close. */
function closeCurrentBucket(state: AccumulatorState): void {
  const b = state.openBucket!;
  const closedStartMs = b.startMs;
  let v: number | null, mn: number | null, mx: number | null;
  if (b.nullCount > 0) {
    // Mixed-null: any null present → emit (null, null, null)
    v = null; mn = null; mx = null;
    state.lastKnownValue = null;
  } else if (b.valueCount === 0) {
    // Empty: LOCF from lastKnownValue
    v = state.lastKnownValue; mn = v; mx = v;
    // lastKnownValue unchanged
  } else {
    // Normal: all non-null
    v = b.last; mn = b.min; mx = b.max;
    state.lastKnownValue = v;
  }
  state.closed.value.push(v);
  state.closed.min.push(mn);
  state.closed.max.push(mx);
  if (state.firstClosedStartMs === null) state.firstClosedStartMs = closedStartMs;
  state.openBucket = null;
}

function processEventIntoAccumulator(
  state: AccumulatorState,
  moduleTs: number,
  numValue: number | null,
  bucketSMs: bigint,
): void {
  const eventBucketStart = bucketStartFor(moduleTs, bucketSMs);

  if (state.openBucket === null) {
    state.openBucket = newOpenBucket(eventBucketStart);
    addToOpenBucket(state.openBucket, moduleTs, numValue);
    return;
  }

  if (eventBucketStart === state.openBucket.startMs) {
    addToOpenBucket(state.openBucket, moduleTs, numValue);
    return;
  }

  if (eventBucketStart < state.openBucket.startMs) {
    // Out-of-order: drop silently
    return;
  }

  // Event is in a later bucket: close current, fill intermediate empties, open new.
  const prevStartMs = state.openBucket.startMs;
  closeCurrentBucket(state); // sets state.openBucket = null
  let nextStart = prevStartMs + bucketSMs;
  while (nextStart < eventBucketStart) {
    state.openBucket = newOpenBucket(nextStart);
    closeCurrentBucket(state); // empty rule applies
    nextStart += bucketSMs;
  }
  state.openBucket = newOpenBucket(eventBucketStart);
  addToOpenBucket(state.openBucket, moduleTs, numValue);
}

/**
 * Builds an AggregateTail snapshot from current accumulator state.
 * Returns null when no tag has closed any buckets yet.
 * Shares array references with accumulator state — always rebuild after mutations.
 */
function buildAggregateTail(
  accumulators: Map<number, AccumulatorState>,
  bucketSMs: bigint,
): AggregateTail | null {
  const perTag = new Map<number, { value: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>();
  let earliestStart: bigint | null = null;
  for (const [tagId, state] of accumulators) {
    perTag.set(tagId, {
      value: state.closed.value,
      min:   state.closed.min,
      max:   state.closed.max,
    });
    if (state.firstClosedStartMs !== null) {
      earliestStart = earliestStart === null
        ? state.firstClosedStartMs
        : (state.firstClosedStartMs < earliestStart ? state.firstClosedStartMs : earliestStart);
    }
  }
  if (earliestStart === null) return null;

  return { mode: 'aggregate', startMs: earliestStart, bucketSMs, perTag };
}

/**
 * Builds a RawTail from current raw buffers.
 * Returns null when no tag has any buffered entries.
 */
function buildRawTail(
  rawBuffers: Map<number, TrendSample[]>,
): RawTail | null {
  const perTag = new Map<number, { ts: bigint[]; value: (number | null)[] }>();
  let hasAny = false;
  for (const [tagId, buf] of rawBuffers) {
    if (buf.length > 0) hasAny = true;
    perTag.set(tagId, {
      ts:    buf.map(e => BigInt(e.moduleTs)),
      value: buf.map(e => toNumericValue(e.value)),
    });
  }
  if (!hasAny) return null;
  return { mode: 'raw', perTag };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveSubscription(opts: UseLiveSubscriptionOptions): UseLiveSubscriptionResult {
  const {
    tagIds,
    trimThreshold,
    isLive    = false,
    bucketSMs    = null,
    seedFromCachedTile = null,
    tailMode     = null,
    viewportSpanMs = 60_000n,
    onDataReceived,
  } = opts;

  const { subscribeTrend } = useHmiContext();

  const ringsRef        = useRef<Map<number, TrendSample[]>>(new Map());
  const accumulatorsRef = useRef<Map<number, AccumulatorState>>(new Map());
  const rawBuffersRef   = useRef<Map<number, TrendSample[]>>(new Map());

  // Prop shadows in refs — always current, safe to read from callbacks.
  const isLiveRef        = useRef(isLive);
  const bucketSMsRef        = useRef<bigint | null>(bucketSMs);
  const trimThresholdRef    = useRef<number | null>(trimThreshold);
  const seedRef             = useRef<Map<number, number | boolean | string | null> | null>(seedFromCachedTile);
  const tailModeRef         = useRef<'aggregate' | 'raw' | null>(tailMode);
  const viewportSpanMsRef   = useRef<bigint>(viewportSpanMs);
  const onDataReceivedRef   = useRef<((maxModuleTs: number) => void) | undefined>(onDataReceived);

  // Frame-coalescing state for onDataReceived.
  const pendingFrameMaxTsRef   = useRef<number>(0);
  const frameFlushScheduledRef = useRef(false);

  // Session-scoped high-water-mark: highest moduleTs seen since Live entry.
  // Floors latestSampleTs so it never regresses when the max-providing tag
  // is removed. Reset to null by commitAndDrain. See proposal §4 preamble.
  const sessionHighWaterMarkRef = useRef<bigint | null>(null);

  // Monotonic generation counter. Incremented by commitAndDrain as its FIRST
  // action, before any buffer clears. seedFromSpineFetch callers capture this
  // at fetch-dispatch time and pass it back; stale arrivals are dropped.
  const generationRef = useRef<number>(0);

  // Unified buffer: spine fetch result merged with WS-accumulated entries.
  // Seeded via seedFromSpineFetch; cleared by commitAndDrain.
  const spineRef = useRef<TrendData | null>(null);

  isLiveRef.current      = isLive;
  bucketSMsRef.current      = bucketSMs;
  trimThresholdRef.current  = trimThreshold;
  seedRef.current           = seedFromCachedTile;
  tailModeRef.current       = tailMode;
  viewportSpanMsRef.current = viewportSpanMs;
  onDataReceivedRef.current = onDataReceived;

  const [tail, setTail] = useState<LiveTail>(null);

  const tagIdsKey    = tagIds.join(',');
  const bucketSMsStr = bucketSMs?.toString() ?? 'null';

  // Flush accumulator/raw state to React — React 18 auto-batching coalesces
  // multiple calls within the same synchronous event handler.
  function flushTail(): void {
    if (!isLiveRef.current || tailModeRef.current === null) {
      setTail(null);
      return;
    }
    if (tailModeRef.current === 'aggregate') {
      const bSMs = bucketSMsRef.current;
      if (bSMs === null) { setTail(null); return; }
      setTail(buildAggregateTail(accumulatorsRef.current, bSMs));
    } else {
      setTail(buildRawTail(rawBuffersRef.current));
    }
  }

  // ── Subscribe-lifecycle effect ────────────────────────────────────────────

  useEffect(() => {
    const tagIdSet = new Set(tagIds);

    // Prune ring entries for removed tags (runs after previous cleanup unsubscribes).
    for (const key of [...ringsRef.current.keys()]) {
      if (!tagIdSet.has(key)) ringsRef.current.delete(key);
    }
    for (const tagId of tagIds) {
      if (!ringsRef.current.has(tagId)) ringsRef.current.set(tagId, []);
    }

    const unsubscribes: (() => void)[] = [];
    for (const tagId of tagIds) {
      const unsub = subscribeTrend(tagId, (moduleTs, value) => {
        const arr = ringsRef.current.get(tagId);
        if (!arr) return;
        arr.push({ moduleTs, value });
        if (arr.length > TREND_RING_CAPACITY) arr.shift();

        // Bump session high-water-mark on every sample regardless of Live state.
        const mTs = BigInt(moduleTs);
        if (sessionHighWaterMarkRef.current === null || mTs > sessionHighWaterMarkRef.current) {
          sessionHighWaterMarkRef.current = mTs;
        }

        if (isLiveRef.current) {
          const mode = tailModeRef.current;
          if (mode === 'aggregate' && bucketSMsRef.current !== null) {
            const bSMs = bucketSMsRef.current;
            const state = accumulatorsRef.current.get(tagId);
            if (state) {
              processEventIntoAccumulator(state, moduleTs, toNumericValue(value), bSMs);

              // Trim aggregate tail to 2 × viewportSpanMs from latestSampleTs.
              // Uses sessionHighWaterMarkRef (just bumped above to max(prev, moduleTs)).
              // HWM ≥ currentMax across all subscribed ring entries, so it equals
              // getLatestSampleTs() in this synchronous callback context.
              const latestTs = sessionHighWaterMarkRef.current;
              if (latestTs !== null) {
                const trimLeftMs = latestTs - 2n * viewportSpanMsRef.current;
                for (const [, accState] of accumulatorsRef.current) {
                  const firstClosed = accState.firstClosedStartMs;
                  if (firstClosed === null) continue;
                  const diff = trimLeftMs - firstClosed;
                  if (diff <= 0n) continue;
                  // k = ⌈diff / bSMs⌉: first bucket index whose start ≥ trimLeftMs
                  const k = Math.min(
                    Number((diff + bSMs - 1n) / bSMs),
                    accState.closed.value.length,
                  );
                  if (k <= 0) continue;
                  accState.closed.value.splice(0, k);
                  accState.closed.min.splice(0, k);
                  accState.closed.max.splice(0, k);
                  accState.firstClosedStartMs = accState.closed.value.length > 0
                    ? firstClosed + BigInt(k) * bSMs
                    : null;
                }
              }

              flushTail();
            }
          } else if (mode === 'raw') {
            const buf = rawBuffersRef.current.get(tagId);
            if (buf) {
              buf.push({ moduleTs, value });
              // Trim all raw buffers to 2×viewportSpanMs so memory is bounded
              // to ~2 spans of recent data regardless of session length.
              const cutoff = moduleTs - Number(2n * viewportSpanMsRef.current);
              for (const [, b] of rawBuffersRef.current) {
                while (b.length > 0 && b[0]!.moduleTs < cutoff) b.shift();
              }
              flushTail();
            }
          }
        }

        // Coalesce all per-tag callbacks within the same WS frame into one
        // onDataReceived call with the frame's max moduleTs.
        pendingFrameMaxTsRef.current = Math.max(pendingFrameMaxTsRef.current, moduleTs);
        if (!frameFlushScheduledRef.current) {
          frameFlushScheduledRef.current = true;
          queueMicrotask(() => {
            frameFlushScheduledRef.current = false;
            const maxTs = pendingFrameMaxTsRef.current;
            pendingFrameMaxTsRef.current = 0;
            onDataReceivedRef.current?.(maxTs);
          });
        }
      });
      unsubscribes.push(unsub);
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagIdsKey, subscribeTrend]);

  // ── Trim effect ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (trimThreshold === null) return;
    // Trim ring only. rawBuffersRef is intentionally NOT trimmed here:
    // trimming it forward as new tiles load pushes minLiveTs forward in
    // mergeRaw, letting LOCF gapfill from newly-fetched after-prefetch
    // tiles leak through the cached-drop filter as a flatline gap.
    // rawBuffersRef is cleared on tailing exit via commitAndDrain.
    for (const [tagId, arr] of ringsRef.current) {
      ringsRef.current.set(tagId, arr.filter(e => e.moduleTs >= trimThreshold));
    }
  }, [trimThreshold]);

  // ── Tailing / tailMode effect ─────────────────────────────────────────────
  //
  // Runs on: isTailing flip, bucketSMs change, tagIds change, or tailMode change.
  // tailMode change while tailing is treated as tailing-exit-then-re-enter.
  // On true→false or tailMode→null: clears both accumulators and raw buffers.
  // On false→true (or bucketSMs/tagIds/tailMode change while true): re-inits
  // the matching path and replays ring.

  useEffect(() => {
    if (!isLive || tailMode === null) {
      accumulatorsRef.current.clear();
      rawBuffersRef.current.clear();
      setTail(null);
      return;
    }

    const threshold = trimThresholdRef.current;

    if (tailMode === 'aggregate') {
      if (bucketSMs === null) return; // wait for first tile to resolve

      accumulatorsRef.current.clear();
      rawBuffersRef.current.clear();
      for (const tagId of tagIds) {
        const seedVal = seedRef.current?.get(tagId) ?? null;
        accumulatorsRef.current.set(tagId, {
          openBucket: null,
          closed: { value: [], min: [], max: [] },
          firstClosedStartMs: null,
          lastKnownValue: typeof seedVal === 'number' ? seedVal : null,
        });
      }

      // Replay ring (filtered by current trimThreshold)
      for (const tagId of tagIds) {
        const ring = ringsRef.current.get(tagId) ?? [];
        const entries = threshold !== null ? ring.filter(s => s.moduleTs >= threshold) : ring;
        const state = accumulatorsRef.current.get(tagId)!;
        for (const { moduleTs, value } of entries) {
          processEventIntoAccumulator(state, moduleTs, toNumericValue(value), bucketSMs);
        }
      }
    } else {
      // raw mode
      accumulatorsRef.current.clear();
      rawBuffersRef.current.clear();
      for (const tagId of tagIds) {
        rawBuffersRef.current.set(tagId, []);
      }

      // Replay ring (filtered by current trimThreshold)
      for (const tagId of tagIds) {
        const ring = ringsRef.current.get(tagId) ?? [];
        const entries = threshold !== null ? ring.filter(s => s.moduleTs >= threshold) : ring;
        const buf = rawBuffersRef.current.get(tagId)!;
        for (const entry of entries) {
          buf.push({ moduleTs: entry.moduleTs, value: entry.value });
        }
      }
    }

    flushTail();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, bucketSMsStr, tagIdsKey, tailMode]);

  // ── commitAndDrain ────────────────────────────────────────────────────────

  const commitAndDrain = useCallback((): void => {
    // Generation bump is the FIRST action — any seedFromSpineFetch call that
    // captured the old generation becomes stale immediately, even before the
    // buffer clears complete. Fires unconditionally (even on empty buffers)
    // so the invalidation contract holds regardless of buffer state.
    generationRef.current += 1;
    // Empty per-tag arrays in place rather than .clear() the maps so the
    // subscribe callback's `if (buf)` guard still passes on subsequent events.
    // Production masks this via the mode-flip lifecycle (tailMode-change effect
    // re-allocates), but TG-7 surfaced it under stable-mode drain. See spec §10.6.
    for (const arr of ringsRef.current.values()) arr.length = 0;
    accumulatorsRef.current.clear();
    for (const arr of rawBuffersRef.current.values()) arr.length = 0;
    // Reset session high-water-mark alongside the other in-place clears so
    // getLatestSampleTs() returns null immediately after drain.
    sessionHighWaterMarkRef.current = null;
    // Clear unified buffer (spine portion) so getBufferSnapshot() returns null
    // immediately after drain. Proposal §4.4 / Phase 2.4 contract.
    spineRef.current = null;
    // Clear React state so consumers see the drain immediately, without waiting
    // on a subsequent re-render triggered by mode flip.
    setTail(null);
  }, []);

  // ── getLatestSampleTs ─────────────────────────────────────────────────────

  const getLatestSampleTs = useCallback((): bigint | null => {
    // currentMaxAcrossSubscribedTags: derived from the last (most-recent)
    // ring entry per currently-subscribed tag. The ring is keyed only for
    // active tags; removed tags' entries are deleted by the subscribe-lifecycle
    // effect, so this scan covers exactly the subscribed set.
    let currentMax: bigint | null = null;
    for (const arr of ringsRef.current.values()) {
      if (arr.length > 0) {
        const ts = BigInt(arr[arr.length - 1]!.moduleTs);
        if (currentMax === null || ts > currentMax) currentMax = ts;
      }
    }
    const hwm = sessionHighWaterMarkRef.current;
    if (hwm === null && currentMax === null) return null;
    if (hwm === null) return currentMax;
    if (currentMax === null) return hwm;
    return hwm > currentMax ? hwm : currentMax;
  }, []);

  // ── getCurrentGeneration ──────────────────────────────────────────────────

  const getCurrentGeneration = useCallback((): number => generationRef.current, []);

  // ── seedFromSpineFetch ────────────────────────────────────────────────────

  const seedFromSpineFetch = useCallback((
    tagId: number,
    series: AggregateSeriesData | RawSeriesData,
    generation: number,
  ): void => {
    // Stale-arrival guard: if commitAndDrain was called after the fetch was
    // dispatched, the generation counter will have advanced past the captured
    // value. Drop silently — the caller will issue a new fetch if needed.
    if (generation !== generationRef.current) return;

    if (series.type === 'aggregate') {
      const tagData = series.series.get(tagId);
      if (!tagData) return;

      const existing = spineRef.current;
      const isContinuation = spineMetadataMatches(existing, series);
      // Live-wins-on-coverage clip applies only when this is a same-fetch
      // continuation. On a wholesale replacement (preset change with different
      // bucketSMs), the accumulator's firstClosedStartMs reflects OLD bucketing
      // and is about to be reset by the tailMode effect — clipping based on it
      // produces a gap. spineMetadataMatches is the right signal because
      // bucketSMs is part of the metadata match.
      const accState = accumulatorsRef.current.get(tagId);
      let clippedN = series.n;
      if (isContinuation && accState && accState.firstClosedStartMs !== null) {
        const liveStartIndex = Number(
          (accState.firstClosedStartMs - series.startTime) / BigInt(series.bucketSMs),
        );
        clippedN = Math.max(0, Math.min(series.n, liveStartIndex));
      }

      const entry: { value: (number | null)[]; min?: (number | null)[]; max?: (number | null)[] } = {
        value: tagData.value.slice(0, clippedN),
      };
      if (tagData.min) entry.min = tagData.min.slice(0, clippedN);
      if (tagData.max) entry.max = tagData.max.slice(0, clippedN);

      if (isContinuation) {
        // Same fetch's subsequent tag — mutate the shared series map.
        (existing as AggregateSeriesData).series.set(tagId, entry);
      } else {
        // New fetch (different preset / range / bucketSMs) — replace wholesale.
        spineRef.current = {
          type:      'aggregate',
          source:    series.source,
          startTime: series.startTime,
          endTime:   series.endTime,
          n:         series.n,
          bucketSMs: series.bucketSMs,
          series:    new Map([[tagId, entry]]),
        };
      }
    } else {
      // raw path
      const tagData = series.series.get(tagId);
      if (!tagData) return;

      const existing = spineRef.current;
      const isContinuation = spineMetadataMatches(existing, series);
      // Live-wins-on-coverage (raw): drop spine entries with ts >= minLiveTs.
      // Gate on isContinuation: on wholesale replacement, rawBuffersRef reflects
      // an OLD session and is about to be reset by the tailMode effect.
      const rawBuf = rawBuffersRef.current.get(tagId);
      let filteredTs    = [...tagData.ts];
      let filteredValue = [...tagData.value];

      if (isContinuation && rawBuf && rawBuf.length > 0) {
        const minLiveTs = BigInt(rawBuf[0]!.moduleTs);
        const cutIdx = filteredTs.findIndex(t => t >= minLiveTs);
        if (cutIdx >= 0) {
          filteredTs    = filteredTs.slice(0, cutIdx);
          filteredValue = filteredValue.slice(0, cutIdx);
        }
      }

      const entry: { ts: bigint[]; value: (number | null)[]; prev?: { ts: bigint; value: number | null } } = {
        ts:    filteredTs,
        value: filteredValue,
        ...(tagData.prev ? { prev: tagData.prev } : {}),
      };

      if (isContinuation) {
        // Same fetch's subsequent tag — spread preserves tile-range metadata.
        const rawExisting = existing as RawSeriesData;
        const newSeries = new Map(rawExisting.series);
        newSeries.set(tagId, entry);
        spineRef.current = { ...rawExisting, series: newSeries };
      } else {
        // New fetch — use series.endTime (tile range) so subsequent tags in the
        // same fetch all see the same metadata and take the mutate branch above.
        spineRef.current = {
          type:      'raw',
          source:    'raw',
          startTime: series.startTime,
          endTime:   series.endTime,
          series:    new Map([[tagId, entry]]),
        };
      }
    }
  }, []);

  // ── getBufferSnapshot ─────────────────────────────────────────────────────

  const getBufferSnapshot = useCallback((): TrendData | null => {
    const spine = spineRef.current;
    if (spine === null) return null;
    const mode = tailModeRef.current;
    // Type-coherence guard: if the consumer's tailMode hasn't propagated to
    // match the spine's actual type yet (e.g., one render between a new spine
    // arriving via seedFromSpineFetch and TrendChartContainer recomputing
    // tailMode from cachedData.type), pass null tail to mergeTrendData so the
    // spine is returned unchanged. The mismatch resolves on the next render.
    // Mirrors the tailToReturn guard at the hook surface.
    const tailMatchesSpine =
      (mode === 'aggregate' && spine.type === 'aggregate') ||
      (mode === 'raw' && spine.type === 'raw');
    if (!tailMatchesSpine) return spine;
    if (mode === 'aggregate') {
      const bSMs = bucketSMsRef.current;
      if (bSMs === null) return spine;
      return mergeTrendData(spine, buildAggregateTail(accumulatorsRef.current, bSMs));
    }
    if (mode === 'raw') {
      return mergeTrendData(spine, buildRawTail(rawBuffersRef.current));
    }
    return spine;
  }, []);

  // Suppress the brief mismatch window during a tailMode transition
  // (e.g., preset change crossing the §6.3 raw/aggregate dispatch
  // boundary). The tail state is updated via useEffect after the render
  // where tailMode prop changed; until then, returning the stale tail
  // would surface as a [mergeTrendData] type mismatch warning. Returning
  // null while modes are inconsistent lets mergeTrendData fall through
  // to cached-only rendering (correct behavior) until the effect runs.
  const tailToReturn = useMemo(
    () => (tail !== null && tail.mode !== tailMode ? null : tail),
    [tail, tailMode],
  );

  return {
    commitAndDrain,
    getLatestSampleTs,
    getCurrentGeneration,
    seedFromSpineFetch,
    getBufferSnapshot,
    tail: tailToReturn,
  };
}
