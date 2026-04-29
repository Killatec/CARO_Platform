import { useEffect, useReducer } from 'react';
import type { Dispatch } from 'react';
import type { Viewport } from './types.js';

export const NEAR_NOW_MS = 60_000n;
const DEFAULT_SIZE_MS = 3_600_000n; // 1 hour default

/**
 * Discriminated mode state. Fixed carries sizeMs to restore when returning to
 * tailing via liveClicked (spec §12.3 "preserving the prior sizeMs").
 * The spec §9.3 shows fixed without sizeMs but carry-through requires it.
 */
export type ModeState =
  | { mode: 'tailing'; sizeMs: bigint; nowMs: bigint }
  | { mode: 'fixed'; from: bigint; to: bigint; sizeMs: bigint };

export type TrendModeAction =
  | { type: 'presetClicked'; sizeMs: bigint; nowMs: bigint }
  | { type: 'liveClicked'; nowMs: bigint }
  | { type: 'customCommitted'; from: bigint; to: bigint; nowMs: bigint }
  | { type: 'viewportChanged'; from: bigint; to: bigint; nowMs: bigint }
  | { type: 'tick'; nowMs: bigint };

/** Pure reducer — exported for unit testing. */
export function trendModeReducer(state: ModeState, action: TrendModeAction): ModeState {
  switch (action.type) {
    case 'presetClicked':
      return { mode: 'tailing', sizeMs: action.sizeMs, nowMs: action.nowMs };

    case 'liveClicked':
      if (state.mode === 'fixed') {
        return { mode: 'tailing', sizeMs: state.sizeMs, nowMs: action.nowMs };
      }
      return { ...state, nowMs: action.nowMs };

    case 'customCommitted': {
      const { from, to, nowMs } = action;
      if (to >= nowMs - NEAR_NOW_MS) {
        return { mode: 'tailing', sizeMs: to - from, nowMs };
      }
      return { mode: 'fixed', from, to, sizeMs: state.sizeMs };
    }

    case 'viewportChanged': {
      const { from, to, nowMs } = action;
      if (to >= nowMs - NEAR_NOW_MS) {
        return { mode: 'tailing', sizeMs: to - from, nowMs };
      }
      return { mode: 'fixed', from, to, sizeMs: state.sizeMs };
    }

    case 'tick':
      if (state.mode === 'tailing') {
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
  }));

  useEffect(() => {
    const id = setInterval(() => {
      dispatch({ type: 'tick', nowMs: BigInt(Date.now()) });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const viewport = modeToViewport(state);
  return { state, viewport, dispatch };
}
