import type { CSSProperties } from 'react';
import { formatDateTime } from './dateUtils.js';

export interface CursorDisplayProps {
  cursorTsMs: number | null;
  siteTimezone?: string;
}

const STYLE: CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  color: '#374151',
  padding: '0 0 4px 0',
};

export function CursorDisplay({ cursorTsMs, siteTimezone }: CursorDisplayProps) {
  return (
    <div style={STYLE}>
      Cursor: {cursorTsMs == null ? '--' : formatDateTime(cursorTsMs, siteTimezone)}
    </div>
  );
}
