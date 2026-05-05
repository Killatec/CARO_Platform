/**
 * Renders a viewport span (given in ms as bigint) into a short human-readable
 * form. Uses days/hours/minutes/seconds depending on magnitude. No "buckets"
 * suffix — this formats a window span, not a bucket size.
 *
 * Examples: 900_000n → "15 min", 3_600_000n → "1 h", 1_209_600_000n → "14 d"
 */
export function formatSpanMs(spanMs: bigint): string {
  const secs = Number(spanMs) / 1000;
  if (secs < 60) return `${+secs.toFixed(2)} s`;
  if (secs < 3600) return `${+(secs / 60).toFixed(2)} min`;
  if (secs < 86400) return `${+(secs / 3600).toFixed(2)} h`;
  return `${+(secs / 86400).toFixed(2)} d`;
}
