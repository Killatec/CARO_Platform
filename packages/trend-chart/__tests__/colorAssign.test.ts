import { describe, it, expect } from 'vitest';
import { colorAssign, PALETTE, PALETTE_SIZE } from '../src/colorAssign.js';

describe('colorAssign', () => {
  it('tagId=0 returns PALETTE[0]', () => {
    expect(colorAssign(0)).toBe(PALETTE[0]);
  });

  it('tagId=PALETTE_SIZE (20) cycles back to PALETTE[0]', () => {
    expect(colorAssign(PALETTE_SIZE)).toBe(PALETTE[0]);
  });

  it('tagId=PALETTE_SIZE+1 cycles to PALETTE[1]', () => {
    expect(colorAssign(PALETTE_SIZE + 1)).toBe(PALETTE[1]);
  });

  it('deterministic: same tagId returns same color across calls', () => {
    for (let id = 0; id < 50; id++) {
      expect(colorAssign(id)).toBe(colorAssign(id));
    }
  });

  it('negative tagId clamps safely (no NaN, no undefined)', () => {
    const color = colorAssign(-1);
    expect(typeof color).toBe('string');
    expect(color.length).toBeGreaterThan(0);
    // -1 mod 20 via double-modulo → PALETTE[19]
    expect(color).toBe(PALETTE[PALETTE_SIZE - 1]);
  });

  it('negative tagId -PALETTE_SIZE maps to PALETTE[0]', () => {
    expect(colorAssign(-PALETTE_SIZE)).toBe(PALETTE[0]);
  });

  it('all returned colors are 7-char hex strings starting with #', () => {
    for (let id = 0; id < PALETTE_SIZE; id++) {
      const color = colorAssign(id);
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('PALETTE_SIZE is 20', () => {
    expect(PALETTE_SIZE).toBe(20);
    expect(PALETTE.length).toBe(20);
  });
});
