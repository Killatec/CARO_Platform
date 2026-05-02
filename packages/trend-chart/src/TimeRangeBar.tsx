import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ModeState } from './useTrendMode.js';
import type { Viewport } from './types.js';

// ── Preset definitions ────────────────────────────────────────────────────────

const PRESETS: { label: string; sizeMs: bigint }[] = [
  { label: '15m', sizeMs: 15n * 60_000n },
  { label: '1h',  sizeMs: 60n * 60_000n },
  { label: '4h',  sizeMs: 4n * 60n * 60_000n },
  { label: '24h', sizeMs: 24n * 60n * 60_000n },
  { label: '7d',  sizeMs: 7n * 24n * 60n * 60_000n },
  { label: '14d', sizeMs: 14n * 24n * 60n * 60_000n },
];

// ── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Returns how far the site timezone wall-clock time is ahead of UTC, in ms,
 * at the given instant. Positive = east of UTC.
 */
function getTzOffsetMs(date: Date, tz: string): number {
  // Format in UTC and in tz, parse both, difference is the offset.
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  };
  const tzParts = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz }).formatToParts(date);
  const get = (parts: Intl.DateTimeFormatPart[], t: string) =>
    parseInt(parts.find(p => p.type === t)?.value ?? '0');
  const tzWall = Date.UTC(
    get(tzParts, 'year'),
    get(tzParts, 'month') - 1,
    get(tzParts, 'day'),
    get(tzParts, 'hour'),
    get(tzParts, 'minute'),
    get(tzParts, 'second'),
  );
  return tzWall - date.getTime();
}

/**
 * Convert a UTC bigint ms timestamp to a datetime-local string representing the
 * wall-clock time in the given site timezone (or browser local if tz is absent).
 */
function msToDatetimeLocal(ms: bigint, tz?: string): string {
  const d = new Date(Number(ms));
  if (!tz) {
    // Browser local: subtract the local offset to get a "UTC" that looks local.
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  }
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  };
  const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Parse a "YYYY-MM-DDTHH:MM" string entered by the user as site-local time,
 * returning UTC milliseconds as bigint.
 * Spec §12.2: inputs are interpreted as site-local, not browser-local.
 */
function datetimeLocalToMs(value: string, tz?: string): bigint {
  // Parse the date components directly from the string to avoid any
  // implicit local-timezone interpretation.
  const year = parseInt(value.slice(0, 4));
  const month = parseInt(value.slice(5, 7)) - 1;
  const day = parseInt(value.slice(8, 10));
  const hour = parseInt(value.slice(11, 13));
  const minute = parseInt(value.slice(14, 16));

  if (!tz) {
    // Browser local: new Date(value) interprets as local, which is what we want.
    return BigInt(new Date(value).getTime());
  }

  // Treat the parsed components as UTC to get an approximate epoch
  const approxUtcMs = Date.UTC(year, month, day, hour, minute);
  // Find how far tz is ahead of UTC at approximately this moment
  const offsetMs = getTzOffsetMs(new Date(approxUtcMs), tz);
  // The user entered a wall-clock time in tz:
  //   wall_clock_in_tz = utc + offset  →  utc = wall_clock - offset
  return BigInt(approxUtcMs - offsetMs);
}

// ── Styles ────────────────────────────────────────────────────────────────────

const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 0 8px',
  flexWrap: 'wrap',
  fontFamily: 'monospace',
  fontSize: 12,
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

const ACTIVE_BTN: CSSProperties = {
  ...BASE_BTN,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
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

const DIVIDER: CSSProperties = {
  width: 1,
  height: 18,
  background: '#e5e7eb',
  margin: '0 2px',
};

const LABEL: CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
};

const INPUT: CSSProperties = {
  padding: '3px 6px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontSize: 12,
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface PresetButtonsProps {
  mode: ModeState;
  onPreset: (sizeMs: bigint) => void;
}

function PresetButtons({ mode, onPreset }: PresetButtonsProps) {
  return (
    <>
      {PRESETS.map(p => {
        const isActive =
          mode.mode === 'tailing' && mode.sizeMs === p.sizeMs;
        return (
          <button
            key={p.label}
            style={isActive ? ACTIVE_BTN : BASE_BTN}
            onClick={() => onPreset(p.sizeMs)}
          >
            {p.label}
          </button>
        );
      })}
    </>
  );
}

interface LiveButtonProps {
  mode: ModeState;
  onLive: () => void;
}

function LiveButton({ mode, onLive }: LiveButtonProps) {
  const isTailing = mode.mode === 'tailing';
  return (
    <button style={isTailing ? LIVE_BTN : LIVE_BTN_FIXED} onClick={onLive}>
      {isTailing ? '● Live' : 'Go Live'}
    </button>
  );
}

interface CustomRangePickerProps {
  viewport: Viewport;
  siteTimezone?: string;
  onCustom: (from: bigint, to: bigint) => void;
}

function CustomRangePicker({ viewport, siteTimezone, onCustom }: CustomRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [fromVal, setFromVal] = useState(() => msToDatetimeLocal(viewport.start, siteTimezone));
  const [toVal, setToVal] = useState(() => msToDatetimeLocal(viewport.end, siteTimezone));

  function handleOpen() {
    // Initialise inputs from current viewport when opening.
    setFromVal(msToDatetimeLocal(viewport.start, siteTimezone));
    setToVal(msToDatetimeLocal(viewport.end, siteTimezone));
    setOpen(true);
  }

  function handleApply() {
    const from = datetimeLocalToMs(fromVal, siteTimezone);
    const to = datetimeLocalToMs(toVal, siteTimezone);
    if (to <= from) return; // silently reject invalid range
    onCustom(from, to);
    setOpen(false);
  }

  return (
    <>
      <button style={open ? ACTIVE_BTN : BASE_BTN} onClick={handleOpen}>
        Custom…
      </button>
      {open && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={LABEL}>{siteTimezone ?? 'local'}:</span>
          <input
            type="datetime-local"
            style={INPUT}
            value={fromVal}
            onChange={e => setFromVal(e.target.value)}
          />
          <span style={LABEL}>to</span>
          <input
            type="datetime-local"
            style={INPUT}
            value={toVal}
            onChange={e => setToVal(e.target.value)}
          />
          <button style={ACTIVE_BTN} onClick={handleApply}>Apply</button>
          <button style={BASE_BTN} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface TimeRangeBarProps {
  mode: ModeState;
  viewport: Viewport;
  siteTimezone?: string;
  onPreset: (sizeMs: bigint) => void;
  onLive: () => void;
  onCustom: (from: bigint, to: bigint) => void;
}

export function TimeRangeBar({ mode, viewport, siteTimezone, onPreset, onLive, onCustom }: TimeRangeBarProps) {
  return (
    <div style={BAR}>
      <PresetButtons mode={mode} onPreset={onPreset} />
      <div style={DIVIDER} />
      <LiveButton mode={mode} onLive={onLive} />
      <div style={DIVIDER} />
      <CustomRangePicker viewport={viewport} siteTimezone={siteTimezone} onCustom={onCustom} />
    </div>
  );
}
