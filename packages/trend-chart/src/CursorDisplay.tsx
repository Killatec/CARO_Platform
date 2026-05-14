import type { CSSProperties } from 'react';
import { formatDateTime } from '@caro/ui';

export interface CursorDisplayProps {
  cursorTsMs: number | null;
  siteTimezone?: string;
  /** When set, rendered on the right side of the cursor row (e.g. "Range too wide…"). */
  rangeExceededMessage?: string | null;
}

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '0 0 4px 0',
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '16px', // fixed: right-side message must not grow the row
};

const CURSOR_TEXT: CSSProperties = {
  color: '#374151',
};

const RANGE_MSG: CSSProperties = {
  color: '#dc2626',
  fontWeight: 700,
};

export function CursorDisplay({ cursorTsMs, siteTimezone, rangeExceededMessage }: CursorDisplayProps) {
  return (
    <div style={ROW}>
      <span style={CURSOR_TEXT}>
        Cursor: {cursorTsMs == null ? '--' : formatDateTime(cursorTsMs, { timezone: siteTimezone })}
      </span>
      {rangeExceededMessage && <span style={RANGE_MSG}>{rangeExceededMessage}</span>}
    </div>
  );
}
