import { useReducer } from 'react';
import type { Dispatch } from 'react';
import type { Viewport } from './types.js';
import { MAX_VIEWPORT_SPAN_MS } from './level.js';

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

// Server rejects startTime <= 0, so we shift any sub-1n viewport rightward
// while preserving span. Span-cap enforcement lives in gatedFetchTile.
function clampLowerBound(from: bigint, to: bigint): { from: bigint; to: bigint } {
  if (from >= 1n) return { from, to };
  const shift = 1n - from;
  return { from: 1n, to: to + shift };
}

/** Pure reducer — exported for unit testing. */
export function trendModeReducer(state: ModeState, action: TrendModeAction): ModeState {
  switch (action.type) {
    case 'presetClicked':
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
      if (state.mode === 'fixed') {
        return { mode: 'tailing', sizeMs: state.sizeMs, nowMs: action.nowMs, lastIntent: 'live' };
      }
      return { ...state, nowMs: action.nowMs, lastIntent: 'live' };

    // End picker commits End only; always goes fixed — user clicks Live if they
    // want tailing. Strict interpretation: no near-now → tailing auto-transition.
    case 'endPickerCommitted': {
      const { to } = action;
      const sizeMs = state.sizeMs > MAX_VIEWPORT_SPAN_MS ? MAX_VIEWPORT_SPAN_MS : state.sizeMs;
      return { mode: 'fixed', from: to - sizeMs, to, sizeMs, lastIntent: 'endPicker' };
    }

    // Zoom always exits tailing. Zoom is an exploratory action — the operator
    // wants to inspect a specific time region. Staying tailing because the right
    // edge happens to land near "now" hides intent. Tailing requires a deliberate
    // liveClicked or preset-from-tailing after any zoom.
    case 'zoomApplied': {
      const clamped = clampLowerBound(action.from, action.to);
      const sizeMs = clamped.to - clamped.from;
      return { mode: 'fixed', from: clamped.from, to: clamped.to, sizeMs, lastIntent: 'zoom' };
    }

    case 'panApplied': {
      const clamped = clampLowerBound(action.from, action.to);
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
