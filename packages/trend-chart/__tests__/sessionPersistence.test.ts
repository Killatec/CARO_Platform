import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  serialiseSession,
  parseSession,
  loadSession,
  saveSession,
} from '../src/sessionPersistence.js';
import type { TrendViewerSessionV1 } from '../src/sessionPersistence.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<TrendViewerSessionV1> = {}): TrendViewerSessionV1 {
  return {
    version: 1,
    tagIds: [1, 2, 3],
    selectedTagId: 2,
    sizeMs: '3600000',
    mode: 'live-trailing',
    toMs: null,
    yScaleOverrides: { 1: { min: 0, max: 100 }, 2: { min: -10, max: 50 } },
    ...overrides,
  };
}

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('serialiseSession / parseSession', () => {
  it('round-trips a live-trailing session with BigInt strings', () => {
    const session = makeSession();
    const raw = serialiseSession(session);
    const result = parseSession(raw);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.tagIds).toEqual([1, 2, 3]);
    expect(result!.selectedTagId).toBe(2);
    expect(result!.sizeMs).toBe('3600000');
    expect(result!.mode).toBe('live-trailing');
    expect(result!.toMs).toBeNull();
    expect(result!.yScaleOverrides[1]).toEqual({ min: 0, max: 100 });
    expect(result!.yScaleOverrides[2]).toEqual({ min: -10, max: 50 });
  });

  it('round-trips a fixed session with toMs', () => {
    const session = makeSession({ mode: 'fixed', toMs: '1700000000000', sizeMs: '86400000' });
    const raw = serialiseSession(session);
    const result = parseSession(raw);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('fixed');
    expect(result!.toMs).toBe('1700000000000');
    expect(result!.sizeMs).toBe('86400000');
  });

  it('round-trips a live-fixed session', () => {
    const session = makeSession({ mode: 'live-fixed', toMs: '1700000000000' });
    const raw = serialiseSession(session);
    const result = parseSession(raw);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('live-fixed');
    expect(result!.toMs).toBe('1700000000000');
  });

  it('round-trips selectedTagId = null', () => {
    const session = makeSession({ selectedTagId: null });
    const result = parseSession(serialiseSession(session));
    expect(result!.selectedTagId).toBeNull();
  });

  it('round-trips empty tagIds and empty yScaleOverrides', () => {
    const session = makeSession({ tagIds: [], yScaleOverrides: {} });
    const result = parseSession(serialiseSession(session));
    expect(result!.tagIds).toEqual([]);
    expect(result!.yScaleOverrides).toEqual({});
  });

  it('yScaleOverrides keys are parsed as numbers', () => {
    const session = makeSession({ yScaleOverrides: { 42: { min: 1, max: 9 } } });
    const result = parseSession(serialiseSession(session));
    expect(result).not.toBeNull();
    // Key 42 must be accessible as a number.
    expect(result!.yScaleOverrides[42]).toEqual({ min: 1, max: 9 });
  });

  // ── parseSession rejects invalid inputs ───────────────────────────────────

  it('returns null for malformed JSON', () => {
    expect(parseSession('not json{')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(parseSession('null')).toBeNull();
  });

  it('returns null for a JSON array', () => {
    expect(parseSession('[]')).toBeNull();
  });

  it('returns null for unknown version', () => {
    const raw = JSON.stringify({ ...makeSession(), version: 2 });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when version is missing', () => {
    const { version: _v, ...noVersion } = makeSession() as Record<string, unknown>;
    expect(parseSession(JSON.stringify({ ...noVersion, version: undefined }))).toBeNull();
  });

  it('returns null for invalid mode string', () => {
    const raw = JSON.stringify({ ...makeSession(), mode: 'tailing' });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when tagIds contains a non-integer', () => {
    const raw = JSON.stringify({ ...makeSession(), tagIds: [1, 'two', 3] });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when tagIds contains a float', () => {
    const raw = JSON.stringify({ ...makeSession(), tagIds: [1.5] });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when sizeMs is not a decimal string', () => {
    const raw = JSON.stringify({ ...makeSession(), sizeMs: '3600e3' });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when toMs is missing for fixed mode', () => {
    const raw = JSON.stringify({ ...makeSession(), mode: 'fixed', toMs: null });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when toMs is present for live-trailing mode', () => {
    const raw = JSON.stringify({ ...makeSession(), mode: 'live-trailing', toMs: '123456' });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when yScaleOverrides has non-numeric key', () => {
    const raw = JSON.stringify({
      ...makeSession(),
      yScaleOverrides: { 'tag-1': { min: 0, max: 1 } },
    });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when a yScaleOverrides entry has non-number min', () => {
    const raw = JSON.stringify({
      ...makeSession(),
      yScaleOverrides: { 1: { min: 'zero', max: 100 } },
    });
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null when yScaleOverrides min is Infinity (non-finite)', () => {
    // JSON.stringify converts Infinity to null, so we test by reconstructing.
    const raw = JSON.stringify({ ...makeSession(), yScaleOverrides: {} })
      .replace('"yScaleOverrides":{}', '"yScaleOverrides":{"1":{"min":null,"max":100}}');
    expect(parseSession(raw)).toBeNull();
  });

  it('returns null for missing required field (tagIds)', () => {
    const obj = makeSession() as Record<string, unknown>;
    delete obj['tagIds'];
    expect(parseSession(JSON.stringify(obj))).toBeNull();
  });
});

// ── localStorage wrappers ─────────────────────────────────────────────────────

const LS_PREFIX = 'caro.trend-viewer.session.';

describe('loadSession', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns null when key not present', () => {
    expect(loadSession('missing')).toBeNull();
  });

  it('returns the session when key is present and valid', () => {
    const session = makeSession();
    localStorage.setItem(LS_PREFIX + 'key1', serialiseSession(session));
    const result = loadSession('key1');
    expect(result).not.toBeNull();
    expect(result!.tagIds).toEqual([1, 2, 3]);
  });

  it('returns null and warns when JSON is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(LS_PREFIX + 'bad', 'not-json');
    const result = loadSession('bad');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null and warns when session schema is invalid (version mismatch)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(LS_PREFIX + 'ver', JSON.stringify({ ...makeSession(), version: 99 }));
    const result = loadSession('ver');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('catches localStorage exceptions and returns null with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const result = loadSession('crash');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    getItem.mockRestore();
    warn.mockRestore();
  });
});

describe('saveSession', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('writes a parseable value to localStorage', () => {
    const session = makeSession();
    saveSession('k', session);
    const raw = localStorage.getItem(LS_PREFIX + 'k');
    expect(raw).not.toBeNull();
    const parsed = parseSession(raw!);
    expect(parsed).not.toBeNull();
    expect(parsed!.tagIds).toEqual([1, 2, 3]);
  });

  it('catches localStorage quota errors silently (no throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveSession('q', makeSession())).not.toThrow();
    expect(warn).toHaveBeenCalled();
    setItem.mockRestore();
    warn.mockRestore();
  });
});
