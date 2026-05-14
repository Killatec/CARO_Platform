import { describe, it, expect } from 'vitest';
import { trendModeReducer, modeToViewport } from '../src/useTrendMode.js';
import type { ModeState, TrendModeAction } from '../src/useTrendMode.js';
import { MAX_VIEWPORT_SPAN_MS } from '../src/level.js';

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

// ── viewport lower-bound clamp via zoomApplied/panApplied ────────────────────

describe('clampLowerBound — zoomApplied', () => {
  it('span === MAX_VIEWPORT_SPAN_MS: passes through (from is large positive)', () => {
    const to   = NOW;
    const from = to - MAX_VIEWPORT_SPAN_MS;
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
  });

  it('span > MAX_VIEWPORT_SPAN_MS: passes through unchanged (no span clamp)', () => {
    const from = NOW - MAX_VIEWPORT_SPAN_MS * 2n;
    const to   = NOW;
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(to - from);
  });

  it('span < MAX_VIEWPORT_SPAN_MS: passes through unchanged', () => {
    const from = NOW - 3_600_000n; // 1h — well within bounds
    const to   = NOW;
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
  });
});

describe('endPickerCommitted — sizeMs clamp', () => {
  it('sizeMs > MAX: clamped before computing from = to - sizeMs', () => {
    const overMax: ModeState = { mode: 'fixed', from: 0n, to: NOW, sizeMs: MAX_VIEWPORT_SPAN_MS + 1_000_000n, lastIntent: 'zoom' };
    const next = dispatch(overMax, { type: 'endPickerCommitted', to: NOW, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.sizeMs).toBe(MAX_VIEWPORT_SPAN_MS);
    expect(next.to).toBe(NOW);
    expect(next.from).toBe(NOW - MAX_VIEWPORT_SPAN_MS);
  });
});

// ── F8: endPickerCommitted lower-bound guard ──────────────────────────────────

describe('endPickerCommitted — lower-bound guard (F8)', () => {
  it('to < 2n: state unchanged (no-op)', () => {
    // to=1n would place from=0n after subtracting any span; to=0n is invalid.
    // Guard: if to < 2n return state as-is.
    const next = dispatch(TAILING_1H, { type: 'endPickerCommitted', to: 1n, nowMs: NOW });
    expect(next).toBe(TAILING_1H); // exact same reference — no state change
  });

  it('to = 0n: state unchanged (no-op)', () => {
    const next = dispatch(FIXED_1H, { type: 'endPickerCommitted', to: 0n, nowMs: NOW });
    expect(next).toBe(FIXED_1H);
  });

  it('to - sizeMs < 1n: span shrinks to preserve from = 1n, End (to) is unchanged', () => {
    // to=500n, sizeMs=3_600_000n (1 h): to - sizeMs would be deeply negative.
    // Expected: from=1n, to=500n, sizeMs=499n (= to - 1n).
    const next = dispatch(TAILING_1H, { type: 'endPickerCommitted', to: 500n, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(500n);       // End preserved
    expect(next.from).toBe(1n);       // lower bound respected
    expect(next.sizeMs).toBe(499n);   // shrunk span = to - 1n
  });

  it('to - sizeMs = 0n (exactly): from = 1n, to unchanged, sizeMs = to - 1n', () => {
    // to = sizeMs: from would be 0n without guard.
    const sizeMs = 3_600_000n;
    const to = sizeMs; // exactly equal
    const state: ModeState = { mode: 'fixed', from: 0n, to: NOW, sizeMs, lastIntent: 'zoom' };
    const next = dispatch(state, { type: 'endPickerCommitted', to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(to);
    expect(next.from).toBe(1n);
    expect(next.sizeMs).toBe(to - 1n);
  });

  it('to - sizeMs >= 1n: normal case — from = to - sizeMs, span unchanged', () => {
    // to large enough that no span shrink is needed.
    const to = NOW;
    const next = dispatch(TAILING_1H, { type: 'endPickerCommitted', to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.to).toBe(to);
    expect(next.sizeMs).toBe(TAILING_1H.sizeMs);
    expect(next.from).toBe(to - TAILING_1H.sizeMs);
  });
});

describe('clampLowerBound — panApplied', () => {
  it('pan within bounds: passes through (span-preserving, so defensive no-op)', () => {
    const from = NOW - 3_600_000n;
    const to   = NOW;
    const next = dispatch(FIXED_1H, { type: 'panApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(from);
    expect(next.to).toBe(to);
  });
});

// ── clampLowerBound guard (from >= 1n) ────────────────────────────────────────
// Tested through zoomApplied because clampLowerBound is internal to the reducer.

describe('clampLowerBound guard', () => {
  it('from < 1n (span within MAX): shifts viewport right so from = 1n, span preserved', () => {
    // from=-1000n, to=1000n: span=2000n; lower-bound clamp fires: shift=1001n
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from: -1000n, to: 1000n, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(1n);
    expect(next.to).toBe(2001n);      // 1000n + 1001n shift
    expect(next.sizeMs).toBe(2000n); // span unchanged
  });

  it('from < 1n with to = 0n: both bounds shifted right so from = 1n', () => {
    // from=-5n, to=0n: span=5n; lower-bound clamp: shift=6n
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from: -5n, to: 0n, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(1n);
    expect(next.to).toBe(6n);
    expect(next.sizeMs).toBe(5n);
  });

  it('from >= 1n (positive bounds): no lower-bound clamp', () => {
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from: 100n, to: 200n, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(100n);
    expect(next.to).toBe(200n);
  });

  it('from < 1n with span > MAX: passes through span unchanged, shifts to from = 1n', () => {
    // No span clamp; only lower-bound applies. Span is preserved at original size.
    const from = -5_000_000_000n;
    const to   = MAX_VIEWPORT_SPAN_MS; // span = MAX + 5G > MAX
    const next = dispatch(TAILING_1H, { type: 'zoomApplied', from, to, nowMs: NOW });
    expect(next.mode).toBe('fixed');
    if (next.mode !== 'fixed') return;
    expect(next.from).toBe(1n);
    const expectedSpan = to - from;
    expect(next.sizeMs).toBe(expectedSpan); // span NOT clamped
    expect(next.to).toBe(to + (1n - from)); // to + shift
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
