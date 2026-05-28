/**
 * Formats a tile-batch elapsed time (integer ms) into a short human-readable
 * string for the BucketFetchIndicator's "Last Fetch" line.
 *
 * Examples: 234 → "234 ms", 1230 → "1.23 s", 12300 → "12.3 s", 75000 → "1.2 min"
 */
export function formatFetchMs(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
