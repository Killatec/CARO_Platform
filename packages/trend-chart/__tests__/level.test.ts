import { describe, it, expect } from 'vitest';
import {
  alignedTilesInRange,
  tilesForViewport,
  deriveBucketSMs,
  TREND_VIEWER_DEFAULTS,
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

  it('epoch-aligns the start when rangeStart is not aligned to tile span', () => {
    // rangeStart = 500ms, span = 1000ms → epoch-aligned start = 0ms
    const tiles = alignedTilesInRange({ rangeStart: 500n, rangeEnd: 1500n, bucketCount: 500 });
    // tileSpanMs = 1500n - 500n = 1000n; alignedStart = 500n / 1000n * 1000n = 0n
    expect(tiles[0]!.startTime).toBe(0n);
    expect(tiles[0]!.endTime).toBe(1000n);
    // Second tile covers 1000n → 2000n (past rangeEnd, but rangeEnd=1500 is covered)
    expect(tiles[tiles.length - 1]!.endTime >= 1500n).toBe(true);
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

  it('epoch-aligned: viewport snapping produces consistent results for 1h window', () => {
    // Viewport starting mid-tile should still produce epoch-aligned tiles.
    const vp: Viewport = { start: 1_800_001n, end: 1_800_001n + 3_600_000n };
    const { visible } = tilesForViewport({ viewport: vp });
    const tileSpan = 3_600_000n / 2n; // 1800000n
    // firstVisibleStart = floor(1_800_001n / 1_800_000n) * 1_800_000n = 1_800_000n
    expect(visible[0]!.startTime).toBe(1_800_000n);
  });

  it('epoch-aligned: 24h viewport', () => {
    const oneDayMs = 86_400_000n;
    const vp: Viewport = { start: oneDayMs, end: oneDayMs * 2n };
    const { visible } = tilesForViewport({ viewport: vp });
    const tileSpan = oneDayMs / 2n;
    expect(visible[0]!.startTime).toBe(oneDayMs);
    expect(visible[0]!.endTime).toBe(oneDayMs + tileSpan);
  });

  it('epoch-aligned: 7d viewport', () => {
    const sevenDaysMs = 7n * 86_400_000n;
    const vp: Viewport = { start: 0n, end: sevenDaysMs };
    const { visible } = tilesForViewport({ viewport: vp });
    const tileSpan = sevenDaysMs / 2n;
    expect(visible[0]!.startTime).toBe(0n);
    expect(visible[1]!.startTime).toBe(tileSpan);
  });

  it('returns empty arrays for zero-span viewport', () => {
    const { visible, prefetch } = tilesForViewport({ viewport: { start: 0n, end: 0n } });
    expect(visible).toHaveLength(0);
    expect(prefetch).toHaveLength(0);
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
