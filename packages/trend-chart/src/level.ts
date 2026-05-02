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
 * For multi-tile viewport layouts use tilesForViewport instead.
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
 * Alignment strategy: right-anchor on the bucket grid.
 *   lastVisibleEnd    = first bucket boundary AT OR AFTER viewport.end
 *   firstVisibleStart = lastVisibleEnd − visibleTilesPerWindow × tileSpanMs
 *
 * This ensures:
 *   • lastVisibleEnd ≥ viewport.end — the live edge is always covered.
 *   • lastVisibleEnd − viewport.end < bucketSMs — gap is sub-minute even for
 *     7d/14d presets (≤ ~10 min at 604.8 s/bucket, versus ≤ 3.5 d with a
 *     tile-grid left-anchor).
 *   • Every tile boundary is a multiple of bucketSMs from TS_BUCKET_ORIGIN_MS,
 *     so time_bucket_gapfill returns exactly bucketCount rows per tile request.
 *
 * The left edge (firstVisibleStart) may sit up to one bucketSMs after
 * viewport.start — the visible region shifts forward slightly. At standard
 * presets this is sub-minute and invisible to the chart.
 *
 * Prefetch tiles after the visible window may extend past now in tailing mode;
 * the server returns null/locf for the future portion, no client-side handling
 * needed.
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
  /** When provided, prefetch tiles whose startTime >= nowMs are dropped (future-only tiles). */
  nowMs?: bigint;
}): { visible: Tile[]; prefetch: Tile[] } {
  const {
    viewport,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
    visibleTilesPerWindow = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow,
    overfetchPerSide = TREND_VIEWER_DEFAULTS.overfetchPerSide,
    nowMs,
  } = opts;

  const viewportSpan = viewport.end - viewport.start;
  if (viewportSpan <= 0n) return { visible: [], prefetch: [] };

  // Bigint floor division — exact for all reasonable viewport spans.
  const tileSpanMs = viewportSpan / BigInt(visibleTilesPerWindow);
  if (tileSpanMs === 0n) return { visible: [], prefetch: [] };

  // bucketSMs is exact for all standard preset spans (7d/2/500 = 604800ms etc.).
  const bucketSMs = tileSpanMs / BigInt(bucketCount);

  // Right-anchor on the bucket grid: last visible end is the first bucket
  // boundary at or after viewport.end. firstVisibleStart steps back by the
  // full visible window width. Both are multiples of bucketSMs from origin.
  const lastVisibleEnd = TS_BUCKET_ORIGIN_MS +
    ceilDiv(viewport.end - TS_BUCKET_ORIGIN_MS, bucketSMs) * bucketSMs;
  const firstVisibleStart = lastVisibleEnd - BigInt(visibleTilesPerWindow) * tileSpanMs;

  const visible: Tile[] = [];
  for (let k = 0; k < visibleTilesPerWindow; k++) {
    const start = firstVisibleStart + BigInt(k) * tileSpanMs;
    visible.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }

  const prefetch: Tile[] = [];
  // Tiles before the visible window.
  for (let i = overfetchPerSide; i >= 1; i--) {
    const start = firstVisibleStart - BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }
  // Tiles after the visible window.
  for (let i = 0; i < overfetchPerSide; i++) {
    const start = lastVisibleEnd + BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }

  const filteredPrefetch =
    nowMs === undefined ? prefetch : prefetch.filter(t => t.startTime < nowMs);

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

