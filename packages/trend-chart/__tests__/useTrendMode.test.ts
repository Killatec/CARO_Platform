import { describe, it, expect } from 'vitest';
import { trendModeReducer, modeToViewport, NEAR_NOW_MS } from '../src/useTrendMode.js';
import type { ModeState, TrendModeAction } from '../src/useTrendMode.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000n; // arbitrary fixed "now" in ms
const FAR_PAST = NOW - 10_000_000n; // 10 000 s in the past — well outside NEAR_NOW

// Tailing state with 1h window
const TAILING_1H: ModeState = {
  mode: 'tailing',
  sizeMs: 3_600_000n,
  nowMs: NOW,
};

// Fixed state (range from 2h ago to 1h ago), carrying sizeMs=1h
const FIXED_1H: ModeState = {
  mode: 'fixed',
  from: NOW - 7_200_000n,
  to: NOW - 3_600_000n,
  sizeMs: 3_600_000n,
};

function dispatch(state: ModeState, action: TrendModeAction): ModeState {
  return trendModeReducer(state, action);
}

// ── preset ─────────────────────────────────────────────────────────────────────

describe('presetClicked', () => {
  it('from tailing → tailing with new sizeMs', () => {
    const next = dispatch(TAILING_1H, { type: 'presetClicked', sizeMs: 900_000n, nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(900_000n);
    expect(next.nowMs).toBe(NOW);
    expect(modeToViewport(next)).toEqual({ start: NOW - 900_000n, end: NOW });
  });

  it('from fixed → tailing with new sizeMs', () => {
    const next = dispatch(FIXED_1H, { type: 'presetClicked', sizeMs: 86_400_000n, nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(86_400_000n);
  });

  it('updates nowMs to the action value', () => {
    const nextNow = NOW + 5_000n;
    const next = dispatch(TAILING_1H, { type: 'presetClicked', sizeMs: 3_600_000n, nowMs: nextNow });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.nowMs).toBe(nextNow);
  });
});

// ── liveClicked ────────────────────────────────────────────────────────────────

describe('liveClicked', () => {
  it('from fixed → tailing, preserving prior sizeMs', () => {
    const fixedWith4h: ModeState = {
      mode: 'fixed',
      from: FAR_PAST,
      to: FAR_PAST + 14_400_000n,
      sizeMs: 14_400_000n, // 4h — the "prior" size
    };
    const next = dispatch(fixedWith4h, { type: 'liveClicked', nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(14_400_000n);
    expect(next.nowMs).toBe(NOW);
  });

  it('from tailing → stays tailing, updates nowMs', () => {
    const nextNow = NOW + 3_000n;
    const next = dispatch(TAILING_1H, { type: 'liveClicked', nowMs: nextNow });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.nowMs).toBe(nextNow);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
  });
});

// ── customCommitted ────────────────────────────────────────────────────────────

describe('customCommitted', () => {
  it('to ≈ now (within NEAR_NOW_MS) → tailing with sizeMs = to - from', () => {
    const from = NOW - 3_600_000n;
    const to = NOW - 30_000n; // 30 s ago — inside NEAR_NOW_MS
    const next = dispatch(TAILING_1H, { type: 'customCommitted', from, to, nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(to - from);
  });

  it('to exactly at NEAR_NOW_MS boundary → tailing', () => {
    const from = NOW - 3_600_000n;
    const to = NOW - NEAR_NOW_MS; // exactly at the boundary
    const next = dispatch(TAILING_1H, { type: 'customCommitted', from, to, nowMs: NOW });
    expect(next.mode).toBe('tailing');
  });

  it('to << now → fixed', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 3_600_000n; // well in the past
    const next = dispatch(TAILING_1H, { type: 'customCommitted', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
  });

  it('to << now → fixed, carries sizeMs from prior tailing state', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 3_600_000n;
    const state: ModeState = { mode: 'tailing', sizeMs: 14_400_000n, nowMs: NOW };
    const next = dispatch(state, { type: 'customCommitted', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.sizeMs).toBe(14_400_000n);
  });
});

// ── viewportChanged ────────────────────────────────────────────────────────────

describe('viewportChanged', () => {
  it('from tailing: to < now - NEAR_NOW_MS → fixed', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 3_600_000n;
    const next = dispatch(TAILING_1H, { type: 'viewportChanged', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
  });

  it('from tailing: to < now - NEAR_NOW_MS → fixed, carries tailing sizeMs', () => {
    const tailingWith4h: ModeState = { mode: 'tailing', sizeMs: 14_400_000n, nowMs: NOW };
    const from = FAR_PAST;
    const to = FAR_PAST + 3_600_000n;
    const next = dispatch(tailingWith4h, { type: 'viewportChanged', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.sizeMs).toBe(14_400_000n);
  });

  it('from tailing: to >= now - NEAR_NOW_MS → stays tailing with new sizeMs', () => {
    const from = NOW - 900_000n;
    const to = NOW - 10_000n; // close to now
    const next = dispatch(TAILING_1H, { type: 'viewportChanged', from, to, nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(to - from);
  });

  it('from fixed: to >= now - NEAR_NOW_MS → tailing', () => {
    const from = NOW - 3_600_000n;
    const to = NOW - 30_000n;
    const next = dispatch(FIXED_1H, { type: 'viewportChanged', from, to, nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(to - from);
  });

  it('from fixed: to < now - NEAR_NOW_MS → stays fixed with updated range', () => {
    const from = FAR_PAST + 1_000n;
    const to = FAR_PAST + 3_601_000n;
    const next = dispatch(FIXED_1H, { type: 'viewportChanged', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
  });
});

// ── tick ───────────────────────────────────────────────────────────────────────

describe('tick', () => {
  it('in tailing: advances nowMs', () => {
    const nextNow = NOW + 1_000n;
    const next = dispatch(TAILING_1H, { type: 'tick', nowMs: nextNow });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.nowMs).toBe(nextNow);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
  });

  it('in tailing: viewport advances with nowMs', () => {
    const nextNow = NOW + 5_000n;
    const next = dispatch(TAILING_1H, { type: 'tick', nowMs: nextNow });
    const vp = modeToViewport(next);
    expect(vp.end).toBe(nextNow);
    expect(vp.start).toBe(nextNow - TAILING_1H.sizeMs);
  });

  it('in fixed: no state change', () => {
    const nextNow = NOW + 1_000n;
    const next = dispatch(FIXED_1H, { type: 'tick', nowMs: nextNow });
    expect(next).toEqual(FIXED_1H);
  });
});

// ── modeToViewport ─────────────────────────────────────────────────────────────

describe('modeToViewport', () => {
  it('tailing viewport = [nowMs - sizeMs, nowMs]', () => {
    const vp = modeToViewport(TAILING_1H);
    expect(vp.start).toBe(TAILING_1H.nowMs - TAILING_1H.sizeMs);
    expect(vp.end).toBe(TAILING_1H.nowMs);
  });

  it('fixed viewport = [from, to]', () => {
    const vp = modeToViewport(FIXED_1H);
    expect(vp.start).toBe(FIXED_1H.from);
    expect(vp.end).toBe(FIXED_1H.to);
  });
});
