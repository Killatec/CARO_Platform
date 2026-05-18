import { useReducer } from 'react';
import type { Dispatch } from 'react';
import type { Viewport } from './types.js';
import { MAX_VIEWPORT_SPAN_MS } from './level.js';
import { clampLowerBound } from './bigintMath.js';

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
 *
 * 'live-fixed' is wired into the type system in Phase 1.3 so Phase 3 doesn't
 * surface as a wall of type errors. No action produces it until Phase 3 — it
 * is unreachable at runtime in Phases 1–2.
 */
export type ModeState =
  | { mode: 'live-trailing'; sizeMs: bigint; nowMs: bigint; lastIntent: LastIntent }
  | { mode: 'live-fixed';    from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent }
  | { mode: 'fixed';         from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent };

/**
 * Returns true when the mode is one of the two Live states ('live-trailing' or
 * 'live-fixed'). Use this predicate wherever consumers previously checked
 * `mode === 'live-trailing'` alone, so that 'live-fixed' (Phase 3+) gets the
 * same Live-path treatment automatically.
 */
export function isLive(mode: ModeState['mode']): boolean {
  return mode === 'live-trailing' || mode === 'live-fixed';
}

export type TrendModeAction =
  | { type: 'presetClicked'; sizeMs: bigint; nowMs: bigint }
  | { type: 'liveClicked'; nowMs: bigint }
  /**
   * latestSampleTs is read from useLiveSubscription.getLatestSampleTs() at
   * dispatch time and carried here so the reducer stays pure. The reducer
   * ignores it in Phase 1 — it is reserved for Phase 3 live→live-fixed routing.
   */
  | { type: 'endPickerCommitted'; to: bigint; nowMs: bigint; latestSampleTs?: bigint | null }
  | { type: 'zoomApplied'; from: bigint; to: bigint; nowMs: bigint }
  // Pan translates the viewport without changing span. Always lands in fixed
  // mode — pan never enters tailing. To enter live mode the user must click
  // Live or commit End ≈ now via the End picker.
  /** latestSampleTs: same role as in endPickerCommitted above. */
  | { type: 'panApplied'; from: bigint; to: bigint; nowMs: bigint; latestSampleTs?: bigint | null }
  | { type: 'tick'; nowMs: bigint };

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
      return { mode: 'live-trailing', sizeMs: action.sizeMs, nowMs: action.nowMs, lastIntent: 'preset' };

    case 'liveClicked':
      if (state.mode === 'fixed' || state.mode === 'live-fixed') {
        // Both fixed and live-fixed lack nowMs in their shape, so we cannot
        // spread — construct live-trailing explicitly from sizeMs only.
        return { mode: 'live-trailing', sizeMs: state.sizeMs, nowMs: action.nowMs, lastIntent: 'live' };
      }
      // live-trailing: spread is safe because the shape already carries nowMs.
      return { ...state, nowMs: action.nowMs, lastIntent: 'live' };

    // End picker commits End only. From fixed: always stays fixed (D6 asymmetry —
    // endPicker never enters Live). From live-*: if to > latestSampleTs → live-fixed;
    // else → fixed. latestSampleTs === null fallback: use state.modeViewport.end.
    case 'endPickerCommitted': {
      const { to } = action;
      // Defensive: require at least 1 ms of span. EndPicker UI prevents this; reducer
      // stays self-consistent for any caller.
      if (to < 2n) return state;
      const cappedSize = state.sizeMs > MAX_VIEWPORT_SPAN_MS ? MAX_VIEWPORT_SPAN_MS : state.sizeMs;
      // Ensure from >= 1n. End picker contract preserves the chosen End, so we shrink
      // the span rather than shifting End forward (unlike clampLowerBound for zoom/pan).
      const sizeMs = to - cappedSize >= 1n ? cappedSize : to - 1n;
      const from = to - sizeMs;
      if (isLive(state.mode)) {
        const lts = action.latestSampleTs ?? null;
        const effectiveLts: bigint =
          lts !== null
            ? lts
            : state.mode === 'live-trailing' ? state.nowMs : state.to;
        if (to > effectiveLts) {
          return { mode: 'live-fixed', from, to, sizeMs, lastIntent: 'endPicker' };
        }
        return { mode: 'fixed', from, to, sizeMs, lastIntent: 'endPicker' };
      }
      // From fixed: always stays fixed (D6 asymmetry).
      return { mode: 'fixed', from, to, sizeMs, lastIntent: 'endPicker' };
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
      if (isLive(state.mode)) {
        const lts = action.latestSampleTs ?? null;
        const effectiveLts: bigint =
          lts !== null
            ? lts
            : state.mode === 'live-trailing' ? state.nowMs : state.to;
        if (clamped.to > effectiveLts) {
          return { mode: 'live-fixed', from: clamped.from, to: clamped.to, sizeMs, lastIntent: 'pan' };
        }
        return { mode: 'fixed', from: clamped.from, to: clamped.to, sizeMs, lastIntent: 'pan' };
      }
      return { mode: 'fixed', from: clamped.from, to: clamped.to, sizeMs, lastIntent: 'pan' };
    }

    case 'tick':
      if (state.mode === 'live-trailing') {
        // Spread preserves lastIntent — advancing the clock is not a user intent.
        return { ...state, nowMs: action.nowMs };
      }
      if (state.mode === 'live-fixed') {
        if (action.nowMs >= state.to) {
          // Auto-promote: nowMs has caught up — snap back to live-trailing.
          // lastIntent='live' so useZoomState reset effect fires.
          return { mode: 'live-trailing', sizeMs: state.sizeMs, nowMs: action.nowMs, lastIntent: 'live' };
        }
        return state; // nowMs hasn't caught up yet — no-op
      }
      return state; // fixed: defensive no-op
  }
}

/** Derive the renderable viewport from mode state. */
export function modeToViewport(state: ModeState): Viewport {
  if (state.mode === 'live-trailing') {
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
    mode: 'live-trailing' as const,
    sizeMs: DEFAULT_SIZE_MS,
    nowMs: BigInt(Date.now()),
    lastIntent: null as LastIntent,
  }));

  const viewport = modeToViewport(state);
  return { state, viewport, dispatch };
}
