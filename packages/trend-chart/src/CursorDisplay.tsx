import type { CSSProperties } from 'react';

/** Renders the range message bar (footer row above presets).
 *  Keeps a fixed line-height so the chart canvas does not reflow when the message
 *  appears or disappears. Historical name: was also responsible for cursor time display
 *  before the cursor row moved into the Legend strip. */
export interface CursorDisplayProps {
  /** When set, rendered as a prominent red warning (e.g. "Range too wide…"). */
  rangeMessage?: string | null;
}

const ROW: CSSProperties = {
  padding: '0 0 4px 0',
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '16px', // fixed: prevents layout reflow when message toggles
};

const RANGE_MSG: CSSProperties = {
  color: '#dc2626',
  fontWeight: 700,
};

export function CursorDisplay({ rangeMessage }: CursorDisplayProps) {
  return (
    <div style={ROW}>
      {rangeMessage && <span style={RANGE_MSG}>{rangeMessage}</span>}
    </div>
  );
}
