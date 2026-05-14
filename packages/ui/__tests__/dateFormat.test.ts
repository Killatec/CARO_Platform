import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDate } from '../src/dateFormat.js';

// ── Shared constants ──────────────────────────────────────────────────────────

// 2026-05-02 14:31:48 UTC (used for timezone-stable assertions)
const UTC_MS = Date.UTC(2026, 4, 2, 14, 31, 48); // month 0-indexed: 4 = May
const UTC_BIGINT = BigInt(UTC_MS);

// ── formatDateTime — basic format ────────────────────────────────────────────

describe('formatDateTime — basic format', () => {
  it('formats as dd-MMM-yyyy HH:mm:ss in UTC', () => {
    expect(formatDateTime(UTC_MS, { timezone: 'UTC' })).toBe('02-May-2026 14:31:48');
  });

  it('bigint input produces the same result as number input', () => {
    expect(formatDateTime(UTC_BIGINT, { timezone: 'UTC' })).toBe(
      formatDateTime(UTC_MS, { timezone: 'UTC' }),
    );
  });

  it('Date object input works', () => {
    const d = new Date(UTC_MS);
    expect(formatDateTime(d, { timezone: 'UTC' })).toBe('02-May-2026 14:31:48');
  });

  it('ISO string input works', () => {
    expect(formatDateTime('2026-05-02T14:31:48.000Z', { timezone: 'UTC' })).toBe('02-May-2026 14:31:48');
  });
});

// ── formatDateTime — zero-padding ────────────────────────────────────────────

describe('formatDateTime — zero-padding', () => {
  it('zero-pads day < 10', () => {
    const ms = Date.UTC(2026, 4, 2, 12, 0, 0);
    expect(formatDateTime(ms, { timezone: 'UTC' })).toMatch(/^02-/);
  });

  it('zero-pads hour, minute, second < 10', () => {
    const ms = Date.UTC(2026, 4, 2, 8, 5, 3);
    expect(formatDateTime(ms, { timezone: 'UTC' })).toBe('02-May-2026 08:05:03');
  });

  it('renders midnight as 00:00:00 (not 24:xx or 12:xx)', () => {
    const ms = Date.UTC(2026, 4, 2, 0, 0, 0);
    expect(formatDateTime(ms, { timezone: 'UTC' })).toBe('02-May-2026 00:00:00');
  });
});

// ── formatDateTime — month abbreviations ─────────────────────────────────────

describe('formatDateTime — month abbreviations', () => {
  it('covers all 12 months with English 3-letter abbreviations', () => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let i = 0; i < 12; i++) {
      const ms = Date.UTC(2026, i, 15, 12, 0, 0);
      expect(formatDateTime(ms, { timezone: 'UTC' })).toContain(`-${months[i]}-`);
    }
  });
});

// ── formatDateTime — timezone option ─────────────────────────────────────────

describe('formatDateTime — timezone option', () => {
  it('shifts hour for America/New_York in summer (UTC-4 EDT)', () => {
    // 2026-07-01 12:00:00 UTC → 08:00:00 EDT
    const ms = Date.UTC(2026, 6, 1, 12, 0, 0);
    expect(formatDateTime(ms, { timezone: 'America/New_York' })).toBe('01-Jul-2026 08:00:00');
  });

  it('shifts hour for America/New_York in winter (UTC-5 EST)', () => {
    // 2026-01-01 12:00:00 UTC → 07:00:00 EST
    const ms = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(formatDateTime(ms, { timezone: 'America/New_York' })).toBe('01-Jan-2026 07:00:00');
  });

  it('DST spring-forward: 2026-03-08 07:00 UTC = 03:00 EDT', () => {
    // Spring forward at 2:00 AM EST = 7:00 AM UTC; clocks jump to 3:00 AM EDT.
    const ms = Date.UTC(2026, 2, 8, 7, 0, 0);
    expect(formatDateTime(ms, { timezone: 'America/New_York' })).toBe('08-Mar-2026 03:00:00');
  });

  it('no timezone option uses browser-local time — does not throw', () => {
    expect(() => formatDateTime(UTC_MS)).not.toThrow();
    expect(typeof formatDateTime(UTC_MS)).toBe('string');
  });

  it('invalid timezone string falls back to browser-local without throwing', () => {
    expect(() => formatDateTime(UTC_MS, { timezone: 'Not/AReal_Zone' })).not.toThrow();
    expect(typeof formatDateTime(UTC_MS, { timezone: 'Not/AReal_Zone' })).toBe('string');
  });
});

