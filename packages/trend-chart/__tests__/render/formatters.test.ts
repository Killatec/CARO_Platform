import { describe, it, expect } from 'vitest';
import { formatBucketS } from '../../src/render/formatBucketS.js';
import { formatSpanMs } from '../../src/render/formatSpanMs.js';
import { formatValue } from '../../src/render/formatValue.js';
import { formatTickLabel } from '../../src/render/formatTickLabel.js';

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

// ── formatTickLabel ───────────────────────────────────────────────────────────

describe('formatTickLabel', () => {
  // 2023-11-14T22:13:20.000Z — a non-round timestamp to stress the formatter.
  const TS_MS = 1_700_000_000_000;

  it('incrSec=30 (second level) → HH:mm:ss', () => {
    expect(formatTickLabel(TS_MS, 'UTC', 30)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('incrSec=600 (minute level) → HH:mm', () => {
    expect(formatTickLabel(TS_MS, 'UTC', 600)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('incrSec=3600 (hour level), first tick → dd-mmm HH:mm', () => {
    const result = formatTickLabel(TS_MS, 'UTC', 3600);
    // prevTsMs undefined → first tick → date prefix shown: "14-Nov 22:13"
    expect(result).toMatch(/^\d{2}-[A-Z][a-z]{2} \d{2}:\d{2}$/);
  });

  it('incrSec=3600, same day as previous → HH:mm only', () => {
    const prevMs = TS_MS - 3_600_000; // 1 hour earlier, same calendar day in UTC
    const result = formatTickLabel(TS_MS, 'UTC', 3600, prevMs);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('incrSec=3600, tick crosses midnight → dd-mmm HH:mm', () => {
    // 2023-11-14T22:00:00Z prev; 2023-11-15T00:00:00Z current → day boundary
    const prev = Date.UTC(2023, 10, 14, 22, 0, 0);
    const curr = Date.UTC(2023, 10, 15, 0, 0, 0);
    const result = formatTickLabel(curr, 'UTC', 3600, prev);
    expect(result).toMatch(/^\d{2}-[A-Z][a-z]{2} \d{2}:\d{2}$/);
    expect(result).toContain('15-Nov');
  });

  it('incrSec=86400 (day level) → dd-mmm', () => {
    expect(formatTickLabel(TS_MS, 'UTC', 86400)).toMatch(/^\d{2}-[A-Z][a-z]{2}$/);
    expect(formatTickLabel(TS_MS, 'UTC', 86400)).toContain('14-Nov');
  });

  it('incrSec=604800 (day level, within month range) → dd-mmm', () => {
    expect(formatTickLabel(TS_MS, 'UTC', 604800)).toMatch(/^\d{2}-[A-Z][a-z]{2}$/);
  });

  it('incrSec=2592000 (month level) → mmm-yyyy', () => {
    const result = formatTickLabel(TS_MS, 'UTC', 2_592_000);
    expect(result).toMatch(/^[A-Z][a-z]{2}-\d{4}$/);
    expect(result).toContain('Nov-2023');
  });

  it('incrSec=31536000 (year level) → yyyy', () => {
    const result = formatTickLabel(TS_MS, 'UTC', 31_536_000);
    expect(result).toMatch(/^\d{4}$/);
    expect(result).toBe('2023');
  });

  it('timezone shifts the displayed hour (minute level)', () => {
    const utc = formatTickLabel(TS_MS, 'UTC', 600);
    const nyc = formatTickLabel(TS_MS, 'America/New_York', 600);
    expect(utc).not.toBe(nyc);
  });

  it('undefined timezone does not throw', () => {
    expect(() => formatTickLabel(TS_MS, undefined, 600)).not.toThrow();
  });
});

// ── formatSpanMs ──────────────────────────────────────────────────────────────

describe('formatSpanMs', () => {
  // Preset spans
  it('900_000n ms (15 min) → "15 min"', () => {
    expect(formatSpanMs(900_000n)).toBe('15 min');
  });

  it('3_600_000n ms (1 h) → "1 h"', () => {
    expect(formatSpanMs(3_600_000n)).toBe('1 h');
  });

  it('14_400_000n ms (4 h) → "4 h"', () => {
    expect(formatSpanMs(14_400_000n)).toBe('4 h');
  });

  it('86_400_000n ms (24 h) → "1 d"', () => {
    expect(formatSpanMs(86_400_000n)).toBe('1 d');
  });

  it('604_800_000n ms (7 d) → "7 d"', () => {
    expect(formatSpanMs(604_800_000n)).toBe('7 d');
  });

  it('1_209_600_000n ms (14 d) → "14 d"', () => {
    expect(formatSpanMs(1_209_600_000n)).toBe('14 d');
  });

  // Fractional values (zoom-produced spans)
  it('16_400n ms (16.4 s) → "16.4 s"', () => {
    expect(formatSpanMs(16_400n)).toBe('16.4 s');
  });

  it('216_000_000n ms (2.5 d) → "2.5 d"', () => {
    expect(formatSpanMs(216_000_000n)).toBe('2.5 d');
  });

  it('5_400_000n ms (1.5 h) → "1.5 h"', () => {
    expect(formatSpanMs(5_400_000n)).toBe('1.5 h');
  });

  // Boundary: exactly at 60s threshold
  it('60_000n ms (60 s) → "1 min"', () => {
    expect(formatSpanMs(60_000n)).toBe('1 min');
  });

  // Boundary: exactly at 1h threshold
  it('3_600_000n ms (3600 s) → "1 h" not "60 min"', () => {
    expect(formatSpanMs(3_600_000n)).toBe('1 h');
  });

  // Boundary: exactly at 24h threshold
  it('86_400_000n ms (86400 s) → "1 d" not hours', () => {
    expect(formatSpanMs(86_400_000n)).toBe('1 d');
  });

  // Sub-second
  it('500n ms (0.5 s) → "0.5 s"', () => {
    expect(formatSpanMs(500n)).toBe('0.5 s');
  });

  // Trailing-zero stripping (the + trick)
  it('no trailing zeros: 3_600_000n → "1 h" not "1.00 h"', () => {
    expect(formatSpanMs(3_600_000n)).not.toContain('.00');
  });

  it('no trailing zeros: 1_209_600_000n → "14 d" not "14.00 d"', () => {
    expect(formatSpanMs(1_209_600_000n)).not.toContain('.00');
  });
});
