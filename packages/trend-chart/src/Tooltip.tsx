import type { CSSProperties } from 'react';
import type { TagDef } from '@caro/hmi-context';
import type { TrendData } from './types.js';
import { colorAssign } from './colorAssign.js';
import { formatValue } from './render/formatValue.js';
import { formatDateTime } from './dateUtils.js';

export interface TooltipProps {
  cursorIdx: number;
  cursorClientX: number;
  cursorClientY: number;
  chartBounds: { left: number; top: number; right: number; bottom: number };
  data: TrendData;
  tagIds: number[];
  tagMap: Map<number, TagDef>;
  siteTimezone?: string;
}

const TOOLTIP: CSSProperties = {
  position: 'fixed',
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'monospace',
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  pointerEvents: 'none',
  zIndex: 1000,
  minWidth: 160,
};

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
};

const SWATCH: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
  flexShrink: 0,
};

function getValueAtIdx(data: TrendData, tagId: number, idx: number): number | null {
  if (data.type === 'aggregate') {
    return data.series.get(tagId)?.[idx] ?? null;
  }
  // Raw: idx maps to the sorted-union timestamp position — not directly usable here.
  // For the raw tooltip, we read from the raw series by position too (seriesFromTrendData order).
  return null;
}

function getTimestampMs(data: TrendData, idx: number): number {
  if (data.type === 'aggregate') {
    return Number(data.startTime) + idx * data.bucketSMs;
  }
  return Number(data.startTime);
}

export function Tooltip({
  cursorIdx,
  cursorClientX,
  cursorClientY,
  chartBounds,
  data,
  tagIds,
  tagMap,
  siteTimezone,
}: TooltipProps) {
  const tsMs = getTimestampMs(data, cursorIdx);
  const label = formatDateTime(tsMs, siteTimezone);

  // Snap tooltip to stay within chart bounds: prefer right of cursor, fall back left.
  const OFFSET = 14;
  const estWidth = 180;
  const estHeight = 28 + tagIds.length * 22;

  let left = cursorClientX + OFFSET;
  if (left + estWidth > chartBounds.right) {
    left = cursorClientX - estWidth - OFFSET;
  }

  let top = cursorClientY - estHeight / 2;
  if (top < chartBounds.top) top = chartBounds.top;
  if (top + estHeight > chartBounds.bottom) top = chartBounds.bottom - estHeight;

  return (
    <div style={{ ...TOOLTIP, left, top }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: '#374151' }}>{label}</div>
      {tagIds.map(tagId => {
        const tag = tagMap.get(tagId);
        const value = getValueAtIdx(data, tagId, cursorIdx);
        const isBoolean = tag?.data_type === 'bool';
        const formatted = formatValue(value, tag?.unit, isBoolean);
        return (
          <div key={tagId} style={ROW}>
            <div style={{ ...SWATCH, background: colorAssign(tagId) }} />
            <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
              {tag?.tag_path.split('.').pop() ?? String(tagId)}
            </span>
            <span style={{ marginLeft: 'auto', color: '#111827' }}>{formatted}</span>
          </div>
        );
      })}
    </div>
  );
}
