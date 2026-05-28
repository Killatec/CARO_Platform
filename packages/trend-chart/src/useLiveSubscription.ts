import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHmiContext } from '@caro/hmi-context';
import { TS_BUCKET_ORIGIN_MS, floorDiv } from './level.js';

/**
 * Per-tag bounded ring buffer capacity for samples arriving during the
 * fetch-in-flight window. Trimmed to `committedThroughTs` on every tile
 * response — the DbPipeline commit watermark, which is the real data edge.
 * Capacity bounds the pathological case of an unusually slow fetch (cold CAG
 * query, network blip) at ~5 s of live history at 4 Hz.
 *
 * Exported for test access only — not part of the package's public API
 * surface (intentionally omitted from `index.ts`). Production code does not
 * tune this value; there is no constructor or option to override it.
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
   * Clears accumulator and raw-buffer (live-tail) state. The ring is left intact:
   * it is capacity-bounded and self-refreshing (the WS push is unconditional), and is
   * the seed source the tailMode effect rebuilds the buffer from on re-entry to Live.
   * Does NOT bump any counter — tile-fetch staleness is handled by
   * useTrendData.generationRef which is independent (§4.4).
   * Synchronous; safe to call inside dispatchModeAction wrappers.
   */
  drainBuffers(): void;
  /**
   * Returns max(sessionHighWaterMark, currentMaxAcrossSubscribedTags).
   * Returns null before the first TREND_DELTA frame arrives in the session.
   * Monotonic-non-decreasing within a session. Reset to null by drainBuffers.
   */
  getLatestSampleTs(): bigint | null;
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
  last: number | null;
  min: number | null;
  max: number | null;
  nullCount: number;
  valueCount: number;
}

interface AccumulatorState {
  openBucket: OpenBucket | null;
  closed: { value: (number | null)[]; min: (number | null)[]; max: (number | null)[] };
  firstClosedStartMs: bigint | null;
  lastKnownValue: number | null;
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function toNumericValue(v: number | boolean | string | null): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

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
    b.last = null;
  } else {
    b.last = numValue;
    b.min = b.min === null ? numValue : Math.min(b.min, numValue);
    b.max = b.max === null ? numValue : Math.max(b.max, numValue);
  }
}

function closeCurrentBucket(state: AccumulatorState): void {
  const b = state.openBucket!;
  const closedStartMs = b.startMs;
  let v: number | null, mn: number | null, mx: number | null;
  if (b.nullCount > 0) {
    v = null; mn = null; mx = null;
    state.lastKnownValue = null;
  } else if (b.valueCount === 0) {
    v = state.lastKnownValue; mn = v; mx = v;
  } else {
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
    return; // out-of-order: drop
  }

  const prevStartMs = state.openBucket.startMs;
  closeCurrentBucket(state);
  let nextStart = prevStartMs + bucketSMs;
  while (nextStart < eventBucketStart) {
    state.openBucket = newOpenBucket(nextStart);
    closeCurrentBucket(state);
    nextStart += bucketSMs;
  }
  state.openBucket = newOpenBucket(eventBucketStart);
  addToOpenBucket(state.openBucket, moduleTs, numValue);
}

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

