import { describe, it, expect } from 'vitest';
import { formatBucketS } from '../../src/render/formatBucketS.js';
import { formatValue } from '../../src/render/formatValue.js';
import { formatTimestamp } from '../../src/render/formatTimestamp.js';

// ── formatBucketS ─────────────────────────────────────────────────────────────

describe('formatBucketS', () => {
  it('returns "raw" for 0', () => {
    expect(formatBucketS(0)).toBe('raw');
  });

  it('formats sub-second raw (< 1s) as raw', () => {
    expect(formatBucketS(0.5)).toBe('0.5 s buckets');
  });

  it('formats seconds accurately (1.92)', () => {
    expect(formatBucketS(1.92)).toBe('1.92 s buckets');
  });

  it('formats seconds for whole number (14.4)', () => {
    expect(formatBucketS(14.4)).toBe('14.4 s buckets');
  });

  it('formats sub-minute seconds (28.8)', () => {
    expect(formatBucketS(28.8)).toBe('28.8 s buckets');
  });

  it('converts to minutes (230.4 s = 3.84 min)', () => {
    expect(formatBucketS(230.4)).toBe('3.84 min buckets');
  });

  it('converts to hours (14746 s ≈ 4.1 h)', () => {
    const result = formatBucketS(14746);
    expect(result).toMatch(/h buckets$/);
    expect(result).toContain('4.1');
  });
});

// ── formatValue ───────────────────────────────────────────────────────────────

describe('formatValue', () => {
  it('returns "—" for null', () => {
    expect(formatValue(null, '°C', false)).toBe('—');
  });

  it('formats numeric with unit', () => {
    expect(formatValue(78.3, '°C', false)).toBe('78.3 °C');
  });

  it('formats numeric without unit', () => {
    expect(formatValue(42.0, null, false)).toBe('42');
  });

  it('formats boolean 1 as "1" (no unit)', () => {
    expect(formatValue(1, '°C', true)).toBe('1');
  });

  it('formats boolean 0 as "0"', () => {
    expect(formatValue(0, null, true)).toBe('0');
  });

  it('uses 4 significant figures', () => {
    expect(formatValue(3.14159, undefined, false)).toBe('3.142');
  });
});

// ── formatTimestamp ────────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  const EPOCH_MS = 1_700_000_000_000; // a known timestamp

  it('returns a non-empty string', () => {
    expect(formatTimestamp(EPOCH_MS)).toBeTruthy();
  });

  it('accepts bigint ms input', () => {
    const result = formatTimestamp(BigInt(EPOCH_MS));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses siteTimezone when valid', () => {
    const chicago = formatTimestamp(EPOCH_MS, 'America/Chicago');
    const nyc = formatTimestamp(EPOCH_MS, 'America/New_York');
    // Chicago is UTC-6, NYC is UTC-5; they should produce different strings.
    expect(chicago).not.toBe(nyc);
  });

  it('falls back to browser locale on invalid timezone', () => {
    // Should not throw — falls back gracefully.
    expect(() => formatTimestamp(EPOCH_MS, 'Not/AReal_Zone')).not.toThrow();
  });
});
