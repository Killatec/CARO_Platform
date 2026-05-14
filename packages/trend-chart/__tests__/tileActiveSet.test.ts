import { describe, it, expect, vi } from 'vitest';
import { pruneAndAdd, MAX_ACTIVE_TILES } from '../src/tileActiveSet.js';
import type { Tile } from '../src/types.js';

function makeTile(startMs: bigint, endMs: bigint, bucketCount = 500): Tile {
  return { startTime: startMs, endTime: endMs, bucketCount };
}

// All tiles are HALF_HOUR wide to match the default geometry used by the hook.
const HALF_HOUR = 1_800_000n;

function makeRange(fromMs: bigint, count: number): Tile[] {
  return Array.from({ length: count }, (_, i) =>
    makeTile(fromMs + BigInt(i) * HALF_HOUR, fromMs + BigInt(i + 1) * HALF_HOUR),
  );
}

describe('pruneAndAdd', () => {
  it('empty active set: returns singleton', () => {
    const newTile = makeTile(0n, HALF_HOUR);
    expect(pruneAndAdd([], newTile)).toEqual([newTile]);
  });

  it('below maxSize: all tiles kept, sorted by startTime', () => {
    const existing = makeRange(HALF_HOUR, 3); // [1h, 1.5h, 2h] in half-hour tiles
    const newTile = makeTile(0n, HALF_HOUR);  // left of extent
    const result = pruneAndAdd(existing, newTile);
    expect(result).toHaveLength(4);
    expect(result[0]!.startTime).toBe(0n);
    expect(result[3]!.startTime).toBe(HALF_HOUR * 3n);
  });

  it('right-end extension at capacity: drops leftmost tile', () => {
    const existing = makeRange(0n, MAX_ACTIVE_TILES); // 8 tiles starting at 0
    const newTile = makeTile(BigInt(MAX_ACTIVE_TILES) * HALF_HOUR, BigInt(MAX_ACTIVE_TILES + 1) * HALF_HOUR);
    const result = pruneAndAdd(existing, newTile);
    expect(result).toHaveLength(MAX_ACTIVE_TILES);
    expect(result[0]!.startTime).toBe(HALF_HOUR); // leftmost dropped
    expect(result[MAX_ACTIVE_TILES - 1]!.startTime).toBe(BigInt(MAX_ACTIVE_TILES) * HALF_HOUR);
  });

  it('left-end extension at capacity: drops rightmost tile', () => {
    const existing = makeRange(HALF_HOUR, MAX_ACTIVE_TILES); // tiles starting at 0.5h
    const newTile = makeTile(0n, HALF_HOUR); // left of extent
    const result = pruneAndAdd(existing, newTile);
    expect(result).toHaveLength(MAX_ACTIVE_TILES);
    expect(result[0]!.startTime).toBe(0n); // new tile is leftmost
    expect(result[MAX_ACTIVE_TILES - 1]!.startTime).toBe(BigInt(MAX_ACTIVE_TILES - 1) * HALF_HOUR); // rightmost dropped
  });

  it('middle gap-fill at capacity: drops leftmost tile, no warn', () => {
    // Build 8 tiles with a gap in the middle (tiles 0-3 and 5-8, skipping 4).
    const left  = makeRange(0n, 4);
    const right = makeRange(5n * HALF_HOUR, 4);
    const existing = [...left, ...right]; // 8 tiles
    expect(existing).toHaveLength(MAX_ACTIVE_TILES);

    const warnSpy = vi.spyOn(console, 'warn');
    const gapTile = makeTile(4n * HALF_HOUR, 5n * HALF_HOUR);
    const result = pruneAndAdd(existing, gapTile);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(MAX_ACTIVE_TILES);
    // leftmost tile dropped (startTime 0), gap tile and right tiles retained
    expect(result[0]!.startTime).toBe(HALF_HOUR); // was index 1
    warnSpy.mockRestore();
  });

  it('exact maxSize match: no pruning', () => {
    const existing = makeRange(0n, MAX_ACTIVE_TILES - 1); // 7 tiles
    const newTile = makeTile(BigInt(MAX_ACTIVE_TILES - 1) * HALF_HOUR, BigInt(MAX_ACTIVE_TILES) * HALF_HOUR);
    const result = pruneAndAdd(existing, newTile);
    expect(result).toHaveLength(MAX_ACTIVE_TILES);
  });
});