function buildRawTail(rawBuffers: Map<number, TrendSample[]>): RawTail | null {
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

  const isLiveRef           = useRef(isLive);
  const bucketSMsRef        = useRef<bigint | null>(bucketSMs);
  const trimThresholdRef    = useRef<number | null>(trimThreshold);
  const seedRef             = useRef<Map<number, number | boolean | string | null> | null>(seedFromCachedTile);
  const tailModeRef         = useRef<'aggregate' | 'raw' | null>(tailMode);
  const viewportSpanMsRef   = useRef<bigint>(viewportSpanMs);
  const onDataReceivedRef   = useRef<((maxModuleTs: number) => void) | undefined>(onDataReceived);

  isLiveRef.current            = isLive;
  bucketSMsRef.current         = bucketSMs;
  trimThresholdRef.current     = trimThreshold;
  seedRef.current              = seedFromCachedTile;
  tailModeRef.current          = tailMode;
  viewportSpanMsRef.current    = viewportSpanMs;
  onDataReceivedRef.current    = onDataReceived;

  const pendingFrameMaxTsRef   = useRef<number>(0);
  const frameFlushScheduledRef = useRef(false);

  // Session-scoped high-water-mark. Reset to null by drainBuffers.
  const sessionHighWaterMarkRef = useRef<bigint | null>(null);

  const [tail, setTail] = useState<LiveTail>(null);

  const tagIdsKey    = tagIds.join(',');
  const bucketSMsStr = bucketSMs?.toString() ?? 'null';

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
            // Known race (intentional, not a bug): bucketSMsRef.current is updated
            // synchronously during render, but the tailMode effect that re-allocates
            // the accumulator with the new bucketSMs runs AFTER the render commit.
            // A TREND_DELTA arriving in that ~1-16 ms window feeds the new bucketSMs
            // into an accumulator whose openBucket.startMs is still aligned to the
            // old value, causing one frame of misaligned bucket arithmetic.
            //
            // We accept this because (a) the ring receives every sample
            // unconditionally above (line ~310), and (b) the tailMode effect's
            // reseed-from-ring on bucketSMs change replays every ring entry into a
            // fresh accumulator at the new bucketSMs — so any mis-bucketed sample
            // is corrected on the next render cycle. Adding a detect-and-skip guard
            // here would duplicate the reseed's correctness guarantee.
            const bSMs = bucketSMsRef.current;
            const state = accumulatorsRef.current.get(tagId);
            if (state) {
              processEventIntoAccumulator(state, moduleTs, toNumericValue(value), bSMs);

              const latestTs = sessionHighWaterMarkRef.current;
              if (latestTs !== null) {
                const trimLeftMs = latestTs - 2n * viewportSpanMsRef.current;
                for (const [, accState] of accumulatorsRef.current) {
                  const firstClosed = accState.firstClosedStartMs;
                  if (firstClosed === null) continue;
                  const diff = trimLeftMs - firstClosed;
                  if (diff <= 0n) continue;
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
              const cutoff = moduleTs - Number(2n * viewportSpanMsRef.current);
              for (const [, b] of rawBuffersRef.current) {
                while (b.length > 0 && b[0]!.moduleTs < cutoff) b.shift();
              }
              flushTail();
            }
          }
        }

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
    for (const [tagId, arr] of ringsRef.current) {
      ringsRef.current.set(tagId, arr.filter(e => e.moduleTs >= trimThreshold));
    }
  }, [trimThreshold]);

  // ── Tailing / tailMode effect ─────────────────────────────────────────────

  useEffect(() => {
    if (!isLive || tailMode === null) {
      accumulatorsRef.current.clear();
      rawBuffersRef.current.clear();
      setTail(null);
      return;
    }

    const threshold = trimThresholdRef.current;

    if (tailMode === 'aggregate') {
      if (bucketSMs === null) return;

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

      for (const tagId of tagIds) {
        const ring = ringsRef.current.get(tagId) ?? [];
        const entries = threshold !== null ? ring.filter(s => s.moduleTs >= threshold) : ring;
        const state = accumulatorsRef.current.get(tagId)!;
        for (const { moduleTs, value } of entries) {
          processEventIntoAccumulator(state, moduleTs, toNumericValue(value), bucketSMs);
        }
      }
    } else {
      accumulatorsRef.current.clear();
      rawBuffersRef.current.clear();
      for (const tagId of tagIds) {
        rawBuffersRef.current.set(tagId, []);
      }

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

  // ── drainBuffers ──────────────────────────────────────────────────────────
  // Resets accumulators, raw buffers, sessionHighWaterMark in-place.
  // Ring is left intact (it is bounded, self-refreshing, and the seed source the
  // tailMode effect rebuilds the buffer from on Live re-entry).
  // Does NOT bump any counter — tile-fetch staleness is handled by
  // useTrendData.generationRef which is independent (§4.4).
  //
  // In-place reset (not .clear()) is required: the subscribe callback's
  // `if (state)` / `if (buf)` guards would silently drop every event between
  // drainBuffers and the next tailMode-effect re-allocation if the per-tag keys
  // disappeared. See handoff Gotchas section — the rawBuffersRef fix is the
  // canonical reference; accumulatorsRef follows the same pattern.

  const drainBuffers = useCallback((): void => {
    for (const state of accumulatorsRef.current.values()) {
      state.openBucket          = null;
      state.closed.value.length = 0;
      state.closed.min.length   = 0;
      state.closed.max.length   = 0;
      state.firstClosedStartMs  = null;
      state.lastKnownValue      = null;
    }
    for (const arr of rawBuffersRef.current.values()) arr.length = 0;
    sessionHighWaterMarkRef.current = null;
    setTail(null);
  }, []);

  // ── getLatestSampleTs ─────────────────────────────────────────────────────
  //
  // Returns the highest moduleTs seen since session start, or null when no
  // sample has arrived yet (or after drainBuffers reset the session — matching
  // spec §19 glossary "Reset to null by drainBuffers").
  //
  // HWM is bumped on every WS sample before any conditional logic (see the
  // subscribe callback above), so HWM is always ≥ any current ring tail in a
  // live session. The previous implementation walked rings as a fallback for
  // the post-drain state, but every consumer of this value already handles
  // null gracefully (classifyByWindow falls back to viewport.end; the orange
  // Live button is gated on live-fixed mode, which can't be active post-drain).
  // The ring-walk fallback would have given a third behavior (classify against
  // a stale pre-drain tail) that no caller depends on.

  const getLatestSampleTs = useCallback((): bigint | null => {
    return sessionHighWaterMarkRef.current;
  }, []);

  const tailToReturn = useMemo(
    () => (tail !== null && tail.mode !== tailMode ? null : tail),
    [tail, tailMode],
  );

  return {
    drainBuffers,
    getLatestSampleTs,
    tail: tailToReturn,
  };
}
