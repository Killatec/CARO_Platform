import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent, CSSProperties } from 'react';
import type { ModeState } from './useTrendMode.js';
import type { Viewport } from './types.js';
import { formatDateTime } from '@caro/ui';

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Formats a UTC bigint ms as "YYYY-MM-DDTHH:mm:ss" in the given timezone —
 * the format required by <input type="datetime-local" step="1">.
 */
function toDatetimeLocalValue(ms: bigint, timezone?: string): string {
  const epochMs = Number(ms);
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
    ...(timezone ? { timeZone: timezone } : {}),
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', opts);
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: undefined });
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(epochMs)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Parses a "YYYY-MM-DDTHH:mm:ss" string from the native picker as a site-local
 * wall-clock time, returning UTC milliseconds as bigint. Returns null on invalid
 * or too-short input.
 */
function parsePickerValue(value: string, timezone?: string): bigint | null {
  if (!value || value.length < 16) return null;
  const year = parseInt(value.slice(0, 4));
  const month = parseInt(value.slice(5, 7)) - 1;
  const day = parseInt(value.slice(8, 10));
  const hour = parseInt(value.slice(11, 13));
  const minute = parseInt(value.slice(14, 16));
  const second = value.length >= 19 ? parseInt(value.slice(17, 19)) : 0;
  if ([year, month + 1, day, hour, minute, second].some(Number.isNaN)) return null;

  const approxUtcMs = Date.UTC(year, month, day, hour, minute, second);
  if (!Number.isFinite(approxUtcMs)) return null;
  if (!timezone) return BigInt(approxUtcMs);

  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZone: timezone,
    });
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(approxUtcMs)) p[part.type] = part.value;
    const tzWall = Date.UTC(
      parseInt(p.year!), parseInt(p.month!) - 1, parseInt(p.day!),
      parseInt(p.hour!), parseInt(p.minute!), parseInt(p.second!),
    );
    return BigInt(approxUtcMs - (tzWall - approxUtcMs));
  } catch {
    return BigInt(approxUtcMs);
  }
}

// ── Calendar icon ─────────────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="1" y="3" width="14" height="12" rx="1.5" />
      <line x1="1" y1="7" x2="15" y2="7" />
      <line x1="5" y1="1" x2="5" y2="5" />
      <line x1="11" y1="1" x2="11" y2="5" />
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'monospace',
  fontSize: 12,
};

const PICKER_WRAPPER: CSSProperties = {
  position: 'relative',
};

const DISPLAY_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 6px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontSize: 12,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

// Overlaid on top of the visible button so the picker popup anchors at the
// button position. pointer-events:none keeps clicks on the button, not here.
const HIDDEN_INPUT: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  pointerEvents: 'none',
  border: 0,
  padding: 0,
  margin: 0,
};

const BASE_BTN: CSSProperties = {
  padding: '4px 10px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#d1d5db',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 12,
  background: '#fff',
  color: '#374151',
};

const LIVE_BTN: CSSProperties = {
  ...BASE_BTN,
  background: '#dcfce7',
  color: '#15803d',
  borderColor: '#86efac',
};

const LIVE_BTN_FIXED: CSSProperties = {
  ...BASE_BTN,
  color: '#6b7280',
};

const LIVE_BTN_ORANGE: CSSProperties = {
  ...BASE_BTN,
  background: '#ea580c',
  color: '#fff',
  borderColor: '#c2410c',
};

// ── Component ─────────────────────────────────────────────────────────────────

export interface EndPickerProps {
  state: ModeState;
  viewport: Viewport;
  siteTimezone?: string;
  /** Called with the parsed UTC ms when the user selects a time in the native picker. */
  onEndCommitted: (to: bigint) => void;
  onLive: () => void;
  /**
   * When true (live-fixed mode, latestSampleTs < viewport.from), the Live
   * button turns orange to signal the live edge is off-screen to the left.
   * Defaults to false. Has no effect outside live-fixed mode.
   */
  liveEdgeBehindWindow?: boolean;
}

export function EndPicker({ state, viewport, siteTimezone, onEndCommitted, onLive, liveEdgeBehindWindow }: EndPickerProps) {
  const [displayText, setDisplayText] = useState(() => formatDateTime(viewport.end, { timezone: siteTimezone }));
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  // Re-sync display when viewport.end changes (zoom, preset, Live, tick).
  useEffect(() => {
    setDisplayText(formatDateTime(viewport.end, { timezone: siteTimezone }));
  }, [viewport.end, siteTimezone]);

  function openPicker() {
    const input = hiddenInputRef.current;
    if (!input) return;
    input.value = toDatetimeLocalValue(viewport.end, siteTimezone);
    input.showPicker();
  }

  function handleHiddenChange(value: string) {
    const ms = parsePickerValue(value, siteTimezone);
    if (ms !== null) onEndCommitted(ms);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  }

  const isLive = state.mode === 'live-trailing' || state.mode === 'live-fixed';
  const isOrange = state.mode === 'live-fixed' && !!liveEdgeBehindWindow;
  const activeLiveStyle = isOrange ? LIVE_BTN_ORANGE : LIVE_BTN;

  return (
    <div style={ROW}>
      <div style={PICKER_WRAPPER}>
        <button
          type="button"
          style={DISPLAY_BTN}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          aria-label="Pick end time"
        >
          <span>{displayText}</span>
          <CalendarIcon />
        </button>
        <input
          ref={hiddenInputRef}
          type="datetime-local"
          step="1"
          style={HIDDEN_INPUT}
          onChange={e => handleHiddenChange(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
      <button type="button" style={isLive ? activeLiveStyle : LIVE_BTN_FIXED} onClick={onLive}>
        {isLive ? '● Live' : 'Go Live'}
      </button>
    </div>
  );
}
