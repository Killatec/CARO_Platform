/**
 * Canonical timestamp formatter for the trend viewer.
 * Output: dd-mmm-yyyy HH:mm:ss  (24 h, English 3-letter month, zero-padded)
 * Example: 02-May-2026 14:31:48
 *
 * Falls back to browser timezone when timezone is undefined or invalid.
 */
export function formatDateTime(ms: bigint | number, timezone?: string): string {
  const epochMs = typeof ms === 'bigint' ? Number(ms) : ms;
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
