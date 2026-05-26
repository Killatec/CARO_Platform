import type { CSSProperties } from 'react';
import { formatSpanMs } from './render/formatSpanMs.js';

export interface SpanIndicatorProps {
  spanMs: bigint;
}

const STYLE: CSSProperties = {
  fontSize: 12,
  color: '#374151',
  fontFamily: 'monospace',
  lineHeight: '16px',
};

export function SpanIndicator({ spanMs }: SpanIndicatorProps) {
  return <span style={STYLE}>Span: {formatSpanMs(spanMs)}</span>;
}
