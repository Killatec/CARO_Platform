import { useReducer } from 'react';
import type { Dispatch } from 'react';
import type { Viewport } from './types.js';
import { MAX_VIEWPORT_SPAN_MS } from './level.js';

// ── Diagnostic instrumentation (temporary) ───────────────────────────────────
const _fmt = (b: bigint): string => {
  const n = Number(b);
  if (Number.isFinite(n) && n > 0 && n < 10_000_000_000_000) {
    return `${b.toString()} (${new Date(n).toISOString()})`;
  }
  return b.toString();
};
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SIZE_MS = 3_600_000n; // 1 hour default

/**
 * Tracks the most recent user action that changed the viewport, to drive
 * preset-button highlight logic. Rules:
 *   preset    — user clicked a span preset button
 *   live      — user clicked Live
 *   endPicker — user committed an End value via the End picker
 *   zoom      — user drag-zoomed or wheel-zoomed (zoomApplied dispatched by container)
 *   pan       — user dragged the X axis (panApplied); span preserved, only End shifts
 *   null      — initial state; no user action has fired yet
 *
 * Highlight rule (SpanPresets): lastIntent !== null && lastIntent !== 'zoom' && sizeMs === p.sizeMs
 * All intents except 'zoom' either set or preserve sizeMs from a preset, so the highlight
 * survives pan, liveClicked, and endPickerCommitted. null excluded for initial-state cleanliness.
 * Tick preserves the existing lastIntent value (clock advance is not a user intent).
 */
export type LastIntent = 'preset' | 'live' | 'endPicker' | 'zoom' | 'pan' | null;

/**
 * Discriminated mode state. Fixed carries sizeMs to restore when returning to
 * tailing via liveClicked (spec §12.3 "preserving the prior sizeMs").
 * lastIntent tracks the most recent user action for preset highlighting.
 */
export type ModeState =
  | { mode: 'tailing'; sizeMs: bigint; nowMs: bigint; lastIntent: LastIntent }
  | { mode: 'fixed'; from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent };

export type TrendModeAction =
  | { type: 'presetClicked'; sizeMs: bigint; nowMs: bigint }
  | { type: 'liveClicked'; nowMs: bigint }
  | { type: 'endPickerCommitted'; to: bigint; nowMs: bigint }
  | { type: 'zoomApplied'; from: bigint; to: bigint; nowMs: bigint }
  // Pan translates the viewport without changing span. Always lands in fixed
  // mode — pan never enters tailing. To enter live mode the user must click
  // Live or commit End ≈ now via the End picker.
  | { type: 'panApplied'; from: bigint; to: bigint; nowMs: bigint }
  | { type: 'tick'; nowMs: bigint };

/**
 * Clamp a viewport [from, to] so its span does not exceed MAX_VIEWPORT_SPAN_MS
 * and its left edge never falls below 1n (server rejects startTime ≤ 0n).
 * Span clamp preserves center; lower-bound clamp shifts rightward, preserving span.
 */
function clampToMaxSpan(from: bigint, to: bigint): { from: bigint; to: bigint } {
  const span = to - from;
  let clampedFrom = from;
  let clampedTo   = to;

  const spanClamped = span > MAX_VIEWPORT_SPAN_MS;
  if (spanClamped) {
    const center = (from + to) / 2n;
    const half   = MAX_VIEWPORT_SPAN_MS / 2n;
    clampedFrom  = center - half;
    clampedTo    = center + half;
  }

  const lowerBoundClamped = clampedFrom < 1n;
  if (lowerBoundClamped) {
    const shift = 1n - clampedFrom;
    clampedFrom = 1n;
    clampedTo  += shift;
  }

  console.log('[viewport-trace] clampToMaxSpan', {
    inputFrom:         _fmt(from),
    inputTo:           _fmt(to),
    inputSpanMs:       span.toString(),
    outputFrom:        _fmt(clampedFrom),
    outputTo:          _fmt(clampedTo),
    clamped:           spanClamped || lowerBoundClamped,
    spanClamped,
    lowerBoundClamped,
  });

  return { from: clampedFrom, to: clampedTo };
}

