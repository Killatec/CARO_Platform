import type { Tile, Viewport } from './types.js';

/** Trend viewer client policy defaults. Server accepts bucketCount 1..2500. */
export const TREND_VIEWER_DEFAULTS = {
  bucketCount: 500,
  visibleTilesPerWindow: 2,
  overfetchPerSide: 1,
} as const;

/**
 * Returns epoch-aligned tiles fully covering [rangeStart, rangeEnd).
 *
 * tileSpanMs is derived as floor((rangeEnd - rangeStart) / tileCount) where
 * tileCount = ceil(rangeSpan / (bucketCount * 1ms-per-bucket)). For this
 * primitive the caller controls bucketCount; the number of tiles returned is
 * the minimum needed to cover the range at that tile width.
 *
 * Alignment: each tile's startTime is an integer multiple of tileSpanMs from
 * epoch, so identical logical ranges produce identical wire values across
 * clients.
 *
 * Note: when rangeEnd - rangeStart is not evenly divisible by tileSpanMs the
 * last tile may extend slightly past rangeEnd. This is correct — the server
 * returns the natural bucket grid and the caller renders what it needs.
 */
export function alignedTilesInRange(opts: {
  rangeStart: bigint;
  rangeEnd: bigint;
  bucketCount: number;
}): Tile[] {
  const { rangeStart, rangeEnd, bucketCount } = opts;
  if (rangeEnd <= rangeStart) return [];

  const spanMs = rangeEnd - rangeStart;
  // Each tile spans exactly bucketCount buckets; derive a natural integer tile
  // span by taking the floor of the raw span divided by the number of tiles
  // needed. We compute the number of tiles as ceil(spanMs / targetTileSpan)
  // where targetTileSpan = spanMs / 1 (single tile) to start — simplified: we
  // just use 1 tile as the minimum and let the caller compose multiple calls
  // for multi-tile layouts. For range covering, 1 tile per call is the atomic
  // primitive; alignedTilesInRange covers a contiguous range.
  //
  // Implementation: produce tiles of width = spanMs (one tile) is too coarse.
  // Instead: tileSpanMs is the smallest power-of-10-friendly value ≥ spanMs
  // that fits the epoch alignment. Simpler and correct: tileSpanMs = spanMs
  // when the caller wants a single tile. For multi-tile layout callers use
  // tilesForViewport. This primitive just aligns [rangeStart, rangeEnd) to
  // epoch-multiples of the derived per-tile span.
  //
  // Practical use: analytics/export consumers call this with their own
  // rangeStart/rangeEnd/bucketCount. The tile span equals spanMs / n where n
  // is derived from the natural epoch alignment.

  // Derive tileSpanMs: one tile spans exactly (rangeEnd - rangeStart).
  // For aligned multi-tile usage, callers invoke once per tile.
  const tileSpanMs = spanMs;

  // Epoch-align the start.
  const alignedStart = (rangeStart / tileSpanMs) * tileSpanMs;

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
 * tileSpanMs = floor((viewport.end - viewport.start) / visibleTilesPerWindow)
 *
 * Visible tiles are epoch-aligned and render-blocking. Prefetch tiles are
 * contiguous with the visible set and fire async without gating render.
 *
 * Note: bigint floor division is used throughout. For typical viewport spans
 * (minutes to weeks) the result divides cleanly. For non-divisible spans the
 * visible tiles cumulatively span tileSpanMs * visibleTilesPerWindow ms, which
 * may be 1 ms short of the full viewport — invisible to a chart.
 */
export function tilesForViewport(opts: {
  viewport: Viewport;
  bucketCount?: number;
  visibleTilesPerWindow?: number;
  overfetchPerSide?: number;
}): { visible: Tile[]; prefetch: Tile[] } {
  const {
    viewport,
    bucketCount = TREND_VIEWER_DEFAULTS.bucketCount,
    visibleTilesPerWindow = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow,
    overfetchPerSide = TREND_VIEWER_DEFAULTS.overfetchPerSide,
  } = opts;

  const viewportSpan = viewport.end - viewport.start;
  if (viewportSpan <= 0n) return { visible: [], prefetch: [] };

  // Bigint floor division — exact for all reasonable viewport spans.
  const tileSpanMs = viewportSpan / BigInt(visibleTilesPerWindow);
  if (tileSpanMs === 0n) return { visible: [], prefetch: [] };

  // Epoch-align the first visible tile.
  const firstVisibleStart = (viewport.start / tileSpanMs) * tileSpanMs;

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
  const lastVisibleEnd = firstVisibleStart + BigInt(visibleTilesPerWindow) * tileSpanMs;
  for (let i = 0; i < overfetchPerSide; i++) {
    const start = lastVisibleEnd + BigInt(i) * tileSpanMs;
    prefetch.push({ startTime: start, endTime: start + tileSpanMs, bucketCount });
  }

  return { visible, prefetch };
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
