import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../src/dateUtils.js';

describe('formatDateTime', () => {
  // 2026-05-02 14:31:48 UTC
  const EPOCH_MS = BigInt(Date.UTC(2026, 4, 2, 14, 31, 48)); // month is 0-indexed, 4 = May

  it('formats as dd-mmm-yyyy HH:mm:ss', () => {
    expect(formatDateTime(EPOCH_MS, 'UTC')).toBe('02-May-2026 14:31:48');
  });

  it('accepts number input as well as bigint', () => {
    expect(formatDateTime(Number(EPOCH_MS), 'UTC')).toBe('02-May-2026 14:31:48');
  });

  it('zero-pads day < 10', () => {
    const ms = BigInt(Date.UTC(2026, 4, 2, 12, 0, 0)); // day = 2
    expect(formatDateTime(ms, 'UTC')).toMatch(/^02-/);
  });

  it('zero-pads hour, minute, second < 10', () => {
    const ms = BigInt(Date.UTC(2026, 4, 2, 8, 5, 3));
    expect(formatDateTime(ms, 'UTC')).toBe('02-May-2026 08:05:03');
  });

  it('renders midnight as 00:00:00, not 24:xx or 12:xx', () => {
    const ms = BigInt(Date.UTC(2026, 4, 2, 0, 0, 0));
    expect(formatDateTime(ms, 'UTC')).toBe('02-May-2026 00:00:00');
  });

  it('shifts hour correctly for America/New_York in summer (UTC-4 EDT)', () => {
    // 2026-07-01 12:00:00 UTC → 08:00:00 EDT
    const ms = BigInt(Date.UTC(2026, 6, 1, 12, 0, 0));
    expect(formatDateTime(ms, 'America/New_York')).toBe('01-Jul-2026 08:00:00');
  });

  it('shifts hour correctly for America/New_York in winter (UTC-5 EST)', () => {
    // 2026-01-01 12:00:00 UTC → 07:00:00 EST
    const ms = BigInt(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(formatDateTime(ms, 'America/New_York')).toBe('01-Jan-2026 07:00:00');
  });

  it('DST spring-forward: 2026-03-08 07:00 UTC = 03:00 EDT (clocks skipped 02:00→03:00)', () => {
    // In America/New_York, spring forward happens at 2:00 AM EST = 7:00 AM UTC.
    // At that moment the clock jumps to 3:00 AM EDT.
    const ms = BigInt(Date.UTC(2026, 2, 8, 7, 0, 0));
    expect(formatDateTime(ms, 'America/New_York')).toBe('08-Mar-2026 03:00:00');
  });

  it('uses English 3-letter capitalized month abbreviations', () => {
    const jan = BigInt(Date.UTC(2026, 0, 15, 12, 0, 0));
    const dec = BigInt(Date.UTC(2026, 11, 15, 12, 0, 0));
    expect(formatDateTime(jan, 'UTC')).toMatch(/^15-Jan-/);
    expect(formatDateTime(dec, 'UTC')).toMatch(/^15-Dec-/);
  });

  it('covers all 12 months with 3-letter abbreviations', () => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    months.forEach((abbr, i) => {
      const ms = BigInt(Date.UTC(2026, i, 1, 12, 0, 0));
      expect(formatDateTime(ms, 'UTC')).toContain(`-${abbr}-`);
    });
  });

  it('falls back gracefully on invalid timezone — does not throw', () => {
    expect(() => formatDateTime(EPOCH_MS, 'Not/AReal_Zone')).not.toThrow();
    expect(typeof formatDateTime(EPOCH_MS, 'Not/AReal_Zone')).toBe('string');
  });

  it('works without timezone argument', () => {
    expect(() => formatDateTime(EPOCH_MS)).not.toThrow();
    expect(typeof formatDateTime(EPOCH_MS)).toBe('string');
  });
});
