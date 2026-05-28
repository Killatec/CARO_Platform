import type { Tile, Viewport } from './types.js';

/**
 * TimescaleDB's time_bucket() default origin for fixed-width intervals
 * (make_interval(secs => N)) is 2000-01-03 00:00:00 UTC — the first Monday of
 * year 2000, not the PostgreSQL epoch (2000-01-01). Tile boundaries must be
 * multiples of bucketSMs from this origin, not from Unix epoch (1970-01-01),
 * otherwise gapfill emits partial-coverage buckets at the edges and the response
 * n drifts from bucketCount by a small integer; harmless under the current contract
 * (clients consume response.n directly).
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
 * Smallest viewport span the chart will fetch for. Below this threshold,
 * gatedFetchTile rejects with CLIENT_UNDER_RANGE and TrendChartContainer
 * renders the under-range placeholder.
 *
 * The floor is the per-bucket-width minimum (1 ms — below which Math.round
 * produces 0 and downstream gapfill math breaks) scaled by the total bucket
 * count per viewport. Tracks TREND_VIEWER_DEFAULTS, so changing the
 * bucketCount or visibleTilesPerWindow defaults updates this automatically.
 *
 * Client-side concept only. The server has no symmetric threshold — sub-100 s
 * windows route to queryRaw via shape dispatch; the bucketed branch's
 * INVALID_BUCKET_S check catches genuinely invalid cases. See spec §6.3
 * Out-of-range UX.
 */
export const MIN_VIEWPORT_SPAN_MS =
  1n  // min bucketSMs in ms (gapfill math floor)
    * BigInt(TREND_VIEWER_DEFAULTS.bucketCount)
    * BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow);

/**
 * Lag in ms between a tile's endTime and nowMs before a refetch is triggered.
 * Provides a short settling window before a tile that has rolled into the past
 * gets a terminal re-fetch.
 */
export const REFETCH_LAG_MS = 1000;

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
 * Defense-in-depth cap on the number of visible tiles tilesForViewport may emit.
 * Legitimate renders produce 2–4 tiles; a mismatch between a wide viewport and a
 * stale tiny tileSpanMs can produce hundreds or thousands. This cap makes a tile
 * storm structurally impossible regardless of how the caller assembles its arguments.
 */
const MAX_VISIBLE_TILES = 16;

/**
 * Trend viewer tile set: all grid-aligned tiles covering [viewport.start, viewport.end)
 * at the given resolution, plus prefetch tiles on each side.
 *
 * The caller passes an explicit `tileSpanMs` (= currentBucketSMs × bucketCount) rather
 * than having it derived from the viewport span. This decouples the display viewport from
 * the resolution, eliminating the blank-tile bug that arose when modeViewport grew past
 * the coverage computed from a frozen cursor-centered dataViewport.
 *
 * Alignment strategy: left-anchor on the tile grid from TS_BUCKET_ORIGIN_MS.
 *   firstVisibleStart = largest multiple of tileSpanMs from origin ≤ viewport.start
 *   lastVisibleEnd    = firstVisibleStart + k×tileSpanMs where k is the smallest integer
 *                       such that lastVisibleEnd ≥ viewport.end
 *
 * This emits a VARIABLE visible tile count (typically 2–4) that covers the ENTIRE
 * viewport on both edges regardless of cursor position or zoom direction.
 *
 * Every tile boundary is a multiple of tileSpanMs from TS_BUCKET_ORIGIN_MS.
 * Since tileSpanMs = bucketSMs × bucketCount, every boundary is also bucket-aligned
 * — gapfill returns exactly bucketCount rows per tile request.
 *
 * Prefetch tiles may extend past now in tailing mode; the server returns null/locf
 * for future-coverage, overridden by the live tail extension as samples accumulate.
 */
export function tilesForViewport(opts: {
  viewport: Viewport;
  tileSpanMs: bigint;
  bucketCount?: number;
  overfetchPerSide?: number;
  /** Overrides left-side prefetch count. Defaults to overfetchPerSide if not provided. */
  overfetchLeftCount?: number;
  /** Overrides right-side prefetch count. Defaults to overfetchPerSide if not provided. */
  overfetchRightCount?: number;
  /**
   * When provided, prefetch tiles whose startTime is more than one tileSpanMs
   * past nowMs are dropped. Allows one tile of look-ahead in tailing mode.
   */
  nowMs?: bigint;
}): { visible: Tile[]; prefetch: Tile[] } {
  const {
    viewport,
    tileSpanMs,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
    overfetchPerSide = TREND_VIEWER_DEFAULTS.overfetchPerSide,
    overfetchLeftCount,
    overfetchRightCount,
    nowMs,
  } = opts;

  const leftCount  = overfetchLeftCount  ?? overfetchPerSide;
  const rightCount = overfetchRightCount ?? overfetchPerSide;

  if (tileSpanMs <= 0n) return { visible: [], prefetch: [] };

  const viewportSpan = viewport.end - viewport.start;
  if (viewportSpan <= 0n) return { visible: [], prefetch: [] };

  // Left-anchor on the tile grid: first visible tile starts at the largest tileSpanMs
  // multiple from TS_BUCKET_ORIGIN_MS that is ≤ viewport.start.
  const firstVisibleStart = TS_BUCKET_ORIGIN_MS +
    floorDiv(viewport.start - TS_BUCKET_ORIGIN_MS, tileSpanMs) * tileSpanMs;

  // Defense-in-depth: cap before allocating to make tile storms structurally impossible.
  const estimatedCount = Number(ceilDiv(viewport.end - firstVisibleStart, tileSpanMs));
  if (estimatedCount > MAX_VISIBLE_TILES) {
    console.warn(
      `tilesForViewport: would emit ${estimatedCount} visible tiles (cap ${MAX_VISIBLE_TILES}). ` +
      `viewport span ${viewport.end - viewport.start}ms, tileSpanMs ${tileSpanMs}ms. Returning empty.`,
    );
    return { visible: [], prefetch: [] };
  }

  // Collect all tiles whose coverage overlaps [viewport.start, viewport.end).
  const visible: Tile[] = [];
  let cursor = firstVisibleStart;
  while (cursor < viewport.end) {
    visible.push({ startTime: cursor, endTime: cursor + tileSpanMs, bucketCount });
    cursor += tileSpanMs;
  }

  const prefetch: Tile[] = [];
  // Tiles before the visible window.
  for (let i = leftCount; i >= 1; i--) {
    const start = firstVisibleStart - BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }
  // Tiles after the visible window (last visible ends at cursor).
  const lastVisibleEnd = cursor;
  for (let i = 0; i < rightCount; i++) {
    const start = lastVisibleEnd + BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }

  const futurePrunedPrefetch =
    nowMs === undefined ? prefetch : prefetch.filter(t => t.startTime < nowMs + tileSpanMs);
  // Pre-epoch tiles are geometrically invalid: filter both sets.
  const filteredPrefetch = futurePrunedPrefetch.filter(t => t.startTime >= 0n);
  const filteredVisible   = visible.filter(t => t.startTime >= 0n);

  return { visible: filteredVisible, prefetch: filteredPrefetch };
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

