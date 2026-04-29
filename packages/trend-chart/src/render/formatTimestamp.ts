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
