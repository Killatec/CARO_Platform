import type { CSSProperties } from 'react';
import type { TrendData } from './types.js';
import { formatBucketS } from './render/formatBucketS.js';

export interface ResolutionIndicatorProps {
  data: TrendData;
}

const STYLE: CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontFamily: 'monospace',
};

export function ResolutionIndicator({ data }: ResolutionIndicatorProps) {
  const label =
    data.type === 'raw' ? 'raw' : formatBucketS(data.bucketSMs / 1000);
  return <span style={STYLE}>{label}</span>;
}
