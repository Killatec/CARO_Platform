import type { CSSProperties } from 'react';
import type { TagDef } from '@caro/hmi-context';
import type { TrendData } from './types.js';
import { colorAssign } from './colorAssign.js';
import { formatValue } from './render/formatValue.js';

export interface LegendProps {
  tagIds: number[];
  data: TrendData;
  tagMap: Map<number, TagDef>;
  selectedTagId: number;
  /** Bucket/row index from cursor; if absent, falls back to last bucket when showLastWhenIdle, otherwise renders as `--`. */
  cursorIdx?: number;
  /** When true (tailing), idle state shows the last bucket value. When false (fixed), idle state shows '--'. */
  showLastWhenIdle: boolean;
  onSelect: (tagId: number) => void;
  onRemove: (tagId: number) => void;
}

const STRIP: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingLeft: 8,
  width: 180,
  overflowY: 'auto',
  flexShrink: 0,
};

function getCurrentValue(
  data: TrendData,
  tagId: number,
  cursorIdx: number | undefined,
  showLastWhenIdle: boolean,
): number | null {
  if (data.type === 'aggregate') {
    const vals = data.series.get(tagId);
    if (!vals) return null;
    if (cursorIdx !== undefined) return vals[Math.min(cursorIdx, vals.length - 1)] ?? null;
    return showLastWhenIdle ? (vals[vals.length - 1] ?? null) : null;
  }
  // Raw
  const s = data.series.get(tagId);
  if (!s || s.value.length === 0) return null;
  if (cursorIdx !== undefined) return s.value[Math.min(cursorIdx, s.value.length - 1)] ?? null;
  return showLastWhenIdle ? (s.value[s.value.length - 1] ?? null) : null;
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

export function Legend({ tagIds, data, tagMap, selectedTagId, cursorIdx, showLastWhenIdle, onSelect, onRemove }: LegendProps) {
  return (
    <div style={STRIP}>
      {tagIds.map(tagId => (
        <LegendEntry
          key={tagId}
          tagId={tagId}
          tag={tagMap.get(tagId)}
          isSelected={tagId === selectedTagId}
          value={getCurrentValue(data, tagId, cursorIdx, showLastWhenIdle)}
          onSelect={() => onSelect(tagId)}
          onRemove={() => onRemove(tagId)}
        />
      ))}
    </div>
  );
}
