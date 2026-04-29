/**
 * Renders bucketS (seconds, possibly float) into a short human-readable form.
 * 0 → 'raw'; 14.4 → '14.4 s buckets'; 230.4 → '3.84 min buckets'; 14746 → '4.1 h buckets'
 */
export function formatBucketS(bucketS: number): string {
  if (bucketS <= 0) return 'raw';
  if (bucketS < 60) return `${+bucketS.toFixed(2)} s buckets`;
  if (bucketS < 3600) return `${+( bucketS / 60).toFixed(2)} min buckets`;
  return `${+(bucketS / 3600).toFixed(2)} h buckets`;
}
