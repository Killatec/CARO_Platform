import type { Tile, Viewport } from './types.js';

/**
 * TimescaleDB's time_bucket() default origin for fixed-width intervals
 * (make_interval(secs => N)) is 2000-01-03 00:00:00 UTC — the first Monday of
 * year 2000, not the PostgreSQL epoch (2000-01-01). Tile boundaries must be
 * multiples of bucketSMs from this origin, not from Unix epoch (1970-01-01),
 * otherwise gapfill emits partial-coverage buckets at the edges and the server
 * throws an assertion (n = bucketCount + 2).
 *
 * Empirically confirmed via psql: time_bucket(make_interval(secs => 604.8),
 * '2000-01-03') → '2000-01-03' (exact boundary); the same call with
 * '2000-01-01' → '1999-12-31 23:57:07.2' (not a boundary).
 *
 * The 15m/1h/4h/24h presets happen to align at any origin in this family
 * because 10,957 days (Unix↔PG epoch delta) divides evenly at those strides.
 * The 7d and 14d strides have a 2-day remainder, so origin matters — exactly
 * the presets that were producing 502 errors before this fix.
 */
export const TS_BUCKET_ORIGIN_MS = 946_857_600_000n; // 2000-01-03 00:00:00 UTC in ms

/**
 * True bigint floor division. JavaScript's bigint `/` operator truncates toward
 * zero, which matches floor for positive operands but rounds the wrong way for
 * negative dividends. Exported for callers that need left-anchor arithmetic on
 * TS_BUCKET_ORIGIN_MS-relative offsets from pre-2000-01-03 timestamps.
 */
export function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  // Adjust down by one when there is a remainder and the signs differ.
  return q * b !== a && (a < 0n) !== (b < 0n) ? q - 1n : q;
}

/**
 * True bigint ceiling division. For positive operands: (a + b - 1) / b.
 * For negative a, positive b: truncation toward zero is already ceiling, so
 * the (a < 0) !== (b < 0) branch adds 0 (no adjustment).
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  // Adjust up by one when there is a remainder and the signs agree (both positive
  // is the common case; the negative-a branch falls through unchanged).
  return q * b !== a && (a < 0n) === (b < 0n) ? q + 1n : q;
}

/** Trend viewer client policy defaults. Server accepts bucketCount 1..2500. */
export const TREND_VIEWER_DEFAULTS = {
  bucketCount: 500,
  visibleTilesPerWindow: 2,
  overfetchPerSide: 1,
} as const;

/**
 * Maximum allowed bucketS (seconds per bucket) accepted by the server.
 * MUST stay in sync with `MAX_BUCKET_S` in `packages/db/timescale/trends.ts`.
 * Not imported from @caro/db because doing so would pull pg-loaded runtime
 * into the browser bundle; duplication with a cross-ref is the pragmatic call
 * for a single stable number.
 */
export const MAX_BUCKET_S = 14746;

/**
 * Maximum viewport span supported by the trend API at the chart's default
 * geometry. Computed from MAX_BUCKET_S × per-tile bucket count × visible
 * tiles per window. ~170.67 days at defaults (14746 × 1000 × 500 × 2).
 *
 * Used by useTrendMode's reducer to clamp drag-zoom and other actions that
 * produce a viewport span. Without this clamp, users can drag past the
 * server's supported range and every fetch returns 400 INVALID_BUCKET_S.
 */
export const MAX_VIEWPORT_SPAN_MS =
  BigInt(MAX_BUCKET_S) * 1000n
    * BigInt(TREND_VIEWER_DEFAULTS.bucketCount)
    * BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow);

/**
 * Returns bucket-grid-aligned tiles covering [rangeStart, rangeEnd).
 *
 * Alignment strategy: right-anchor on the bucket grid. lastEnd is the first
 * bucket boundary at or after rangeEnd; the single tile spans
 * [lastEnd − tileSpanMs, lastEnd]. Both edges are multiples of bucketSMs from
 * TS_BUCKET_ORIGIN_MS, so time_bucket_gapfill returns exactly bucketCount rows.
 *
 * The right edge is guaranteed to cover rangeEnd. The left edge sits at
 * [rangeStart, rangeStart + bucketSMs) — it may be up to one bucket ahead of
 * rangeStart. For typical use (analytics, tile cache misses) the gap is
 * sub-minute and invisible.
 *
 * Bucket-grid alignment is correct for one-shot use (analytics, export, debug).
 * Do NOT use for time-advancing viewports (live tailing): every viewport.end
 * advance past a bucket boundary would change all tile keys. Use tilesForViewport
 * for those — it right-anchors on the tile grid for cache stability.
 */
