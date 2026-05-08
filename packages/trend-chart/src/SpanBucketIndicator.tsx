import type { CSSProperties } from 'react';
import { formatSpanMs } from './render/formatSpanMs.js';
import { formatFetchMs } from './render/formatFetchMs.js';

export interface SpanBucketIndicatorProps {
  spanMs: bigint;
  /** Bucket width in ms; null when no data or raw mode — shows "--". */
  bucketSMs: bigint | null;
  /** Wall-clock ms of the most recent viewport-change batch; null until first batch. */
  lastFetchMs: number | null;
}

const CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 11,
  color: '#6b7280',
  fontFamily: 'monospace',
  lineHeight: '1.5',
};

function formatBucket(ms: bigint): string {
  const s = Number(ms) / 1000;
  if (s < 60) return `${+s.toFixed(2)} s`;
  if (s < 3600) return `${+(s / 60).toFixed(2)} min`;
  return `${+(s / 3600).toFixed(2)} h`;
}

export function SpanBucketIndicator({ spanMs, bucketSMs, lastFetchMs }: SpanBucketIndicatorProps) {
  return (
    <div style={CONTAINER}>
      <span>Span: {formatSpanMs(spanMs)}</span>
      <span>Bucket Size: {bucketSMs == null ? '—' : formatBucket(bucketSMs)}</span>
      <span>Last Fetch: {lastFetchMs == null ? '—' : formatFetchMs(lastFetchMs)}</span>
    </div>
  );
}
