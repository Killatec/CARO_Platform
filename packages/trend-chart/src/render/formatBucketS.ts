/**
 * Renders bucketS (seconds, possibly float) into a short human-readable size.
 * 0 → 'raw'; 14.4 → '14.4 s'; 230.4 → '3.84 min'; 14746 → '4.1 h'
 * Callers that need a labeled form ("X s buckets") append context at their site.
 */
export function formatBucketS(bucketS: number): string {
  if (bucketS <= 0) return 'raw';
  if (bucketS < 60) return `${+bucketS.toFixed(2)} s`;
  if (bucketS < 3600) return `${+(bucketS / 60).toFixed(2)} min`;
  return `${+(bucketS / 3600).toFixed(2)} h`;
}
