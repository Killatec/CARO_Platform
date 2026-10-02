// simGenerators.ts — Pure tag-value generators used by simulatorService.
// Extracted here so tests can verify generation logic without importing the
// full service module (which carries MQTT and DB imports).

export const SINE_PERIOD_MS = 30_000;

/** Initial value for a boolean tag: coin flip at init time. */
export function initBoolValue(rng: () => number = Math.random): boolean {
  return rng() < 0.5;
}

/** Advance a boolean tag: flip on every publish tick. */
export function advanceBoolValue(current: boolean): boolean {
  return !current;
}

/** Advance an f32 tag along the sine wave. Returns new value and updated simT. */
export function advanceF32Value(simT: number, deltaMs: number): { value: number; simT: number } {
  const newT = simT + deltaMs;
  return { value: 50 + 25 * Math.sin((2 * Math.PI * newT) / SINE_PERIOD_MS), simT: newT };
}

export const I16_RANGE = { min: -32768, max: 32767 } as const;
export const I32_RANGE = { min: -2147483648, max: 2147483647 } as const;

/** Advance an integer tag (i16 / i32) along the sine wave, rounded and clamped to `range`. */
export function advanceIntValue(
  simT: number,
  deltaMs: number,
  range: { min: number; max: number },
): { value: number; simT: number } {
  const newT = simT + deltaMs;
  const raw = 50 + 25 * Math.sin((2 * Math.PI * newT) / SINE_PERIOD_MS);
  return { value: Math.max(range.min, Math.min(range.max, Math.round(raw))), simT: newT };
}
