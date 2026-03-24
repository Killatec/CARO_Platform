import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDate } from '../src/utils/formatDate.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a local Date and derive the expected string using the same local-time
// methods that formatDateTime/formatDate use — this makes tests timezone-safe.
function expectedDateTime(d) {
  const pad = n => String(n).padStart(2, '0');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function expectedDate(d) {
  const pad = n => String(n).padStart(2, '0');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// ── formatDateTime ────────────────────────────────────────────────────────────

describe('formatDateTime — invalid / null / undefined', () => {
  it('null → ā€"', () => expect(formatDateTime(null)).toBe('—'));
  it('undefined → ā€"', () => expect(formatDateTime(undefined)).toBe('—'));
  it('empty string → ā€"', () => expect(formatDateTime('')).toBe('—'));
  it('invalid date string → ā€"', () => expect(formatDateTime('not-a-date')).toBe('—'));
});

describe('formatDateTime — valid inputs', () => {
  it('Date object → correct format', () => {
    const d = new Date(2026, 2, 23, 14, 7, 42); // Mar 23 2026 14:07:42 local
    expect(formatDateTime(d)).toBe(expectedDateTime(d));
  });

  it('ISO string → correct format', () => {
    const d = new Date(2026, 2, 23, 14, 7, 42);
    expect(formatDateTime(d.toISOString())).toBe(expectedDateTime(new Date(d.toISOString())));
  });

  it('PostgreSQL TIMESTAMPTZ string → parses correctly', () => {
    const d = new Date(2026, 2, 23, 9, 5, 3);
    const pgStr = d.toISOString().replace('T', ' ').replace('Z', '+00:00');
    expect(formatDateTime(pgStr)).toBe(expectedDateTime(new Date(pgStr)));
  });

  it('includes seconds in output', () => {
    const d = new Date(2026, 0, 1, 0, 0, 7);
    expect(formatDateTime(d)).toMatch(/:\d{2}:\d{2}$/);
  });
});

describe('formatDateTime — zero-padding', () => {
  it('day < 10 is zero-padded', () => {
    const d = new Date(2026, 0, 5, 14, 0, 0);
    expect(formatDateTime(d)).toMatch(/^05-/);
  });

  it('hour < 10 is zero-padded', () => {
    const d = new Date(2026, 0, 15, 9, 0, 0);
    expect(formatDateTime(d)).toMatch(/ 09:/);
  });

  it('minute < 10 is zero-padded', () => {
    const d = new Date(2026, 0, 15, 14, 3, 0);
    expect(formatDateTime(d)).toMatch(/:03:/);
  });

  it('second < 10 is zero-padded', () => {
    const d = new Date(2026, 0, 15, 14, 30, 7);
    expect(formatDateTime(d)).toMatch(/:07$/);
  });
});

describe('formatDateTime — month abbreviations', () => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  months.forEach((abbr, idx) => {
    it(`month ${idx + 1} → ${abbr}`, () => {
      const d = new Date(2026, idx, 15, 12, 0, 0);
      expect(formatDateTime(d)).toContain(`-${abbr}-`);
    });
  });
});

// ── formatDate ────────────────────────────────────────────────────────────────

describe('formatDate — invalid / null / undefined', () => {
  it('null → ā€"', () => expect(formatDate(null)).toBe('—'));
  it('undefined → ā€"', () => expect(formatDate(undefined)).toBe('—'));
  it('empty string → ā€"', () => expect(formatDate('')).toBe('—'));
  it('invalid date string → ā€"', () => expect(formatDate('not-a-date')).toBe('—'));
});

describe('formatDate — valid inputs', () => {
  it('Date object → dd-MMM-yyyy format', () => {
    const d = new Date(2026, 2, 23);
    expect(formatDate(d)).toBe(expectedDate(d));
  });

  it('ISO string → dd-MMM-yyyy format', () => {
    const d = new Date(2026, 5, 1);
    expect(formatDate(d.toISOString())).toBe(expectedDate(new Date(d.toISOString())));
  });

  it('output has no time component', () => {
    const d = new Date(2026, 2, 23);
    expect(formatDate(d)).not.toMatch(/\d{2}:\d{2}/);
  });
});