export function alignedTilesInRange(opts: {
  rangeStart: bigint;
  rangeEnd: bigint;
  bucketCount: number;
}): Tile[] {
  const { rangeStart, rangeEnd, bucketCount } = opts;
  if (rangeEnd <= rangeStart) return [];

  const spanMs = rangeEnd - rangeStart;
  const tileSpanMs = spanMs;
  const bucketSMs = tileSpanMs / BigInt(bucketCount);

  // Right-anchor: find the first bucket boundary at or after rangeEnd.
  const lastEnd = TS_BUCKET_ORIGIN_MS + ceilDiv(rangeEnd - TS_BUCKET_ORIGIN_MS, bucketSMs) * bucketSMs;
  const alignedStart = lastEnd - tileSpanMs;

  const tiles: Tile[] = [];
  let cursor = alignedStart;
  while (cursor < rangeEnd) {
    tiles.push({
      startTime: cursor,
      endTime: cursor + tileSpanMs,
      bucketCount,
    });
    cursor += tileSpanMs;
  }
  return tiles;
}

/**
 * Trend viewer composite: 2 visible tiles + prefetch tiles per side.
 *
 * tileSpanMs = floor((viewport.end − viewport.start) / visibleTilesPerWindow)
 * bucketSMs  = tileSpanMs / bucketCount  (exact for standard preset spans)
 *
 * Alignment strategy: right-anchor on the tile grid.
 *   lastVisibleEnd    = first tileSpanMs boundary AT OR AFTER viewport.end
 *   firstVisibleStart = lastVisibleEnd − visibleTilesPerWindow × tileSpanMs
 *
 * This ensures:
 *   • lastVisibleEnd ≥ viewport.end — the live edge is always covered.
 *   • lastVisibleEnd − viewport.end < tileSpanMs — tiles are stable across all
 *     viewport.end advances that stay within the same tile boundary window,
 *     eliminating cache thrashing in live tailing mode.
 *   • Every tile boundary is a multiple of tileSpanMs from TS_BUCKET_ORIGIN_MS.
 *     Since tileSpanMs = bucketSMs × bucketCount, every tile boundary is also a
 *     multiple of bucketSMs, so time_bucket_gapfill returns exactly bucketCount
 *     rows per tile request.
 *
 * Trade-off vs the prior bucket-grid right-anchor: the rightmost cached tile may
 * contain up to tileSpanMs of future-coverage gapfill/LOCF past viewport.end.
 * In live mode this extra data is overridden by the live tail extension before
 * rendering. In fixed mode the chart X-axis clips to viewport.end so the extra
 * data is fetched but not displayed.
 *
 * The left edge (firstVisibleStart) may sit up to one tileSpanMs after
 * viewport.start — the visible region shifts forward slightly. At standard
 * presets this is at most one tile-span and invisible if the chart clips to
 * viewport.start.
 *
 * Prefetch tiles after the visible window may extend past now in tailing mode.
 * The server returns null/locf for the future-coverage region; the live tail
 * extension overrides those gapfilled buckets as samples accumulate, so no
 * special client-side handling is needed at the chart edge.
 *
 * Note: bigint floor division is used for tileSpanMs. For typical viewport
 * spans (minutes to weeks) the span divides cleanly by visibleTilesPerWindow.
 * For non-divisible spans the visible region is 1 ms short — invisible.
 */
