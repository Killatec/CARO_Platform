import type { CSSProperties } from 'react';
import type { TagDef } from '@caro/hmi-context';
import type { TrendData } from './types.js';
import { colorAssign } from './colorAssign.js';
import { formatValue } from './render/formatValue.js';
import { formatTimestamp } from './render/formatTimestamp.js';

export interface LegendProps {
  tagIds: number[];
  data: TrendData;
  tagMap: Map<number, TagDef>;
  selectedTagId: number;
  /** Bucket/row index from cursor; if absent, shows last-bucket value. */
  cursorIdx?: number;
  onSelect: (tagId: number) => void;
  onRemove: (tagId: number) => void;
  /** Cursor timestamp in ms (number from uPlot); null / undefined → show "--". */
  cursorTsMs?: number | null;
  siteTimezone?: string;
}

const STRIP: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '6px 0',
  overflowX: 'auto',
};

function getCurrentValue(data: TrendData, tagId: number, cursorIdx: number | undefined): number | null {
  if (data.type === 'aggregate') {
    const vals = data.series.get(tagId);
    if (!vals) return null;
    const idx = cursorIdx !== undefined ? cursorIdx : vals.length - 1;
    return vals[Math.min(idx, vals.length - 1)] ?? null;
  }
  // Raw: show last known value
  const s = data.series.get(tagId);
  if (!s || s.value.length === 0) return null;
  const idx = cursorIdx !== undefined ? Math.min(cursorIdx, s.value.length - 1) : s.value.length - 1;
  return s.value[idx] ?? null;
}

interface EntryProps {
  tagId: number;
  tag: TagDef | undefined;
  isSelected: boolean;
  value: number | null;
  onSelect: () => void;
  onRemove: () => void;
}

function LegendEntry({ tagId, tag, isSelected, value, onSelect, onRemove }: EntryProps) {
  const color = colorAssign(tagId);
  const isBoolean = tag?.data_type === 'bool';
  const formatted = formatValue(value, tag?.unit, isBoolean);
  const tagName = tag?.tag_path.split('.').pop() ?? String(tagId);

  const entry: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    border: isSelected ? `1px solid ${color}` : '1px solid #e5e7eb',
    background: isSelected ? '#f9fafb' : '#fff',
    userSelect: 'none',
  };

  const swatch: CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
    border: isSelected ? `2px solid ${color}` : 'none',
    boxSizing: 'border-box',
  };

  const nameStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: isSelected ? 700 : 400,
    color: '#111827',
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  };

  const valueStyle: CSSProperties = {
    fontSize: 12,
    color: '#374151',
    fontFamily: 'monospace',
    marginLeft: 4,
  };

  const removeBtn: CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9ca3af',
    padding: '0 2px',
    fontSize: 14,
    lineHeight: 1,
    marginLeft: 2,
  };

  return (
    <div style={entry} onClick={onSelect} title={tag?.tag_path ?? String(tagId)}>
      <div style={swatch} />
      <span style={nameStyle}>{tagName}</span>
      <span style={valueStyle}>{formatted}</span>
      <button
        style={removeBtn}
        onClick={e => { e.stopPropagation(); onRemove(); }}
        title="Remove trace"
      >
        ×
      </button>
    </div>
  );
}

const TIME_DISPLAY: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  color: '#374151',
  flexShrink: 0,
};

export function Legend({ tagIds, data, tagMap, selectedTagId, cursorIdx, onSelect, onRemove, cursorTsMs, siteTimezone }: LegendProps) {
  return (
    <div style={STRIP}>
      <div style={TIME_DISPLAY}>
        Time: {cursorTsMs == null ? '--' : formatTimestamp(cursorTsMs, siteTimezone)}
      </div>
      {tagIds.map(tagId => (
        <LegendEntry
          key={tagId}
          tagId={tagId}
          tag={tagMap.get(tagId)}
          isSelected={tagId === selectedTagId}
          value={getCurrentValue(data, tagId, cursorIdx)}
          onSelect={() => onSelect(tagId)}
          onRemove={() => onRemove(tagId)}
        />
      ))}
    </div>
  );
}
