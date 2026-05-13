import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHmiContext } from '@caro/hmi-context';
import { TS_BUCKET_ORIGIN_MS, floorDiv } from './level.js';

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
  /** Whether the chart is in tailing mode. Defaults to false. */
  isTailing?: boolean;
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
   * Reads the union of ring + accumulator + raw-buffer covered range, clears
   * all three, returns the range. Returns { start: 0n, end: 0n } if empty.
   * Synchronous; safe to call inside dispatchModeAction wrappers.
   */
  commitAndDrain(): { start: bigint; end: bigint };
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
    isTailing    = false,
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
  const isTailingRef        = useRef(isTailing);
  const bucketSMsRef        = useRef<bigint | null>(bucketSMs);
  const trimThresholdRef    = useRef<number | null>(trimThreshold);
  const seedRef             = useRef<Map<number, number | boolean | string | null> | null>(seedFromCachedTile);
  const tailModeRef         = useRef<'aggregate' | 'raw' | null>(tailMode);
  const viewportSpanMsRef   = useRef<bigint>(viewportSpanMs);
  const onDataReceivedRef   = useRef<((maxModuleTs: number) => void) | undefined>(onDataReceived);

  // Frame-coalescing state for onDataReceived.
  const pendingFrameMaxTsRef   = useRef<number>(0);
  const frameFlushScheduledRef = useRef(false);

  isTailingRef.current      = isTailing;
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
    if (!isTailingRef.current || tailModeRef.current === null) {
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

        if (isTailingRef.current) {
          const mode = tailModeRef.current;
          if (mode === 'aggregate' && bucketSMsRef.current !== null) {
            const state = accumulatorsRef.current.get(tagId);
            if (state) {
              processEventIntoAccumulator(
                state, moduleTs, toNumericValue(value), bucketSMsRef.current,
              );
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
    if (!isTailing || tailMode === null) {
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
  }, [isTailing, bucketSMsStr, tagIdsKey, tailMode]);

  // ── commitAndDrain ────────────────────────────────────────────────────────

  const commitAndDrain = useCallback((): { start: bigint; end: bigint } => {
    // Collect ring range
    let fifoMin: number | null = null;
    let fifoMax: number | null = null;
    for (const arr of ringsRef.current.values()) {
      for (const { moduleTs } of arr) {
        if (fifoMin === null || moduleTs < fifoMin) fifoMin = moduleTs;
        if (fifoMax === null || moduleTs > fifoMax) fifoMax = moduleTs;
      }
    }

    // Collect accumulator range
    let accStart: bigint | null = null;
    let accEnd: bigint | null = null;
    const bSMs = bucketSMsRef.current;
    if (bSMs !== null) {
      for (const state of accumulatorsRef.current.values()) {
        let tagStart: bigint | null = null;
        let tagEnd: bigint | null = null;
        const { firstClosedStartMs, closed, openBucket } = state;
        if (firstClosedStartMs !== null) {
          tagStart = firstClosedStartMs;
          tagEnd   = firstClosedStartMs + BigInt(closed.value.length) * bSMs;
        }
        if (openBucket !== null) {
          const oStart = openBucket.startMs;
          const oEnd   = oStart + bSMs;
          if (tagStart === null || oStart < tagStart) tagStart = oStart;
          if (tagEnd   === null || oEnd   > tagEnd)   tagEnd   = oEnd;
        }
        if (tagStart !== null && tagEnd !== null) {
          if (accStart === null || tagStart < accStart) accStart = tagStart;
          if (accEnd   === null || tagEnd   > accEnd)   accEnd   = tagEnd;
        }
      }
    }

    // Collect raw range
    let rawMin: number | null = null;
    let rawMax: number | null = null;
    for (const buf of rawBuffersRef.current.values()) {
      for (const { moduleTs } of buf) {
        if (rawMin === null || moduleTs < rawMin) rawMin = moduleTs;
        if (rawMax === null || moduleTs > rawMax) rawMax = moduleTs;
      }
    }

    // Clear all underlying state (synchronous). React state (tail) will be cleared
    // by the tailing-exit effect that follows the dispatchModeAction call.
    for (const arr of ringsRef.current.values()) arr.length = 0;
    accumulatorsRef.current.clear();
    rawBuffersRef.current.clear();

    // Union ring, accumulator, and raw ranges
    const candidates = (pickStart: boolean): bigint[] => [
      pickStart ? (fifoMin !== null ? BigInt(fifoMin) : null) : (fifoMax !== null ? BigInt(fifoMax) : null),
      pickStart ? accStart : accEnd,
      pickStart ? (rawMin !== null ? BigInt(rawMin) : null) : (rawMax !== null ? BigInt(rawMax) : null),
    ].filter((v): v is bigint => v !== null);

    const startVals = candidates(true);
    const endVals   = candidates(false);

    if (startVals.length === 0 || endVals.length === 0) return { start: 0n, end: 0n };

    const unionStart = startVals.reduce((a, b) => a < b ? a : b);
    const unionEnd   = endVals.reduce((a, b) => a > b ? a : b);

    return { start: unionStart, end: unionEnd };
  }, []); // all stable refs — no deps needed

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

  return { commitAndDrain, tail: tailToReturn };
}
