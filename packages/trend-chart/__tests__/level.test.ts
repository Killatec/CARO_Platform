import { describe, it, expect } from 'vitest';
import {
  alignedTilesInRange,
  tilesForViewport,
  deriveBucketSMs,
  computeZoomLevelTransition,
  TREND_VIEWER_DEFAULTS,
  TS_BUCKET_ORIGIN_MS,
  MAX_BUCKET_S,
} from '../src/level.js';
import type { Viewport } from '../src/types.js';

// ─── alignedTilesInRange ───────────────────────────────────────────────────

describe('alignedTilesInRange', () => {
  it('returns empty array when rangeEnd <= rangeStart', () => {
    expect(alignedTilesInRange({ rangeStart: 1000n, rangeEnd: 1000n, bucketCount: 500 })).toEqual([]);
    expect(alignedTilesInRange({ rangeStart: 2000n, rangeEnd: 1000n, bucketCount: 500 })).toEqual([]);
  });

  it('returns a single tile covering the full range', () => {
    const start = 0n;
    const end = 3_600_000n; // 1 hour in ms
    const tiles = alignedTilesInRange({ rangeStart: start, rangeEnd: end, bucketCount: 500 });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.startTime).toBe(start);
    expect(tiles[0]!.endTime).toBe(end);
    expect(tiles[0]!.bucketCount).toBe(500);
  });

  it('respects bucketCount passed through to returned Tile', () => {
    const tiles = alignedTilesInRange({ rangeStart: 0n, rangeEnd: 60_000n, bucketCount: 250 });
    expect(tiles[0]!.bucketCount).toBe(250);
  });

  it('right-anchors the end to the bucket grid; left edge within one bucketSMs of rangeStart', () => {
    // rangeStart=500n, rangeEnd=1500n, span=1000n, bucketSMs=2n (1000n/500).
    // lastEnd = ceilDiv(1500n − origin, 2n) * 2n + origin = 1500n (exact).
    // alignedStart = 1500n − 1000n = 500n.
    const tiles = alignedTilesInRange({ rangeStart: 500n, rangeEnd: 1500n, bucketCount: 500 });
    expect(tiles).toHaveLength(1);
    const bucketSMs = 2n; // tileSpanMs(1000n) / bucketCount(500)
    // Right edge covers rangeEnd; gap is sub-bucket.
    expect(tiles[0]!.endTime >= 1500n).toBe(true);
    expect(tiles[0]!.endTime - 1500n < bucketSMs).toBe(true);
    // Left edge is at or after rangeStart; slip is sub-bucket.
    expect(tiles[0]!.startTime >= 500n).toBe(true);
    expect(tiles[0]!.startTime - 500n < bucketSMs).toBe(true);
  });

  it('all returned startTime values are bigint', () => {
    const tiles = alignedTilesInRange({ rangeStart: 0n, rangeEnd: 86_400_000n, bucketCount: 500 });
    for (const t of tiles) {
      expect(typeof t.startTime).toBe('bigint');
      expect(typeof t.endTime).toBe('bigint');
    }
  });
});

// ─── tilesForViewport ────────────────────────────────────────────────────────