// ── formatDateTime — fallback for invalid input ───────────────────────────────

describe('formatDateTime — invalid input fallback', () => {
  it('null → default fallback "—"', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('undefined → default fallback "—"', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('empty string → default fallback "—"', () => {
    expect(formatDateTime('')).toBe('—');
  });

  it('invalid date string → default fallback "—"', () => {
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('invalid Date object → default fallback "—"', () => {
    expect(formatDateTime(new Date('invalid'))).toBe('—');
  });

  it('custom fallback option is returned for invalid input', () => {
    expect(formatDateTime(null, { fallback: 'N/A' })).toBe('N/A');
    expect(formatDateTime(undefined, { fallback: 'N/A' })).toBe('N/A');
  });
});

// ── formatDateTime — seconds option ──────────────────────────────────────────

describe('formatDateTime — seconds option', () => {
  it('seconds: true (default) includes HH:mm:ss', () => {
    expect(formatDateTime(UTC_MS, { timezone: 'UTC' })).toMatch(/\d{2}:\d{2}:\d{2}$/);
  });

  it('seconds: false produces dd-MMM-yyyy HH:mm (no seconds)', () => {
    const result = formatDateTime(UTC_MS, { timezone: 'UTC', seconds: false });
    expect(result).toBe('02-May-2026 14:31');
    expect(result).not.toMatch(/:\d{2}:\d{2}$/);
  });
});

// ── formatDate — basic format ────────────────────────────────────────────────

describe('formatDate — basic format', () => {
  it('returns dd-MMM-yyyy with no time component', () => {
    expect(formatDate(UTC_MS, { timezone: 'UTC' })).toBe('02-May-2026');
  });

  it('does not include HH:mm in output', () => {
    expect(formatDate(UTC_MS, { timezone: 'UTC' })).not.toMatch(/\d{2}:\d{2}/);
  });

  it('Date object input works', () => {
    const d = new Date(Date.UTC(2026, 2, 23));
    expect(formatDate(d, { timezone: 'UTC' })).toBe('23-Mar-2026');
  });

  it('ISO string input works', () => {
    expect(formatDate('2026-06-01T00:00:00.000Z', { timezone: 'UTC' })).toBe('01-Jun-2026');
  });
});

// ── formatDate — invalid input fallback ──────────────────────────────────────

describe('formatDate — invalid input fallback', () => {
  it('null → default fallback "—"', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('undefined → default fallback "—"', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('empty string → default fallback "—"', () => {
    expect(formatDate('')).toBe('—');
  });

  it('invalid date string → default fallback "—"', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('custom fallback option is returned for invalid input', () => {
    expect(formatDate(null, { fallback: 'N/A' })).toBe('N/A');
  });
});

// ── Browser-local behavior (tag-registry parity) ──────────────────────────────
// These tests use local-time methods to build expected values — they pass in
// any timezone, matching the behavior of the legacy tag-registry formatDate.ts.

describe('formatDateTime — browser-local behavior (no timezone option)', () => {
  function localExpected(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  it('Date object matches local-time expected string', () => {
    const d = new Date(2026, 2, 23, 14, 7, 42);
    expect(formatDateTime(d)).toBe(localExpected(d));
  });

  it('includes seconds', () => {
    const d = new Date(2026, 0, 1, 0, 0, 7);
    expect(formatDateTime(d)).toMatch(/:\d{2}:\d{2}$/);
  });

  it('zero-pads day < 10', () => {
    const d = new Date(2026, 0, 5, 14, 0, 0);
    expect(formatDateTime(d)).toMatch(/^05-/);
  });

  it('zero-pads hour < 10', () => {
    const d = new Date(2026, 0, 15, 9, 0, 0);
    expect(formatDateTime(d)).toMatch(/ 09:/);
  });
});
