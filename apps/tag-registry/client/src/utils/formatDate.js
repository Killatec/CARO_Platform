const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function toDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Formats a date/time value as dd-MMM-yyyy HH:mm (e.g. 23-Mar-2026 14:07).
 * Returns '—' if value is null, undefined, or invalid.
 */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Formats a date value as dd-MMM-yyyy (e.g. 23-Mar-2026).
 * Returns '—' if value is null, undefined, or invalid.
 */
export function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
