import type { CSSProperties } from 'react';
import { formatFetchMs } from './render/formatFetchMs.js';
import { formatBucketS } from './render/formatBucketS.js';

export interface BucketFetchIndicatorProps {
  /** Bucket width in ms; null when no data or raw mode — shows "—". */
  bucketSMs: bigint | null;
  /** Wall-clock ms of the most recent viewport-change batch; null until first batch. */
  lastFetchMs: number | null;
}

const CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 12,
  color: '#374151',
  fontFamily: 'monospace',
  lineHeight: '16px',
};

export function BucketFetchIndicator({ bucketSMs, lastFetchMs }: BucketFetchIndicatorProps) {
  return (
    <div style={CONTAINER}>
      <span>Bucket Size: {bucketSMs == null ? '—' : formatBucketS(Number(bucketSMs) / 1000)}</span>
      <span>Last Fetch: {lastFetchMs == null ? '—' : formatFetchMs(lastFetchMs)}</span>
    </div>
  );
}
