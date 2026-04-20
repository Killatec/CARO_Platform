import { describe, it, expect } from 'vitest';
import { packedBit, setPackedBit } from '../bitPacking.js';

describe('packedBit + setPackedBit round-trip', () => {
  it.each([0, 7, 15, 16, 31, 47])(
    'set then read bit %i returns true',
    (i) => {
      const words: number[] = [];
      setPackedBit(i, words, true);
      expect(packedBit(i, words)).toBe(true);
    },
  );

  it('unset bits return false', () => {
    const words: number[] = [0, 0, 0];
    expect(packedBit(0, words)).toBe(false);
    expect(packedBit(15, words)).toBe(false);
    expect(packedBit(16, words)).toBe(false);
    expect(packedBit(31, words)).toBe(false);
  });

  it('set then clear a bit returns false', () => {
    const words: number[] = [];
    setPackedBit(5, words, true);
    expect(packedBit(5, words)).toBe(true);
    setPackedBit(5, words, false);
    expect(packedBit(5, words)).toBe(false);
  });

  it('reading past the end of the array returns false', () => {
    const words: number[] = [0xFFFF];  // only word 0 present
    expect(packedBit(16, words)).toBe(false);
    expect(packedBit(31, words)).toBe(false);
    expect(packedBit(47, words)).toBe(false);
  });

  it('setting a bit does not disturb adjacent bits in the same word', () => {
    const words: number[] = [];
    setPackedBit(0, words, true);
    setPackedBit(2, words, true);
    expect(packedBit(0, words)).toBe(true);
    expect(packedBit(1, words)).toBe(false);
    expect(packedBit(2, words)).toBe(true);
    expect(packedBit(3, words)).toBe(false);
  });

  it('bits in word 0 (0–15) and word 1 (16–31) are independent', () => {
    const words: number[] = [];
    setPackedBit(15, words, true);
    setPackedBit(16, words, true);
    expect(packedBit(14, words)).toBe(false);
    expect(packedBit(15, words)).toBe(true);
    expect(packedBit(16, words)).toBe(true);
    expect(packedBit(17, words)).toBe(false);
  });
});

describe('packedBit signed-int handling', () => {
  it('word value -1 (all bits set as signed int32) reads every bit 0..15 as true', () => {
    const words = [-1];  // proto int32 with bit 15 set arrives as negative in JS
    for (let i = 0; i < 16; i++) {
      expect(packedBit(i, words)).toBe(true);
    }
  });

  it('word value -1 does not bleed into bits 16+ (separate word)', () => {
    const words = [-1];  // only word 0
    expect(packedBit(16, words)).toBe(false);
  });
});