describe('tilesForViewport', () => {
  const oneHourMs = 3_600_000n;
  // Use TS_BUCKET_ORIGIN_MS as base so the left-prefetch tile is well above epoch.
  // { start: 0n, end: oneHourMs } would place firstVisibleStart at 0n and the
  // left-prefetch at -1_800_000n (pre-epoch), which the filter correctly removes.
  const BASE = TS_BUCKET_ORIGIN_MS;
  const viewport: Viewport = { start: BASE, end: BASE + oneHourMs };
  // Default tileSpanMs for the standard 1h-preset, visibleTilesPerWindow=2 geometry.
  const DEFAULT_TILE_SPAN = oneHourMs / 2n; // 1_800_000n

  it('default config: 2 visible + 2 prefetch tiles (1 each side)', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    expect(visible).toHaveLength(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow);  // 2
    expect(prefetch).toHaveLength(TREND_VIEWER_DEFAULTS.overfetchPerSide * 2); // 2
  });

  it('visible tiles span the tile-grid-aligned viewport', () => {
    const { visible } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    // BASE (TS_BUCKET_ORIGIN_MS) is the tile-grid origin; firstVisibleStart lands exactly at BASE.
    expect(visible[0]!.startTime).toBe(BASE);
    expect(visible[0]!.endTime).toBe(BASE + DEFAULT_TILE_SPAN);
    expect(visible[1]!.startTime).toBe(BASE + DEFAULT_TILE_SPAN);
    expect(visible[1]!.endTime).toBe(BASE + DEFAULT_TILE_SPAN * 2n);
  });

  it('prefetch[0] is exactly one tile before visible[0]', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    expect(prefetch[0]!.endTime).toBe(visible[0]!.startTime);
    expect(prefetch[0]!.startTime).toBe(visible[0]!.startTime - DEFAULT_TILE_SPAN);
  });

  it('prefetch[1] is exactly one tile after the last visible tile', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    const lastVisible = visible[visible.length - 1]!;
    expect(prefetch[prefetch.length - 1]!.startTime).toBe(lastVisible.endTime);
  });

  it('overfetchPerSide=2 produces 4 prefetch tiles (2 each side)', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, overfetchPerSide: 2 });
    expect(visible).toHaveLength(2);
    expect(prefetch).toHaveLength(4);
  });

  it('overfetchLeftCount=1, overfetchRightCount=0 → 1 prefetch tile to the left', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, overfetchLeftCount: 1, overfetchRightCount: 0 });
    expect(visible).toHaveLength(2);
    expect(prefetch).toHaveLength(1);
    // The single prefetch tile must be to the left of the visible window.
    expect(prefetch[0]!.endTime).toBe(visible[0]!.startTime);
  });

  it('overfetchLeftCount=0, overfetchRightCount=1 → 1 prefetch tile to the right', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, overfetchLeftCount: 0, overfetchRightCount: 1 });
    expect(visible).toHaveLength(2);
    expect(prefetch).toHaveLength(1);
    // The single prefetch tile must be to the right of the visible window.
    expect(prefetch[0]!.startTime).toBe(visible[visible.length - 1]!.endTime);
  });

  it('overfetchLeftCount and overfetchRightCount both omitted → falls back to overfetchPerSide', () => {
    const { prefetch: defaultPrefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    const { prefetch: explicitPrefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, overfetchPerSide: 1 });
    expect(defaultPrefetch).toHaveLength(explicitPrefetch.length);
    expect(defaultPrefetch).toEqual(explicitPrefetch);
  });

  it('all returned Tile.startTime and endTime are bigint', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    for (const t of [...visible, ...prefetch]) {
      expect(typeof t.startTime).toBe('bigint');
      expect(typeof t.endTime).toBe('bigint');
    }
  });

  it('default bucketCount is 500 on all tiles', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    for (const t of [...visible, ...prefetch]) {
      expect(t.bucketCount).toBe(500);
    }
  });

  it('left-anchor: viewport start snaps to previous tile boundary; right edge covers viewport end', () => {
    // Left-anchor behavior: firstVisibleStart = largest tile-grid multiple ≤ viewport.start.
    // Place viewport.start 1ms past a tile boundary.
    // firstVisibleStart snaps back to that boundary (1ms before viewport.start).
    // The right edge (lastVisibleEnd) must cover viewport.end; gap is sub-tile.
    const tileSpanMs = 1_800_000n;
    const vpStart = TS_BUCKET_ORIGIN_MS + 3n * tileSpanMs + 1n;
    const vpEnd   = vpStart + 3_600_000n; // 2 tiles + 1ms
    const vp: Viewport = { start: vpStart, end: vpEnd };
    const { visible } = tilesForViewport({ viewport: vp, tileSpanMs });
    const lastVisibleEnd = visible[visible.length - 1]!.endTime;
    // Right edge covers viewport.end; gap is sub-tile.
    expect(lastVisibleEnd >= vp.end).toBe(true);
    expect(lastVisibleEnd - vp.end < tileSpanMs).toBe(true);
    // Left edge is at or BEFORE viewport.start; gap is sub-tile.
    expect(visible[0]!.startTime <= vp.start).toBe(true);
    expect(vp.start - visible[0]!.startTime < tileSpanMs).toBe(true);
    // Variable tile count ≥ 2 (covers full viewport on both sides).
    expect(visible.length).toBeGreaterThanOrEqual(2);
  });

  it('epoch-aligned: 24h viewport', () => {
    const oneDayMs = 86_400_000n;
    const vp: Viewport = { start: oneDayMs, end: oneDayMs * 2n };
    const tileSpan = oneDayMs / 2n;
    const { visible } = tilesForViewport({ viewport: vp, tileSpanMs: tileSpan });
    expect(visible[0]!.startTime).toBe(oneDayMs);
    expect(visible[0]!.endTime).toBe(oneDayMs + tileSpan);
  });

  it('epoch-aligned: 7d viewport at a realistic 2026 timestamp', () => {
    // 2026-04-27T00:00:00Z — known trigger of the 7d/14d 502 bug.
    // Tile boundaries are multiples of bucketSMs from TS_BUCKET_ORIGIN_MS.
    const sevenDaysMs = 7n * 86_400_000n;
    const vp: Viewport = { start: 1_777_507_200_000n, end: 1_777_507_200_000n + sevenDaysMs };
    const tileSpan = sevenDaysMs / 2n;  // 302_400_000n
    const bucketSMs = tileSpan / 500n;  // 604_800n
    const { visible } = tilesForViewport({ viewport: vp, tileSpanMs: tileSpan });
    // Right edge covers viewport.end; gap is sub-tile.
    const lastVisibleEnd = visible[visible.length - 1]!.endTime;
    expect(lastVisibleEnd >= vp.end).toBe(true);
    expect(lastVisibleEnd - vp.end < tileSpan).toBe(true);
    // All tile boundaries are on the bucket grid (tile boundaries ⊂ bucket boundaries).
    for (const tile of visible) {
      expect((tile.startTime - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      expect((tile.endTime   - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
    }
  });

  it('returns empty arrays for zero-span viewport', () => {
    const { visible, prefetch } = tilesForViewport({ viewport: { start: 0n, end: 0n }, tileSpanMs: DEFAULT_TILE_SPAN });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('returns empty arrays when tileSpanMs is zero', () => {
    // Guard: tileSpanMs <= 0n → return empty immediately.
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: 0n });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('returns empty arrays when tileSpanMs is negative', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, tileSpanMs: -1n });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('nowMs omitted: prefetch contains both before and after tiles (existing behaviour)', () => {
    const { prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    expect(prefetch).toHaveLength(2); // 1 before + 1 after
  });

  it('nowMs provided at live edge: after-tile within one tileSpanMs is kept (tailing look-ahead)', () => {
    // viewport ends at BASE + oneHourMs; after-prefetch startTime = BASE + oneHourMs.
    // Filter: startTime < nowMs + tileSpanMs → BASE+ONE_HOUR < BASE+ONE_HOUR+HALF_HOUR → kept.
    // Both before and after prefetch tiles are included.
    const { prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, nowMs: BASE + oneHourMs });
    expect(prefetch).toHaveLength(2);
  });

  it('nowMs provided: after-tile more than one tileSpanMs past nowMs is dropped', () => {
    // after-prefetch startTime = BASE + oneHourMs; tileSpanMs = 1_800_000n.
    // Set nowMs = BASE + halfTileMs so nowMs + tileSpanMs = BASE + oneHourMs.
    // Filter: BASE+oneHourMs < BASE+oneHourMs → false → after-tile dropped.
    const { prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, nowMs: BASE + DEFAULT_TILE_SPAN });
    expect(prefetch).toHaveLength(1);
    // Only the before-tile remains.
    const { visible } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    expect(prefetch[0]!.endTime).toBe(visible[0]!.startTime);
  });

  it('nowMs provided but after-tile is in the past: both tiles kept', () => {
    // Viewport is entirely in the past relative to farFutureNow; both prefetch tiles kept.
    const pastViewport: Viewport = { start: BASE, end: BASE + oneHourMs };
    const farFutureNow = BASE + oneHourMs * 1_000_000n;
    const { prefetch } = tilesForViewport({ viewport: pastViewport, tileSpanMs: DEFAULT_TILE_SPAN, nowMs: farFutureNow });
    expect(prefetch).toHaveLength(2);
  });

  it('regression — tailing mode: after-prefetch included when startTime equals nowMs', () => {
    // The after-prefetch startTime = lastVisibleEnd which may equal nowMs exactly
    // (viewport.end on tile boundary). The filter keeps it for tailing look-ahead.
    const { prefetch } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN, nowMs: BASE + oneHourMs });
    const afterTile = prefetch.find(t => t.startTime >= BASE + oneHourMs);
    expect(afterTile).toBeDefined();
    expect(afterTile!.startTime).toBe(BASE + oneHourMs);
    expect(afterTile!.endTime).toBe(BASE + oneHourMs + DEFAULT_TILE_SPAN);
  });

  it('epoch-adjacent viewport: left-prefetch tile is filtered when it would be pre-epoch', () => {
    // TS_BUCKET_ORIGIN_MS alignment can push the left-prefetch tile before Unix epoch
    // when the viewport is epoch-adjacent. Filter ensures startTime < 0n is dropped.
    const { bucketCount, visibleTilesPerWindow } = TREND_VIEWER_DEFAULTS;
    const tileSpanMs = BigInt(MAX_BUCKET_S) * BigInt(bucketCount) * 1000n;
    const epochAdjacentViewport: Viewport = { start: 1n, end: tileSpanMs * BigInt(visibleTilesPerWindow) + 1n };
    const { visible, prefetch } = tilesForViewport({ viewport: epochAdjacentViewport, tileSpanMs });
    // Visible tiles must all have non-negative startTime.
    for (const t of visible) {
      expect(t.startTime >= 0n).toBe(true);
    }
    // All pre-epoch prefetch tiles must be filtered out.
    for (const t of prefetch) {
      expect(t.startTime >= 0n).toBe(true);
    }
    // Visible tiles must actually be present — the viewport is valid, just epoch-adjacent.
    expect(visible.length).toBeGreaterThan(0);
  });

  // ── Regression: 7d / 14d preset 500 error (TimescaleDB PG-epoch alignment) ──
  //
  // Root cause: time_bucket() uses 2000-01-01 (PG epoch) as origin. The 10,957-day
  // delta between Unix and PG epochs is 7 × 1565 + 2, so 7-day and 14-day strides
  // produce a 2-day misalignment between the two epochs. Prior to this fix, tile
  // boundaries were Unix-epoch-aligned; gapfill emitted one partial-coverage bucket
  // at each misaligned edge, producing n = 502. The server assertion (n ≤ 501) then
  // threw, resulting in a 500 response.

  it('regression 7d: tile boundaries are bucket-aligned for a 2026 viewport', () => {
    // 2026-04-27T00:00:00Z — the exact failing URL start_time, reproduced from the
    // live error: start=1777507200000, end=1777809600000, bucket_count=500.
    // bucketS = 302_400_000 / 500 / 1000 = 604.8 s → 1min_cagg.
    // Unix-epoch-aligned start is NOT a multiple of 604.8 s from PG epoch.
    const sevenDaysMs = 7n * 86_400_000n;
    const vp: Viewport = { start: 1_777_507_200_000n, end: 1_777_507_200_000n + sevenDaysMs };
    const tileSpan = sevenDaysMs / 2n; // 302_400_000n
    const bucketSMs = tileSpan / 500n; // 604_800n

    const { visible, prefetch } = tilesForViewport({ viewport: vp, tileSpanMs: tileSpan });

    for (const tile of [...visible, ...prefetch]) {
      // Both edges must be multiples of bucketSMs from TS_BUCKET_ORIGIN_MS.
      expect((tile.startTime - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      expect((tile.endTime   - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      // And each tile spans exactly 500 buckets.
      expect(tile.endTime - tile.startTime).toBe(tileSpan);
      expect(tile.bucketCount).toBe(500);
    }
    // Live-edge: visible right edge covers viewport.end; gap is sub-tile.
    const lastVisibleEnd = visible[visible.length - 1]!.endTime;
    expect(lastVisibleEnd >= vp.end).toBe(true);
    expect(lastVisibleEnd - vp.end < tileSpan).toBe(true);
  });

  it('regression 14d: tile boundaries are bucket-aligned for a 2026 viewport', () => {
    const fourteenDaysMs = 14n * 86_400_000n;
    const vp: Viewport = { start: 1_777_507_200_000n, end: 1_777_507_200_000n + fourteenDaysMs };
    const tileSpan = fourteenDaysMs / 2n; // 604_800_000n
    const bucketSMs = tileSpan / 500n;    // 1_209_600n

    const { visible, prefetch } = tilesForViewport({ viewport: vp, tileSpanMs: tileSpan });

    for (const tile of [...visible, ...prefetch]) {
      expect((tile.startTime - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      expect((tile.endTime   - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      expect(tile.endTime - tile.startTime).toBe(tileSpan);
    }
    // Live-edge: visible right edge covers viewport.end; gap is sub-tile.
    const lastVisibleEnd = visible[visible.length - 1]!.endTime;
    expect(lastVisibleEnd >= vp.end).toBe(true);
    expect(lastVisibleEnd - vp.end < tileSpan).toBe(true);
  });

  it('15m/1h/4h/24h presets: bucket-aligned + live-edge covered', () => {
    const cases: [string, bigint][] = [
      ['15m', 15n * 60_000n],
      ['1h',  3_600_000n],
      ['4h',  4n * 3_600_000n],
      ['24h', 86_400_000n],
    ];
    const now = 1_777_507_200_000n;
    for (const [label, spanMs] of cases) {
      const vp: Viewport = { start: now, end: now + spanMs };
      const tileSpan = spanMs / 2n;
      const bucketSMs = tileSpan / 500n;
      const { visible } = tilesForViewport({ viewport: vp, tileSpanMs: tileSpan });
      const lastVisibleEnd = visible[visible.length - 1]!.endTime;
      expect(lastVisibleEnd >= vp.end).toBe(true);
      expect(lastVisibleEnd - vp.end < tileSpan).toBe(true);
      for (const tile of visible) {
        expect((tile.startTime - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
        expect((tile.endTime   - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      }
      void label;
    }
  });

  it('tile-grid stability: viewport.start within same tile cell returns identical tiles', () => {
    // Left-anchor stability: as long as viewport.start stays in the same tile-grid cell
    // and viewport.end stays in the same tile-grid cell, the tile set is unchanged.
    // This eliminates cache thrashing during continuous zoom-out.
    const tileSpanMs = 1_800_000n;
    // Place base: start 1ms into tile cell [3*ts, 4*ts), end spanning into tile cell [5*ts, 6*ts).
    const baseStart = TS_BUCKET_ORIGIN_MS + 3n * tileSpanMs + 1n;
    const baseEnd   = baseStart + 3_600_000n; // 2 tile spans + 1ms
    const base: Viewport = { start: baseStart, end: baseEnd };
    // Advance start by (tileSpanMs - 2ms): still in the same tile cell [3*ts, 4*ts).
    const delta = tileSpanMs - 2n;
    const advanced: Viewport = { start: baseStart + delta, end: baseEnd + delta };

    const { visible: baseVis, prefetch: basePre } = tilesForViewport({ viewport: base, tileSpanMs });
    const { visible: advVis, prefetch: advPre } = tilesForViewport({ viewport: advanced, tileSpanMs });

    expect(advVis).toEqual(baseVis);
    expect(advPre).toEqual(basePre);
  });

  it('tilesForViewport — Live-mode call shape (overfetchRightCount=0, variable visible count)', () => {
    // Viewport deliberately misaligned with TS_BUCKET_ORIGIN_MS: start is 12_345n past
    // the origin, end is 72_345n past. With tileSpanMs=30_000n (left-anchor):
    //   firstVisibleStart = ORIGIN + floor(12_345n / 30_000n) * 30_000n = ORIGIN
    //   visible tiles: [ORIGIN, +30k), [ORIGIN+30k, +60k), [ORIGIN+60k, +90k) — 3 tiles covering
    //   the full viewport [ORIGIN+12_345n, ORIGIN+72_345n).
    const vpStart = TS_BUCKET_ORIGIN_MS + 12_345n;
    const vpEnd   = TS_BUCKET_ORIGIN_MS + 72_345n;
    const vp: Viewport = { start: vpStart, end: vpEnd };
    const tileSpanMs = 30_000n;

    const { visible, prefetch } = tilesForViewport({
      viewport: vp,
      tileSpanMs,
      bucketCount: 500,
      overfetchLeftCount: 1,
      overfetchRightCount: 0,
    });

    // (a) variable visible count covering ENTIRE viewport (left AND right edges covered).
    expect(visible[0]!.startTime).toBeLessThanOrEqual(vpStart);
    expect(visible[visible.length - 1]!.endTime).toBeGreaterThanOrEqual(vpEnd);
    expect(visible.length).toBeGreaterThanOrEqual(2);

    // (b) exactly 1 prefetch tile, immediately left of visible[0]
    expect(prefetch).toHaveLength(1);
    expect(prefetch[0]!.endTime).toBe(visible[0]!.startTime);

    // (c) no prefetch tile to the right
    const rightPrefetch = prefetch.filter(t => t.startTime >= visible[visible.length - 1]!.endTime);
    expect(rightPrefetch).toHaveLength(0);

    // (d) tile-grid alignment: every startTime is a multiple of tileSpanMs from TS_BUCKET_ORIGIN_MS
    for (const tile of [...visible, ...prefetch]) {
      expect((tile.startTime - TS_BUCKET_ORIGIN_MS) % tileSpanMs).toBe(0n);
    }

    // (e) no gaps between consecutive visible tiles
    for (let i = 0; i < visible.length - 1; i++) {
      expect(visible[i]!.endTime).toBe(visible[i + 1]!.startTime);
    }
  });

  // ── Regression: blank-tile bug (two-viewport problem) ─────────────────────
  //
  // Root cause: when fetch used a frozen cursor-centered dataViewport while display
  // used a growing modeViewport, tiles on the side opposite the cursor went unfetched.
  // Fix: pass explicit tileSpanMs so coverage follows modeViewport directly.

  it('regression: off-center viewport covers BOTH edges with variable visible count', () => {
    // Reproduces the blank-tile bug: any viewport must have visible tiles covering
    // the ENTIRE range [viewport.start, viewport.end), regardless of cursor position.
    const tileSpanMs = 30_000n;
    const vpStart = TS_BUCKET_ORIGIN_MS + 12_345n;
    const vpEnd   = TS_BUCKET_ORIGIN_MS + 72_345n;
    const vp: Viewport = { start: vpStart, end: vpEnd };

    const { visible } = tilesForViewport({ viewport: vp, tileSpanMs });

    expect(visible[0]!.startTime).toBeLessThanOrEqual(vpStart);
    expect(visible[visible.length - 1]!.endTime).toBeGreaterThanOrEqual(vpEnd);
    expect(visible.length).toBeGreaterThanOrEqual(2);
    expect(visible.length).toBeLessThanOrEqual(4);
    // Contiguous tiles — no gaps.
    for (let i = 0; i < visible.length - 1; i++) {
      expect(visible[i]!.endTime).toBe(visible[i + 1]!.startTime);
    }
  });

  it('regression: modeViewport growing off-center within a level stays covered on both edges', () => {
    // Simulates continuous wheel-zoom-out: modeViewport grows while tileSpanMs (= currentBucketSMs
    // × bucketCount) stays fixed. The tile set must always cover BOTH edges of the viewport.
    const tileSpanMs = 30_000n;
    const base: Viewport = { start: TS_BUCKET_ORIGIN_MS + 12_345n, end: TS_BUCKET_ORIGIN_MS + 42_345n };

    for (let extraRight = 0n; extraRight <= tileSpanMs * 2n; extraRight += 3_000n) {
      const vp: Viewport = { start: base.start, end: base.end + extraRight };
      const { visible } = tilesForViewport({ viewport: vp, tileSpanMs });
      expect(visible[0]!.startTime).toBeLessThanOrEqual(vp.start);
      expect(visible[visible.length - 1]!.endTime).toBeGreaterThanOrEqual(vp.end);
    }
  });

  // ── MAX_VISIBLE_TILES cap (defense-in-depth against tile storms) ──────────

  it('cap: wide viewport with tiny tileSpanMs returns empty arrays', () => {
    // Simulates the tile storm scenario: 24h viewport at 30s tile resolution → 2880 tiles.
    // tilesForViewport must cap and return empty rather than emitting the storm.
    const wideViewport: Viewport = { start: BASE, end: BASE + 86_400_000n }; // 24 h
    const tinyTileSpanMs = 30_000n; // 30 s → 24h/30s = 2880 tiles
    const { visible, prefetch } = tilesForViewport({ viewport: wideViewport, tileSpanMs: tinyTileSpanMs });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('cap: normal 2–4-tile cases are unaffected', () => {
    // A standard 1h viewport at half-hour tile resolution produces 2 visible tiles — well below cap.
    const { visible } = tilesForViewport({ viewport, tileSpanMs: DEFAULT_TILE_SPAN });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(4);
  });
});

// ─── deriveBucketSMs ─────────────────────────────────────────────────────────

describe('deriveBucketSMs', () => {
  it('returns expected bucket width for a 1h viewport with default 2×500 config', () => {
    const viewport: Viewport = { start: 0n, end: 3_600_000n };
    // 3_600_000ms / (2 * 500) = 3600ms per bucket
    expect(deriveBucketSMs({ viewport })).toBe(3600);
  });

  it('tileSpanMs = deriveBucketSMs × bucketCount (fundamental invariant)', () => {
    const viewport: Viewport = { start: 0n, end: 3_600_000n };
    const bucketSMs = deriveBucketSMs({ viewport }); // 3600ms (3_600_000 / (2*500))
    const expectedTileSpanMs = bucketSMs * TREND_VIEWER_DEFAULTS.bucketCount; // 1_800_000
    // Confirm tilesForViewport emits the expected tile span when given this tileSpanMs.
    const { visible } = tilesForViewport({
      viewport,
      tileSpanMs: BigInt(Math.round(expectedTileSpanMs)),
    });
    expect(Number(visible[0]!.endTime - visible[0]!.startTime)).toBe(expectedTileSpanMs);
  });

  it('returns smaller bucketSMs for a larger bucketCount', () => {
    const viewport: Viewport = { start: 0n, end: 3_600_000n };
    const narrow = deriveBucketSMs({ viewport, bucketCount: 1000 });
    const wide = deriveBucketSMs({ viewport, bucketCount: 250 });
    expect(narrow).toBeLessThan(wide);
  });
});

// ── computeZoomLevelTransition ────────────────────────────────────────────────

describe('computeZoomLevelTransition', () => {
  const ANCHOR = 3_600_000n; // 1 hour anchor span

  it('returns null when ratio is 1.0 (same span, no transition)', () => {
    expect(computeZoomLevelTransition(ANCHOR, ANCHOR)).toBeNull();
  });

  it('returns null when ratio is between 1/1.5 and 1.5 (continuous zoom zone)', () => {
    // ratio ≈ 1.2 — within the safe zone
    const newSpan = BigInt(Math.round(Number(ANCHOR) * 1.2));
    expect(computeZoomLevelTransition(newSpan, ANCHOR)).toBeNull();
  });

  it('returns "out" when newSpan > 1.5× anchorSpan', () => {
    // ratio = 1.6 > 1.5 → zoom-out transition
    const newSpan = BigInt(Math.round(Number(ANCHOR) * 1.6));
    expect(computeZoomLevelTransition(newSpan, ANCHOR)).toBe('out');
  });

  it('returns "in" when newSpan < 1/1.5 of anchorSpan', () => {
    // ratio = 0.6 < 0.667 → zoom-in transition
    const newSpan = BigInt(Math.round(Number(ANCHOR) * 0.6));
    expect(computeZoomLevelTransition(newSpan, ANCHOR)).toBe('in');
  });

  it('returns null for zero anchorSpan (guard against division by zero)', () => {
    expect(computeZoomLevelTransition(ANCHOR, 0n)).toBeNull();
  });

  it('returns null at exactly threshold boundary (strict > required for "out")', () => {
    // ratio = exactly 1.5 → NOT > 1.5 → null
    const newSpan = ANCHOR * 3n / 2n; // exact 1.5× (integer multiply is lossless)
    expect(computeZoomLevelTransition(newSpan, ANCHOR)).toBeNull();
  });

  it('returns "out" one ms past the threshold boundary', () => {
    // ratio = (ANCHOR * 1.5 + 1) / ANCHOR > 1.5 → 'out'
    const newSpan = ANCHOR * 3n / 2n + 1n;
    expect(computeZoomLevelTransition(newSpan, ANCHOR)).toBe('out');
  });

  it('custom threshold=2.0: ratio=1.9 → null; ratio=2.1 → "out"', () => {
    const span19 = BigInt(Math.round(Number(ANCHOR) * 1.9));
    const span21 = BigInt(Math.round(Number(ANCHOR) * 2.1));
    expect(computeZoomLevelTransition(span19, ANCHOR, 2.0)).toBeNull();
    expect(computeZoomLevelTransition(span21, ANCHOR, 2.0)).toBe('out');
  });
});
