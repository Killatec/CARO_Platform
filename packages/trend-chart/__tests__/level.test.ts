import { describe, it, expect } from 'vitest';
import {
  alignedTilesInRange,
  tilesForViewport,
  deriveBucketSMs,
  computeZoomLevelTransition,
  TREND_VIEWER_DEFAULTS,
  TS_BUCKET_ORIGIN_MS,
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
  const viewport: Viewport = { start: 0n, end: oneHourMs };

  it('default config: 2 visible + 2 prefetch tiles (1 each side)', () => {
    const { visible, prefetch } = tilesForViewport({ viewport });
    expect(visible).toHaveLength(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow);  // 2
    expect(prefetch).toHaveLength(TREND_VIEWER_DEFAULTS.overfetchPerSide * 2); // 2
  });

  it('visible tiles span the epoch-aligned viewport', () => {
    const { visible } = tilesForViewport({ viewport });
    const tileSpan = oneHourMs / BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow); // 1800000n
    expect(visible[0]!.startTime).toBe(0n);
    expect(visible[0]!.endTime).toBe(tileSpan);
    expect(visible[1]!.startTime).toBe(tileSpan);
    expect(visible[1]!.endTime).toBe(tileSpan * 2n);
  });

  it('prefetch[0] is exactly one tile before visible[0]', () => {
    const { visible, prefetch } = tilesForViewport({ viewport });
    const tileSpan = oneHourMs / BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow);
    expect(prefetch[0]!.endTime).toBe(visible[0]!.startTime);
    expect(prefetch[0]!.startTime).toBe(visible[0]!.startTime - tileSpan);
  });

  it('prefetch[1] is exactly one tile after the last visible tile', () => {
    const { visible, prefetch } = tilesForViewport({ viewport });
    const lastVisible = visible[visible.length - 1]!;
    expect(prefetch[prefetch.length - 1]!.startTime).toBe(lastVisible.endTime);
  });

  it('overfetchPerSide=2 produces 4 prefetch tiles (2 each side)', () => {
    const { visible, prefetch } = tilesForViewport({ viewport, overfetchPerSide: 2 });
    expect(visible).toHaveLength(2);
    expect(prefetch).toHaveLength(4);
  });

  it('all returned Tile.startTime and endTime are bigint', () => {
    const { visible, prefetch } = tilesForViewport({ viewport });
    for (const t of [...visible, ...prefetch]) {
      expect(typeof t.startTime).toBe('bigint');
      expect(typeof t.endTime).toBe('bigint');
    }
  });

  it('default bucketCount is 500 on all tiles', () => {
    const { visible, prefetch } = tilesForViewport({ viewport });
    for (const t of [...visible, ...prefetch]) {
      expect(t.bucketCount).toBe(500);
    }
  });

  it('right-anchor: mid-viewport-end snaps to next tile boundary within one tileSpanMs', () => {
    // Place viewport.end 1ms past a tile boundary (relative to TS_BUCKET_ORIGIN_MS).
    // tileSpanMs = 3_600_000n / 2n = 1_800_000n.
    // vp.end = TS_BUCKET_ORIGIN_MS + 5×tileSpanMs + 1ms → lastVisibleEnd = TS_BUCKET_ORIGIN_MS + 6×tileSpanMs; gap = 1_799_999n.
    // firstVisibleStart = TS_BUCKET_ORIGIN_MS + 4×tileSpanMs; slip from vp.start = 1_799_999n.
    const spanMs = 3_600_000n;
    const tileSpanMs = spanMs / BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow); // 1_800_000n
    const vpEnd = TS_BUCKET_ORIGIN_MS + 5n * tileSpanMs + 1n;
    const vp: Viewport = { start: vpEnd - spanMs, end: vpEnd };
    const { visible } = tilesForViewport({ viewport: vp });
    const lastVisibleEnd = visible[visible.length - 1]!.endTime;
    // Right edge: covers viewport.end; gap is sub-tile.
    expect(lastVisibleEnd >= vp.end).toBe(true);
    expect(lastVisibleEnd - vp.end < tileSpanMs).toBe(true);
    // Left edge: at or after viewport.start; slip is sub-tile.
    expect(visible[0]!.startTime >= vp.start).toBe(true);
    expect(visible[0]!.startTime - vp.start < tileSpanMs).toBe(true);
  });

  it('epoch-aligned: 24h viewport', () => {
    const oneDayMs = 86_400_000n;
    const vp: Viewport = { start: oneDayMs, end: oneDayMs * 2n };
    const { visible } = tilesForViewport({ viewport: vp });
    const tileSpan = oneDayMs / 2n;
    expect(visible[0]!.startTime).toBe(oneDayMs);
    expect(visible[0]!.endTime).toBe(oneDayMs + tileSpan);
  });

  it('epoch-aligned: 7d viewport at a realistic 2026 timestamp', () => {
    // 2026-04-27T00:00:00Z — known trigger of the 7d/14d 502 bug.
    // With tile-grid right-anchor: lastVisibleEnd is the first tile boundary ≥ viewport.end;
    // gap < tileSpanMs. Tile boundaries are multiples of bucketSMs from TS_BUCKET_ORIGIN_MS.
    const sevenDaysMs = 7n * 86_400_000n;
    const vp: Viewport = { start: 1_777_507_200_000n, end: 1_777_507_200_000n + sevenDaysMs };
    const tileSpan = sevenDaysMs / 2n;  // 302_400_000n
    const bucketSMs = tileSpan / 500n;  // 604_800n
    const { visible } = tilesForViewport({ viewport: vp });
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
    const { visible, prefetch } = tilesForViewport({ viewport: { start: 0n, end: 0n } });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('returns empty arrays when bucketSMs rounds to 0n (viewport span < bucketCount)', () => {
    // span=400ms → tileSpanMs=200n → bucketSMs=200n/500n=0n → was crashing ceilDiv
    const { visible, prefetch } = tilesForViewport({ viewport: { start: 0n, end: 400n } });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('returns empty arrays at exact bucketCount boundary (span === bucketCount ms → bucketSMs=1n)', () => {
    // span=500ms → tileSpanMs=250n → bucketSMs=250n/500n=0n — still sub-millisecond
    const { visible, prefetch } = tilesForViewport({ viewport: { start: 0n, end: 500n } });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
  });

  it('nowMs omitted: prefetch contains both before and after tiles (existing behaviour)', () => {
    const { prefetch } = tilesForViewport({ viewport });
    expect(prefetch).toHaveLength(2); // 1 before + 1 after
  });

  it('nowMs provided at live edge: after-tile within one tileSpanMs is kept (tailing look-ahead)', () => {
    // viewport ends at oneHourMs; tileSpanMs = 1_800_000n; after-prefetch startTime = oneHourMs.
    // New filter: startTime < nowMs + tileSpanMs → 3_600_000 < 3_600_000 + 1_800_000 → kept.
    // Both before and after prefetch tiles are included.
    const { prefetch } = tilesForViewport({ viewport, nowMs: oneHourMs });
    expect(prefetch).toHaveLength(2);
  });

  it('nowMs provided: after-tile more than one tileSpanMs past nowMs is dropped', () => {
    // after-prefetch startTime = oneHourMs = 3_600_000n; tileSpanMs = 1_800_000n.
    // Set nowMs = halfTileMs (1_800_000n) so nowMs + tileSpanMs = 3_600_000n.
    // Filter: 3_600_000n < 3_600_000n → false → after-tile dropped.
    const halfTileMs = oneHourMs / BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow); // 1_800_000n
    const { prefetch } = tilesForViewport({ viewport, nowMs: halfTileMs });
    expect(prefetch).toHaveLength(1);
    // Only the before-tile remains.
    const { visible } = tilesForViewport({ viewport });
    expect(prefetch[0]!.endTime).toBe(visible[0]!.startTime);
  });

  it('nowMs provided but after-tile is in the past: both tiles kept', () => {
    // Viewport is entirely in the past; nowMs is far future.
    // Both prefetch tiles start well before nowMs + tileSpanMs, so neither is filtered.
    const pastViewport: Viewport = { start: 0n, end: oneHourMs };
    const farFutureNow = oneHourMs * 1_000_000n;
    const { prefetch } = tilesForViewport({ viewport: pastViewport, nowMs: farFutureNow });
    expect(prefetch).toHaveLength(2);
  });

  it('regression — tailing mode: after-prefetch included when startTime equals nowMs', () => {
    // Under tile-grid alignment, the after-prefetch startTime = lastVisibleEnd which may
    // equal nowMs exactly (viewport.end on tile boundary). The new filter keeps it so
    // performSwap does not evict what ensureCovered just fetched on the next tick.
    const tileSpanMs = oneHourMs / BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow);
    // Epoch-aligned viewport: lastVisibleEnd = oneHourMs; after-prefetch startTime = oneHourMs.
    const { prefetch } = tilesForViewport({ viewport, nowMs: oneHourMs });
    const afterTile = prefetch.find(t => t.startTime >= oneHourMs);
    expect(afterTile).toBeDefined();
    expect(afterTile!.startTime).toBe(oneHourMs);
    expect(afterTile!.endTime).toBe(oneHourMs + tileSpanMs);
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

    const { visible, prefetch } = tilesForViewport({ viewport: vp });

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

    const { visible, prefetch } = tilesForViewport({ viewport: vp });

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

  it('15m/1h/4h/24h presets: bucket-aligned + live-edge covered (unaffected by tile-grid right-anchor)', () => {
    // For these spans viewport.end falls exactly on a tile boundary at this origin
    // (the 10,957-day offset divides evenly), so lastVisibleEnd === viewport.end and gap = 0.
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
      const { visible } = tilesForViewport({ viewport: vp });
      const lastVisibleEnd = visible[visible.length - 1]!.endTime;
      // Right edge covers viewport.end; gap is zero for these exact-divisor presets.
      expect(lastVisibleEnd >= vp.end).toBe(true);
      expect(lastVisibleEnd - vp.end < tileSpan).toBe(true);
      for (const tile of visible) {
        expect((tile.startTime - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
        expect((tile.endTime   - TS_BUCKET_ORIGIN_MS) % bucketSMs).toBe(0n);
      }
      void label; // suppress unused-variable lint
    }
  });

  it('tile-grid stability: viewport.end within same tile boundary window returns identical tiles', () => {
    // Tiles must be stable across viewport.end advances that stay within the same tile
    // boundary window — this is the property that eliminates cache thrashing in live mode.
    const spanMs = 3_600_000n; // 1h preset
    const tileSpanMs = spanMs / BigInt(TREND_VIEWER_DEFAULTS.visibleTilesPerWindow); // 1_800_000n
    // Place base.end 1ms past a tile boundary so lastVisibleEnd = next tile boundary.
    const baseEnd = TS_BUCKET_ORIGIN_MS + 5n * tileSpanMs + 1n;
    const base: Viewport = { start: baseEnd - spanMs, end: baseEnd };
    // Advance by (tileSpanMs - 2): advanced.end is still in the same tile window.
    const delta = tileSpanMs - 2n;
    const advanced: Viewport = { start: baseEnd - spanMs + delta, end: baseEnd + delta };

    const { visible: baseVis, prefetch: basePre } = tilesForViewport({ viewport: base });
    const { visible: advVis, prefetch: advPre } = tilesForViewport({ viewport: advanced });

    expect(advVis).toEqual(baseVis);
    expect(advPre).toEqual(basePre);
  });
});

// ─── deriveBucketSMs ─────────────────────────────────────────────────────────

describe('deriveBucketSMs', () => {
  it('returns expected bucket width for a 1h viewport with default 2×500 config', () => {
    const viewport: Viewport = { start: 0n, end: 3_600_000n };
    // 3_600_000ms / (2 * 500) = 3600ms per bucket
    expect(deriveBucketSMs({ viewport })).toBe(3600);
  });

  it('matches tileSpanMs / bucketCount derived inside tilesForViewport', () => {
    const viewport: Viewport = { start: 0n, end: 3_600_000n };
    const { visible } = tilesForViewport({ viewport });
    const tileSpanMs = Number(visible[0]!.endTime - visible[0]!.startTime);
    const expectedBucketSMs = tileSpanMs / TREND_VIEWER_DEFAULTS.bucketCount;
    expect(deriveBucketSMs({ viewport })).toBeCloseTo(expectedBucketSMs, 6);
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