/** Pure reducer — exported for unit testing. */
export function trendModeReducer(state: ModeState, action: TrendModeAction): ModeState {
  switch (action.type) {
    case 'presetClicked':
      console.log('[viewport-trace] reducer presetClicked', {
        sizeMs: action.sizeMs.toString(),
        currentMode: state.mode,
        currentFrom: state.mode === 'fixed' ? _fmt(state.from) : `nowMs-${state.sizeMs}`,
        currentTo:   state.mode === 'fixed' ? _fmt(state.to)   : _fmt(state.nowMs),
      });
      // From fixed: stay fixed, preserve End (to), re-anchor Start = End - newSize.
      // From tailing: stay tailing with new span anchored to now.
      if (state.mode === 'fixed') {
        return {
          mode: 'fixed',
          from: state.to - action.sizeMs,
          to: state.to,
          sizeMs: action.sizeMs,
          lastIntent: 'preset',
        };
      }
      return { mode: 'tailing', sizeMs: action.sizeMs, nowMs: action.nowMs, lastIntent: 'preset' };

    case 'liveClicked':
      console.log('[viewport-trace] reducer liveClicked', {
        currentMode: state.mode,
        nowMs: _fmt(action.nowMs),
      });
      if (state.mode === 'fixed') {
        return { mode: 'tailing', sizeMs: state.sizeMs, nowMs: action.nowMs, lastIntent: 'live' };
      }
      return { ...state, nowMs: action.nowMs, lastIntent: 'live' };

    // End picker commits End only; always goes fixed — user clicks Live if they
    // want tailing. Strict interpretation: no near-now → tailing auto-transition.
    case 'endPickerCommitted': {
      console.log('[viewport-trace] reducer endPickerCommitted', {
        to: _fmt(action.to),
        currentMode: state.mode,
      });
      const { to } = action;
      const sizeMs = state.sizeMs > MAX_VIEWPORT_SPAN_MS ? MAX_VIEWPORT_SPAN_MS : state.sizeMs;
      return { mode: 'fixed', from: to - sizeMs, to, sizeMs, lastIntent: 'endPicker' };
    }

    // Zoom always exits tailing. Zoom is an exploratory action — the operator
    // wants to inspect a specific time region. Staying tailing because the right
    // edge happens to land near "now" hides intent. Tailing requires a deliberate
    // liveClicked or preset-from-tailing after any zoom.
    case 'zoomApplied': {
      console.log('[viewport-trace] reducer zoomApplied', {
        inputFrom: _fmt(action.from),
        inputTo:   _fmt(action.to),
        inputSpanMs: (action.to - action.from).toString(),
        currentFrom: state.mode === 'fixed' ? _fmt(state.from) : 'tailing',
        currentTo:   state.mode === 'fixed' ? _fmt(state.to)   : 'tailing',
      });
      const clamped = clampToMaxSpan(action.from, action.to);
      const sizeMs = clamped.to - clamped.from;
      return { mode: 'fixed', from: clamped.from, to: clamped.to, sizeMs, lastIntent: 'zoom' };
    }

    case 'panApplied': {
      console.log('[viewport-trace] reducer panApplied', {
        inputFrom: _fmt(action.from),
        inputTo:   _fmt(action.to),
        currentFrom: state.mode === 'fixed' ? _fmt(state.from) : 'tailing',
        currentTo:   state.mode === 'fixed' ? _fmt(state.to)   : 'tailing',
      });
      const clamped = clampToMaxSpan(action.from, action.to);
      const sizeMs = state.sizeMs;
      return { mode: 'fixed', from: clamped.from, to: clamped.to, sizeMs, lastIntent: 'pan' };
    }

    case 'tick':
      if (state.mode === 'tailing') {
        // Spread preserves lastIntent — advancing the clock is not a user intent.
        return { ...state, nowMs: action.nowMs };
      }
      return state;
  }
}

/** Derive the renderable viewport from mode state. */
export function modeToViewport(state: ModeState): Viewport {
  if (state.mode === 'tailing') {
    return { start: state.nowMs - state.sizeMs, end: state.nowMs };
  }
  return { start: state.from, end: state.to };
}

export interface UseTrendModeResult {
  state: ModeState;
  viewport: Viewport;
  dispatch: Dispatch<TrendModeAction>;
}

/** Stateful hook: owns mode reducer + 1 Hz tick. */
export function useTrendMode(): UseTrendModeResult {
  const [state, dispatch] = useReducer(trendModeReducer, undefined, () => ({
    mode: 'tailing' as const,
    sizeMs: DEFAULT_SIZE_MS,
    nowMs: BigInt(Date.now()),
    lastIntent: null as LastIntent,
  }));

  const viewport = modeToViewport(state);
  return { state, viewport, dispatch };
}