export function tilesForViewport(opts: {
  viewport: Viewport;
  bucketCount?: number;
  visibleTilesPerWindow?: number;
  overfetchPerSide?: number;
  /** Overrides left-side prefetch count. Defaults to overfetchPerSide if not provided. */
  overfetchLeftCount?: number;
  /** Overrides right-side prefetch count. Defaults to overfetchPerSide if not provided. */
  overfetchRightCount?: number;
  /**
   * When provided, prefetch tiles whose startTime is more than one tileSpanMs
   * past nowMs are dropped. Allows one tile of look-ahead in tailing mode so
   * the after-prefetch tile (startTime = lastVisibleEnd, up to tileSpanMs past
   * nowMs under tile-grid alignment) is included. Without this allowance,
   * ensureCovered would fetch the after-tile every halfTileMs threshold crossing
   * only for performSwap to evict it on the next viewport tick — constant churn.
   */
  nowMs?: bigint;
}): { visible: Tile[]; prefetch: Tile[] } {
  const {
    viewport,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
    visibleTilesPerWindow = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow,
    overfetchPerSide = TREND_VIEWER_DEFAULTS.overfetchPerSide,
    overfetchLeftCount,
    overfetchRightCount,
    nowMs,
  } = opts;

  const leftCount  = overfetchLeftCount  ?? overfetchPerSide;
  const rightCount = overfetchRightCount ?? overfetchPerSide;

  const viewportSpan = viewport.end - viewport.start;
  if (viewportSpan <= 0n) return { visible: [], prefetch: [] };

  // Bigint floor division — exact for all reasonable viewport spans.
  const tileSpanMs = viewportSpan / BigInt(visibleTilesPerWindow);
  if (tileSpanMs === 0n) return { visible: [], prefetch: [] };

  // bucketSMs is exact for all standard preset spans (7d/2/500 = 604800ms etc.).
  const bucketSMs = tileSpanMs / BigInt(bucketCount);
  // Defensive: tileSpanMs > 0 but < bucketCount causes bigint division to yield 0n,
  // which would crash ceilDiv (division by zero). Sub-millisecond viewports are nonsensical.
  if (bucketSMs === 0n) return { visible: [], prefetch: [] };

  // Right-anchor on the tile grid: last visible end is the first tile boundary
  // at or after viewport.end. Since tileSpanMs = bucketSMs × bucketCount, tile
  // boundaries are also bucket-aligned — gapfill invariant is preserved. Tiles
  // are stable across viewport.end advances that stay within the same tile window.
  const lastVisibleEnd = TS_BUCKET_ORIGIN_MS +
    ceilDiv(viewport.end - TS_BUCKET_ORIGIN_MS, tileSpanMs) * tileSpanMs;
  const firstVisibleStart = lastVisibleEnd - BigInt(visibleTilesPerWindow) * tileSpanMs;

  const visible: Tile[] = [];
  for (let k = 0; k < visibleTilesPerWindow; k++) {
    const start = firstVisibleStart + BigInt(k) * tileSpanMs;
    visible.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }

  const prefetch: Tile[] = [];
  // Tiles before the visible window.
  for (let i = leftCount; i >= 1; i--) {
    const start = firstVisibleStart - BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }
  // Tiles after the visible window.
  for (let i = 0; i < rightCount; i++) {
    const start = lastVisibleEnd + BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }

  const filteredPrefetch =
    nowMs === undefined ? prefetch : prefetch.filter(t => t.startTime < nowMs + tileSpanMs);

  return { visible, prefetch: filteredPrefetch };
}

/**
 * Derives the bucket width in milliseconds for a given viewport and policy.
 * Returned as Number; precision is sufficient for the resolution indicator
 * and diagnostic logs. Avoid using for timestamp arithmetic — use bigint tile
 * math instead.
 */
export function deriveBucketSMs(opts: {
  viewport: Viewport;
  visibleTilesPerWindow?: number;
  bucketCount?: number;
}): number {
  const {
    viewport,
    visibleTilesPerWindow = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
  } = opts;
  const viewportSpanMs = Number(viewport.end - viewport.start);
  return viewportSpanMs / (visibleTilesPerWindow * bucketCount);
}

/**
 * Detect zoom-level threshold crossing.
 * Returns 'out' if newSpan / anchorSpan > threshold (zoom-out triggered),
 * returns 'in'  if newSpan / anchorSpan < 1 / threshold (zoom-in triggered),
 * returns null otherwise (within safe continuous-zoom range).
 */
export function computeZoomLevelTransition(
  newSpanMs: bigint,
  anchorSpanMs: bigint,
  threshold = 1.5,
): 'in' | 'out' | null {
  if (anchorSpanMs <= 0n) return null;
  const ratio = Number(newSpanMs) / Number(anchorSpanMs);
  if (ratio > threshold) return 'out';
  if (ratio < 1 / threshold) return 'in';
  return null;
}

