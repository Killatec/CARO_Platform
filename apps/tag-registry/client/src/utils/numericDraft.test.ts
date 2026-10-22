import { describe, it, expect } from 'vitest';
import { parseNumericDraft } from './numericDraft.js';

describe('parseNumericDraft', () => {
  it('returns complete numbers, including negatives and decimals', () => {
    expect(parseNumericDraft('42')).toBe(42);
    expect(parseNumericDraft('-5')).toBe(-5);
    expect(parseNumericDraft('-32768')).toBe(-32768);
    expect(parseNumericDraft('0.5')).toBe(0.5);
    expect(parseNumericDraft('-.5')).toBe(-0.5);
    expect(parseNumericDraft('1e3')).toBe(1000);
    expect(parseNumericDraft('0')).toBe(0);
  });

  it('returns null for partial text, so nothing is committed while typing', () => {
    expect(parseNumericDraft('')).toBeNull();
    expect(parseNumericDraft('   ')).toBeNull();
    expect(parseNumericDraft('-')).toBeNull();
    expect(parseNumericDraft('1e')).toBeNull();
    expect(parseNumericDraft('.')).toBeNull();
  });

  it('rejects text that is not a whole number', () => {
    expect(parseNumericDraft('5abc')).toBeNull();
    expect(parseNumericDraft('Infinity')).toBeNull();
    expect(parseNumericDraft('NaN')).toBeNull();
  });
});
