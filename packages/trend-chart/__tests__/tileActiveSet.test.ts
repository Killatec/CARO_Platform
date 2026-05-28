import { describe, it, expect } from 'vitest';
import {
  makeActiveTileEntry,
  makeActiveTileEntryFromCache,
  computeCommittedThroughTs,
} from '../src/tileActiveSet.js';
import type { ActiveTileEntry } from '../src/types.js';
import type { TileApiResponse } from '../src/api.js';
import type { CachedEntry } from '../src/tileActiveSet.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HALF_HOUR = 1_800_000n;

function makeEntry(startMs: bigint, endMs: bigint, bucketCount = 500): ActiveTileEntry {
  return { tile: { startTime: startMs, endTime: endMs, bucketCount }, committedThroughTs: null, shape: null, data: null };
}

// ─── makeActiveTileEntry ──────────────────────────────────────────────────────

describe('makeActiveTileEntry', () => {
  const tile = { startTime: 0n, endTime: 3_600_000n, bucketCount: 500 };
  const TAIL_TS = 1_700_000_000_000;

  it('source=raw → shape=raw', () => {
    const res = {
      source: 'raw' as const,
      startTime: 0,
      endTime: 3_600_000,
      committedThroughTs: TAIL_TS,
      series: [],
    } satisfies TileApiResponse;
    const entry = makeActiveTileEntry(tile, res);
    expect(entry.tile).toBe(tile);
    expect(entry.shape).toBe('raw');
    expect(entry.committedThroughTs).toBe(TAIL_TS);
  });

  const aggSources = ['tag_samples', '1s_cagg', '10s_cagg', '1min_cagg', '10min_cagg', 'mixed'] as const;
  for (const source of aggSources) {
    it(`source=${source} → shape=aggregate`, () => {
      const res = {
        source,
        startTime: 0,
        endTime: 3_600_000,
        committedThroughTs: TAIL_TS,
        bucketSMs: 3_600,
        n: 500,
        series: [],
      } satisfies TileApiResponse;
      const entry = makeActiveTileEntry(tile, res);
      expect(entry.shape).toBe('aggregate');
      expect(entry.committedThroughTs).toBe(TAIL_TS);
    });
  }

  it('tile reference is preserved exactly', () => {
    const res = {
      source: '1min_cagg' as const,
      startTime: 0,
      endTime: 3_600_000,
      committedThroughTs: TAIL_TS,
      bucketSMs: 3_600,
      n: 500,
      series: [],
    } satisfies TileApiResponse;
    const entry = makeActiveTileEntry(tile, res);
    expect(entry.tile).toBe(tile);
  });
});

// ─── makeActiveTileEntryFromCache ─────────────────────────────────────────────

describe('makeActiveTileEntryFromCache', () => {
  const tile = { startTime: 0n, endTime: 3_600_000n, bucketCount: 500 };
  const TAIL_TS = 1_700_000_000_000;

  it('source=raw → shape=raw, committedThroughTs from cached entry', () => {
    const cached: CachedEntry = { source: 'raw', committedThroughTs: TAIL_TS, ts: [], valueRaw: [] };
    const entry = makeActiveTileEntryFromCache(tile, cached);
    expect(entry.shape).toBe('raw');
    expect(entry.committedThroughTs).toBe(TAIL_TS);
    expect(entry.tile).toBe(tile);
  });

  const aggSources = ['tag_samples', '1s_cagg', '10s_cagg', '1min_cagg', '10min_cagg', 'mixed'] as const;
  for (const source of aggSources) {
    it(`source=${source} → shape=aggregate`, () => {
      const cached: CachedEntry = { source, committedThroughTs: TAIL_TS, value: [], bucketSMs: 3_600, n: 500 };
      const entry = makeActiveTileEntryFromCache(tile, cached);
      expect(entry.shape).toBe('aggregate');
      expect(entry.committedThroughTs).toBe(TAIL_TS);
    });
  }

  it('missing committedThroughTs in cached entry → null', () => {
    const cached: CachedEntry = { source: '1min_cagg', value: [] };
    const entry = makeActiveTileEntryFromCache(tile, cached);
    expect(entry.committedThroughTs).toBeNull();
  });
});

// ─── computeCommittedThroughTs ────────────────────────────────────────────────────

describe('computeCommittedThroughTs', () => {
  it('all entries null → returns null', () => {
    const entries: ActiveTileEntry[] = [
      makeEntry(0n, HALF_HOUR),
      makeEntry(HALF_HOUR, HALF_HOUR * 2n),
    ];
    expect(computeCommittedThroughTs(entries)).toBeNull();
  });

  it('single non-null entry → returns its value', () => {
    const entry = { ...makeEntry(0n, HALF_HOUR), committedThroughTs: 1_700_000_000_000 };
    expect(computeCommittedThroughTs([entry])).toBe(1_700_000_000_000);
  });

  it('returns max across entries with non-null committedThroughTs', () => {
    const entries: ActiveTileEntry[] = [
      { ...makeEntry(0n, HALF_HOUR),               committedThroughTs: 1_000 },
      { ...makeEntry(HALF_HOUR, HALF_HOUR * 2n),   committedThroughTs: 9_000 },
      { ...makeEntry(HALF_HOUR * 2n, HALF_HOUR * 3n), committedThroughTs: 5_000 },
    ];
    expect(computeCommittedThroughTs(entries)).toBe(9_000);
  });

  it('ignores entries with null committedThroughTs in max computation', () => {
    const entries: ActiveTileEntry[] = [
      { ...makeEntry(0n, HALF_HOUR),             committedThroughTs: null },
      { ...makeEntry(HALF_HOUR, HALF_HOUR * 2n), committedThroughTs: 7_000 },
      { ...makeEntry(HALF_HOUR * 2n, HALF_HOUR * 3n), committedThroughTs: null },
    ];
    expect(computeCommittedThroughTs(entries)).toBe(7_000);
  });

  it('empty array → returns null', () => {
    expect(computeCommittedThroughTs([])).toBeNull();
  });
});
