export interface FormatDateTimeOptions {
  /** IANA timezone (e.g. 'America/New_York'). Default: browser-local. */
  timezone?: string;
  /** Returned for null/undefined/invalid input. Default: '—'. */
  fallback?: string;
  /** Include seconds in the time component. Default: true. */
  seconds?: boolean;
}

type DateInput = bigint | number | Date | string | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'bigint') {
    const d = new Date(Number(value));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Canonical timestamp formatter for the CARO platform.
 * Output: dd-MMM-yyyy HH:mm:ss (seconds optional)
 * Example: 02-May-2026 14:31:48
 *
 * - timezone: IANA name (e.g. 'America/New_York'). Falls back to browser-local
 *   when undefined or invalid.
 * - fallback: returned for null/undefined/invalid input (default '—').
 * - seconds: include seconds in the time component (default true).
 */
export function formatDateTime(value: DateInput, opts?: FormatDateTimeOptions): string {
  const fallback = opts?.fallback ?? '—';
  const date = toDate(value);
  if (!date) return fallback;
  const epochMs = date.getTime();
  const formatOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(opts?.seconds ?? true ? { second: '2-digit' } : {}),
    ...(opts?.timezone ? { timeZone: opts.timezone } : {}),
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', formatOpts);
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...formatOpts, timeZone: undefined });
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(epochMs)) parts[p.type] = p.value;
  const time = parts.second
    ? `${parts.hour}:${parts.minute}:${parts.second}`
    : `${parts.hour}:${parts.minute}`;
  return `${parts.day}-${parts.month}-${parts.year} ${time}`;
}

/**
 * Date-only variant. Output: dd-MMM-yyyy.
 * Example: 02-May-2026
 */
export function formatDate(value: DateInput, opts?: Omit<FormatDateTimeOptions, 'seconds'>): string {
  const fallback = opts?.fallback ?? '—';
  const date = toDate(value);
  if (!date) return fallback;
  const formatOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(opts?.timezone ? { timeZone: opts.timezone } : {}),
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', formatOpts);
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...formatOpts, timeZone: undefined });
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date.getTime())) parts[p.type] = p.value;
  return `${parts.day}-${parts.month}-${parts.year}`;
}
