const FMT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

/**
 * Renders an epoch-ms timestamp in the configured site timezone via Intl.DateTimeFormat.
 * Falls back to browser timezone if siteTimezone is undefined or invalid.
 */
export function formatTimestamp(ms: bigint | number, siteTimezone?: string): string {
  const epochMs = typeof ms === 'bigint' ? Number(ms) : ms;
  try {
    return new Intl.DateTimeFormat('en-US', { ...FMT_OPTIONS, timeZone: siteTimezone }).format(epochMs);
  } catch {
    return new Intl.DateTimeFormat('en-US', FMT_OPTIONS).format(epochMs);
  }
}

/**
 * Density-aware X-axis tick formatter. Picks format granularity from incrSec so
 * ticks are legible at any zoom level without redundant date/time components.
 *
 * incrSec < 60       → HH:mm:ss        (sub-minute)
 * incrSec < 3600     → HH:mm           (sub-hour)
 * incrSec < 86400    → MM/DD HH:mm     (sub-day)
 * incrSec < 604800   → MM/DD           (1d–7d)
 * incrSec < 2592000  → MMM DD          (1w–30d)
 * incrSec ≥ 2592000  → MMM YYYY        (30d+)
 */
export function formatTickLabel(tsMs: number, timezone: string | undefined, incrSec: number): string {
  let opts: Intl.DateTimeFormatOptions;
  if (incrSec < 60) {
    opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  } else if (incrSec < 3600) {
    opts = { hour: '2-digit', minute: '2-digit', hour12: false };
  } else if (incrSec < 86400) {
    opts = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  } else if (incrSec < 604800) {
    opts = { month: '2-digit', day: '2-digit' };
  } else if (incrSec < 2592000) {
    opts = { month: 'short', day: '2-digit' };
  } else {
    opts = { month: 'short', year: 'numeric' };
  }
  if (timezone) opts.timeZone = timezone;
  return new Intl.DateTimeFormat('en-US', opts).format(tsMs);
}
