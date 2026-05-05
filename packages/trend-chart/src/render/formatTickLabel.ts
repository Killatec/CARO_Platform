// ── shared part extractor ─────────────────────────────────────────────────────

function getParts(ms: number, opts: Intl.DateTimeFormatOptions, timezone?: string): Record<string, string> {
  const fmtOpts = { ...opts, ...(timezone ? { timeZone: timezone } : {}) };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', fmtOpts);
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...fmtOpts, timeZone: undefined });
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
  return p;
}

// Returns "YYYY-MM-DD" in the given timezone — used for day-boundary detection.
function localDayKey(ms: number, timezone?: string): string {
  const p = getParts(ms, { year: 'numeric', month: '2-digit', day: '2-digit' }, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Density-aware X-axis tick label formatter. Same conventions as the full
 * formatDateTime but with adaptive field truncation:
 *
 *   incrSec < 60           → HH:mm:ss
 *   60 ≤ incrSec < 3 600   → HH:mm
 *   3 600 ≤ incrSec < 86 400  → dd-mmm HH:mm  (first tick or day-boundary tick)
 *                              → HH:mm          (same day as previous tick)
 *   86 400 ≤ incrSec < 2 592 000  → dd-mmm
 *   2 592 000 ≤ incrSec < 31 536 000 → mmm-yyyy
 *   incrSec ≥ 31 536 000   → yyyy
 *
 * prevTsMs: the previous tick's timestamp in ms. Pass undefined for the first
 * tick. Used by the Hour level to show the date prefix only when the calendar
 * day changes.
 */
export function formatTickLabel(
  tsMs: number,
  timezone: string | undefined,
  incrSec: number,
  prevTsMs?: number,
): string {
  if (incrSec < 60) {
    const p = getParts(tsMs, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, timezone);
    return `${p.hour}:${p.minute}:${p.second}`;
  }

  if (incrSec < 3_600) {
    const p = getParts(tsMs, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, timezone);
    return `${p.hour}:${p.minute}`;
  }

  if (incrSec < 86_400) {
    const p = getParts(
      tsMs,
      { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      timezone,
    );
    const isNewDay = prevTsMs === undefined || localDayKey(tsMs, timezone) !== localDayKey(prevTsMs, timezone);
    return isNewDay ? `${p.day}-${p.month} ${p.hour}:${p.minute}` : `${p.hour}:${p.minute}`;
  }

  if (incrSec < 2_592_000) {
    const p = getParts(tsMs, { day: '2-digit', month: 'short' }, timezone);
    return `${p.day}-${p.month}`;
  }

  if (incrSec < 31_536_000) {
    const p = getParts(tsMs, { month: 'short', year: 'numeric' }, timezone);
    return `${p.month}-${p.year}`;
  }

  const p = getParts(tsMs, { year: 'numeric' }, timezone);
  return p.year ?? String(new Date(tsMs).getUTCFullYear());
}
