import { describe, it, expect } from 'vitest';
import {
  initBoolValue,
  advanceBoolValue,
  advanceF32Value,
  SINE_PERIOD_MS,
} from '../services/simGenerators.js';

// ── initBoolValue ─────────────────────────────────────────────────────────────

describe('initBoolValue', () => {
  it('boolean tags are initialized to a boolean value on first tick', () => {
    expect(typeof initBoolValue(() => 0.3)).toBe('boolean');
    expect(typeof initBoolValue(() => 0.7)).toBe('boolean');
  });
});

// ── advanceBoolValue ──────────────────────────────────────────────────────────

describe('advanceBoolValue', () => {
  it('boolean tags flip every subsequent tick from their initial value', () => {
    // rng = 0.3 → 0.3 < 0.5 = true
    let v = initBoolValue(() => 0.3);
    const sequence = [v];
    for (let i = 0; i < 4; i++) {
      v = advanceBoolValue(v);
      sequence.push(v);
    }
    expect(sequence).toEqual([true, false, true, false, true]);
  });
});

// ── non-boolean tags ──────────────────────────────────────────────────────────

describe('non-boolean tags', () => {
  it('non-boolean tags are not affected by the bool-toggle logic', () => {
    const { value, simT } = advanceF32Value(0, 100);
    const expected = 50 + 25 * Math.sin((2 * Math.PI * 100) / SINE_PERIOD_MS);
    expect(typeof value).toBe('number');
    expect(value).toBeCloseTo(expected);
    expect(simT).toBe(100);
    // Confirm it is not a boolean flip — value differs from !false and !true
    expect(value).not.toBe(true);
    expect(value).not.toBe(false);
  });
});

// ── phase behavior ────────────────────────────────────────────────────────────

describe('phase behavior', () => {
  it('two boolean tags with the same initial value stay in phase', () => {
    const sameRng = () => 0.3; // both coin-flip to true
    let a = initBoolValue(sameRng);
    let b = initBoolValue(sameRng);
    for (let tick = 0; tick < 5; tick++) {
      expect(a).toBe(b);
      a = advanceBoolValue(a);
      b = advanceBoolValue(b);
    }
  });

  it('two boolean tags with different initial values stay in opposite phase', () => {
    let callCount = 0;
    // First call → 0.3 (true), second call → 0.7 (false)
    const alternatingRng = () => callCount++ % 2 === 0 ? 0.3 : 0.7;
    let a = initBoolValue(alternatingRng); // true
    let b = initBoolValue(alternatingRng); // false
    for (let tick = 0; tick < 5; tick++) {
      expect(a).toBe(!b);
      a = advanceBoolValue(a);
      b = advanceBoolValue(b);
    }
  });
});

// ── randomization spread ──────────────────────────────────────────────────────

describe('randomization', () => {
  it('randomization spreads starting values across many tags', () => {
    let trueCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (initBoolValue()) trueCount++;
    }
    expect(trueCount).toBeGreaterThanOrEqual(400);
    expect(trueCount).toBeLessThanOrEqual(600);
  });
});
