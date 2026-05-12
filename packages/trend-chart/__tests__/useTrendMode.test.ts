import { describe, it, expect } from 'vitest';
import { trendModeReducer, modeToViewport } from '../src/useTrendMode.js';
import type { ModeState, TrendModeAction } from '../src/useTrendMode.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000n; // arbitrary fixed "now" in ms
const FAR_PAST = NOW - 10_000_000n; // 10 000 s in the past

// Tailing state with 1h window
const TAILING_1H: ModeState = {
  mode: 'tailing',
  sizeMs: 3_600_000n,
  nowMs: NOW,
  lastIntent: null,
};

// Fixed state (range from 2h ago to 1h ago), carrying sizeMs=1h
const FIXED_1H: ModeState = {
  mode: 'fixed',
  from: NOW - 7_200_000n,
  to: NOW - 3_600_000n,
  sizeMs: 3_600_000n,
  lastIntent: null,
};

function dispatch(state: ModeState, action: TrendModeAction): ModeState {
  return trendModeReducer(state, action);
}

// ── presetClicked ──────────────────────────────────────────────────────────────

describe('presetClicked', () => {
  it('from tailing → tailing with new sizeMs', () => {
    const next = dispatch(TAILING_1H, { type: 'presetClicked', sizeMs: 900_000n, nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(900_000n);
    expect(next.nowMs).toBe(NOW);
    expect(next.lastIntent).toBe('preset');
    expect(modeToViewport(next)).toEqual({ start: NOW - 900_000n, end: NOW });
  });

  it('from fixed → stays fixed, preserves to, re-anchors from = to - sizeMs', () => {
    const next = dispatch(FIXED_1H, { type: 'presetClicked', sizeMs: 86_400_000n, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.sizeMs).toBe(86_400_000n);
    expect(next.to).toBe(FIXED_1H.to);
    expect(next.from).toBe(FIXED_1H.to - 86_400_000n);
    expect(next.lastIntent).toBe('preset');
  });

  it('from fixed with 15m preset → viewport is [to - 15m, to]', () => {
    const sizeMs = 900_000n; // 15m
    const next = dispatch(FIXED_1H, { type: 'presetClicked', sizeMs, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    const vp = modeToViewport(next);
    expect(vp.end).toBe(FIXED_1H.to);
    expect(vp.start).toBe(FIXED_1H.to - sizeMs);
  });

  it('from tailing: updates nowMs', () => {
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
      sizeMs: 14_400_000n,
      lastIntent: null,
    };
    const next = dispatch(fixedWith4h, { type: 'liveClicked', nowMs: NOW });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.sizeMs).toBe(14_400_000n);
    expect(next.nowMs).toBe(NOW);
    expect(next.lastIntent).toBe('live');
  });

  it('from tailing → stays tailing, updates nowMs', () => {
    const nextNow = NOW + 3_000n;
    const next = dispatch(TAILING_1H, { type: 'liveClicked', nowMs: nextNow });
    expect(next.mode).toBe('tailing');
    if (next.mode !== 'tailing') return;
    expect(next.nowMs).toBe(nextNow);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
    expect(next.lastIntent).toBe('live');
  });
});

// ── endPickerCommitted ────────────────────────────────────────────────────────

describe('endPickerCommitted', () => {
  // End picker always goes fixed — Live button is the sole entry to tailing.

  it('to ≈ now → fixed (no near-now auto-tailing for End picker)', () => {
    const to = NOW - 30_000n; // 30 s ago — End picker always goes fixed
    const next = dispatch(TAILING_1H, { type: 'endPickerCommitted', to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(to);
    expect(next.from).toBe(to - TAILING_1H.sizeMs);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
    expect(next.lastIntent).toBe('endPicker');
  });

  it('to << now → fixed, from = to - sizeMs (sizeMs from tailing state)', () => {
    const to = FAR_PAST + 3_600_000n;
    const next = dispatch(TAILING_1H, { type: 'endPickerCommitted', to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(to);
    expect(next.from).toBe(to - TAILING_1H.sizeMs);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
    expect(next.lastIntent).toBe('endPicker');
  });

  it('from fixed: to << now → fixed, sizeMs from fixed state', () => {
    const to = FAR_PAST + 3_600_000n;
    const next = dispatch(FIXED_1H, { type: 'endPickerCommitted', to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(to);
    expect(next.from).toBe(to - FIXED_1H.sizeMs);
    expect(next.sizeMs).toBe(FIXED_1H.sizeMs);
    expect(next.lastIntent).toBe('endPicker');
  });

  it('from fixed: to ≈ now → fixed (same strict rule regardless of prior mode)', () => {
    const to = NOW - 30_000n;
    const next = dispatch(FIXED_1H, { type: 'endPickerCommitted', to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(to);
    expect(next.from).toBe(to - FIXED_1H.sizeMs);
    expect(next.sizeMs).toBe(FIXED_1H.sizeMs);
    expect(next.lastIntent).toBe('endPicker');
  });
});

// ── zoomApplied ───────────────────────────────────────────────────────────────

describe('zoomApplied', () => {
  it('from tailing: to << now → fixed (zoom-in loses "now")', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 1_800_000n; // 30 min window, well in the past
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(to - from);
    expect(next.lastIntent).toBe('zoom');
  });

  it('from tailing: to ≈ now → fixed (zoom always exits tailing)', () => {
    const from = NOW - 1_800_000n; // wider window
    const to = NOW - 30_000n; // near now, but zoom unconditionally → fixed
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(to - from);
    expect(next.lastIntent).toBe('zoom');
  });

  it('from fixed: to ≈ now → stays fixed (zoom from fixed never enters tailing)', () => {
    const from = NOW - 1_800_000n;
    const to = NOW - 30_000n; // near now, but prior mode was fixed
    const next = dispatch(FIXED_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(to - from);
    expect(next.lastIntent).toBe('zoom');
  });

  it('from fixed: to << now → stays fixed', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 1_800_000n;
    const next = dispatch(FIXED_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(to - from);
    expect(next.lastIntent).toBe('zoom');
  });

  it('clears preset highlight: lastIntent was preset → becomes zoom', () => {
    const tailingPreset: ModeState = { ...TAILING_1H, lastIntent: 'preset' };
    const from = FAR_PAST;
    const to = FAR_PAST + 900_000n;
    const next = dispatch(tailingPreset, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.lastIntent).toBe('zoom');
  });

  it('from tailing: modeViewport matches zoomed from/to when going fixed', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 1_800_000n;
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    const vp = modeToViewport(next);
    expect(vp.start).toBe(from);
    expect(vp.end).toBe(to);
  });
});

// ── panApplied ────────────────────────────────────────────────────────────────

describe('panApplied', () => {
  it('to << now → fixed, sizeMs preserved from state (not derived from to - from)', () => {
    const from = FAR_PAST;
    const to = FAR_PAST + 3_600_000n; // same 1h width as TAILING_1H.sizeMs
    const next = dispatch(TAILING_1H, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs); // preserved exactly
    expect(next.lastIntent).toBe('pan');
  });

  it('to ≈ now → fixed (pan never enters tailing), sizeMs preserved', () => {
    const to = NOW - 30_000n;
    const from = to - TAILING_1H.sizeMs;
    const next = dispatch(TAILING_1H, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
    expect(next.lastIntent).toBe('pan');
  });

  it('from tailing: always transitions to fixed regardless of to value', () => {
    // Even panning to a window that ends at NOW, mode becomes fixed.
    const to = NOW;
    const from = to - TAILING_1H.sizeMs;
    const next = dispatch(TAILING_1H, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
  });

  it('from fixed: to << now → fixed, sizeMs preserved from fixed state', () => {
    const from = FAR_PAST + 1_000n;
    const to = from + FIXED_1H.sizeMs;
    const next = dispatch(FIXED_1H, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(FIXED_1H.sizeMs);
    expect(next.lastIntent).toBe('pan');
  });

  it('sizeMs is exact even when to - from differs by rounding', () => {
    // Simulate floating-point rounding: to - from is off by 1ms
    const from = FAR_PAST;
    const to = FAR_PAST + TAILING_1H.sizeMs - 1n; // 1ms short due to rounding
    const next = dispatch(TAILING_1H, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs); // exact, from state
  });

  it('lastIntent transitions from preset → pan', () => {
    const withPreset: ModeState = { ...TAILING_1H, lastIntent: 'preset' };
    const from = FAR_PAST;
    const to = FAR_PAST + TAILING_1H.sizeMs;
    const next = dispatch(withPreset, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.lastIntent).toBe('pan');
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

  it('in tailing: preserves lastIntent (clock advance is not a user intent)', () => {
    const withPreset: ModeState = { ...TAILING_1H, lastIntent: 'preset' };
    const next = dispatch(withPreset, { type: 'tick', nowMs: NOW + 1_000n });
    expect(next.lastIntent).toBe('preset');
  });

  it('in tailing: preserves lastIntent = null', () => {
    const next = dispatch(TAILING_1H, { type: 'tick', nowMs: NOW + 1_000n });
    expect(next.lastIntent).toBeNull();
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
