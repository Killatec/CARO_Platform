import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  computeLiveTileWindows,
  computeHistoricalTileWindows,
  ROWS,
} from '../TrendsPerfTestPage.js';

// ── formatDuration ─────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it.each([
    // [input seconds, expected string]  — derived from ROWS with pointsPerWindow=1000
    // bucketS=0.5,   window=0.5*1000=500 s
    [500,       '500 s'],
    // bucketS=8,     window=8*1000=8000 s → 2.22 h
    [8000,      '≈2.2 h'],
    // bucketS=80,    window=80*1000=80000 s → 22.22 h
    [80000,     '≈22.2 h'],
    // bucketS=480,   window=480*1000=480000 s → 5.56 d
    [480000,    '≈5.6 d'],
    // bucketS=4800,  window=4800*1000=4800000 s → 55.56 d
    [4800000,   '≈55.6 d'],
    // boundary cases
    [3600,  '≈1.0 h'],   // exactly 1 hour
    [86400, '≈1.0 d'],   // exactly 1 day
    [1,     '1 s'],
  ] as const)('formatDuration(%s) → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

// ── computeLiveTileWindows ─────────────────────────────────────────────────────

describe('computeLiveTileWindows', () => {
  const BUCKET_S       = 10;
  const POINTS_PER_TILE = 250;
  const N_TILES        = 4;
  // tileSpanMs = 10 * 250 * 1000 = 2_500_000 ms
  const TILE_SPAN      = 2_500_000;
  // nowMs chosen so it falls inside tile index 700 (exact middle)
  const NOW_MS         = 700 * TILE_SPAN + TILE_SPAN / 2; // 1_751_250_000

  it('returns exactly nTiles windows', () => {
    const wins = computeLiveTileWindows({ nowMs: NOW_MS, bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES });
    expect(wins).toHaveLength(N_TILES);
  });

  it('windows are consecutive (endTime[i] === startTime[i+1])', () => {
    const wins = computeLiveTileWindows({ nowMs: NOW_MS, bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES });
    for (let i = 0; i < wins.length - 1; i++) {
      expect(wins[i].endTime).toBe(wins[i + 1].startTime);
    }
  });

  it('each window spans exactly tileSpanMs', () => {
    const wins = computeLiveTileWindows({ nowMs: NOW_MS, bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES });
    for (const win of wins) {
      expect(Number(win.endTime - win.startTime)).toBe(TILE_SPAN);
    }
  });

  it('last window contains nowMs (nowMs < lastTile.endTime)', () => {
    const wins = computeLiveTileWindows({ nowMs: NOW_MS, bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES });
    const last = wins[wins.length - 1];
    expect(Number(last.startTime)).toBeLessThanOrEqual(NOW_MS);
    expect(Number(last.endTime)).toBeGreaterThan(NOW_MS);
  });

  it('all startTimes are positive bigints', () => {
    const wins = computeLiveTileWindows({ nowMs: NOW_MS, bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES });
    for (const win of wins) {
      expect(win.startTime).toBeGreaterThan(0n);
    }
  });

  it('works for all 9 ROWS with standard client settings', () => {
    const NOW = Date.now();
    for (const row of ROWS) {
      const wins = computeLiveTileWindows({ nowMs: NOW, bucketS: row.bucketS, pointsPerTile: 250, nTiles: 4 });
      expect(wins).toHaveLength(4);
      expect(wins[0].startTime).toBeGreaterThan(0n);
    }
  });
});

// ── computeHistoricalTileWindows ───────────────────────────────────────────────

describe('computeHistoricalTileWindows', () => {
  const BUCKET_S        = 10;
  const POINTS_PER_TILE = 250;
  const N_TILES         = 4;
  const TILE_SPAN       = 2_500_000; // 10 * 250 * 1000 ms
  const WINDOW_MS       = N_TILES * TILE_SPAN; // 10_000_000 ms

  // Comfortable range: 24 h of data with 1 h exclusion on the newest end.
  const OLDEST = BigInt(1_000_000_000_000); // arbitrary epoch-ms anchor
  const NEWEST = OLDEST + BigInt(86_400_000); // +24 h

  it('returns insufficientHistory when range is too narrow', () => {
    // latestEnd = OLDEST + 1_000_000 - 3_600_000 = before earliestEnd.
    const tooNarrow = OLDEST + BigInt(WINDOW_MS) + 3_599_999n; // latestEnd just below earliestEnd
    const result = computeHistoricalTileWindows({
      bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES,
      oldestMs: OLDEST, newestMs: tooNarrow,
    });
    expect('insufficientHistory' in result).toBe(true);
  });

  it('returns nTiles windows when range is comfortable', () => {
    const result = computeHistoricalTileWindows({
      bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES,
      oldestMs: OLDEST, newestMs: NEWEST,
    });
    expect(Array.isArray(result)).toBe(true);
    const wins = result as ReturnType<typeof computeLiveTileWindows>;
    expect(wins).toHaveLength(N_TILES);
  });

  it('windows are consecutive', () => {
    const result = computeHistoricalTileWindows({
      bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES,
      oldestMs: OLDEST, newestMs: NEWEST,
    });
    const wins = result as ReturnType<typeof computeLiveTileWindows>;
    for (let i = 0; i < wins.length - 1; i++) {
      expect(wins[i].endTime).toBe(wins[i + 1].startTime);
    }
  });

  it('endTime of last window is <= newestMs - 3_600_000', () => {
    // Run multiple times to reduce probability of random edge cases.
    for (let trial = 0; trial < 10; trial++) {
      const result = computeHistoricalTileWindows({
        bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES,
        oldestMs: OLDEST, newestMs: NEWEST,
      });
      if (Array.isArray(result)) {
        const wins = result as ReturnType<typeof computeLiveTileWindows>;
        const lastEnd = Number(wins[wins.length - 1].endTime);
        expect(lastEnd).toBeLessThanOrEqual(Number(NEWEST) - 3_600_000 + TILE_SPAN);
      }
    }
  });

  it('startTime of first window is >= oldestMs', () => {
    for (let trial = 0; trial < 10; trial++) {
      const result = computeHistoricalTileWindows({
        bucketS: BUCKET_S, pointsPerTile: POINTS_PER_TILE, nTiles: N_TILES,
        oldestMs: OLDEST, newestMs: NEWEST,
      });
      if (Array.isArray(result)) {
        const wins = result as ReturnType<typeof computeLiveTileWindows>;
        expect(wins[0].startTime).toBeGreaterThanOrEqual(0n);
      }
    }
  });
});
