import type { CSSProperties } from 'react';
import { formatSpanMs } from './render/formatSpanMs.js';
import { formatFetchMs } from './render/formatFetchMs.js';
import { formatBucketS } from './render/formatBucketS.js';

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

export function SpanBucketIndicator({ spanMs, bucketSMs, lastFetchMs }: SpanBucketIndicatorProps) {
  return (
    <div style={CONTAINER}>
      <span>Span: {formatSpanMs(spanMs)}</span>
      <span>Bucket Size: {bucketSMs == null ? '—' : formatBucketS(Number(bucketSMs) / 1000)}</span>
      <span>Last Fetch: {lastFetchMs == null ? '—' : formatFetchMs(lastFetchMs)}</span>
    </div>
  );
}
