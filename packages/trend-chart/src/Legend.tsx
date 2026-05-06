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

const HEADER_STYLE: CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontFamily: 'monospace',
  paddingLeft: 4,
  paddingBottom: 2,
};

/**
 * Returns the contextual header text for the legend value column.
 * Always rendered — communicates what the per-trace number represents.
 */
export function deriveLegendContext(
  dataType: TrendData['type'],
  cursorIdx: number | undefined,
  showLastWhenIdle: boolean,
): { headerText: string } {
  const hasCursor = cursorIdx !== undefined;
  if (dataType === 'aggregate') {
    if (hasCursor) return { headerText: 'Value: Max @ Cursor' };
    if (showLastWhenIdle) return { headerText: 'Value: Last Sample' };
    return { headerText: 'Value: N/A' };
  }
  // raw
  if (hasCursor) return { headerText: 'Value: @ Cursor' };
  if (showLastWhenIdle) return { headerText: 'Value: Last Sample' };
  return { headerText: 'Value: N/A' };
}

/**
 * Returns the pre-formatted display text for a legend entry.
 *
 * Aggregate + v0.8 bands: max value at cursor/last bucket
 * Aggregate + v0.7 cache (no bands): falls back to single value (backward compat)
 * Raw: single value
 * Idle (showLastWhenIdle=false, no cursor): "—"
 */
function getLegendDisplayText(
  data: TrendData,
  tag: TagDef | undefined,
  tagId: number,
  cursorIdx: number | undefined,
  showLastWhenIdle: boolean,
): string {
  if (data.type === 'aggregate') {
    const entry = data.series.get(tagId);
    if (!entry) return '—';

    const isBoolean = tag?.data_type === 'bool';

    // v0.7 cache fallback: no bands — show single value.
    if (!entry.min || !entry.max) {
      const vals = entry.value;
      if (vals.length === 0) return '—';
      const idx = cursorIdx !== undefined
        ? Math.min(cursorIdx, vals.length - 1)
        : showLastWhenIdle ? vals.length - 1 : -1;
      if (idx < 0) return '—';
      return formatValue(vals[idx] ?? null, tag?.unit, isBoolean);
    }

    // v0.8: show max only — spread is already conveyed by the visible band height.
    const maxArr = entry.max;
    if (maxArr.length === 0) return '—';
    const idx = cursorIdx !== undefined
      ? Math.min(cursorIdx, maxArr.length - 1)
      : showLastWhenIdle ? maxArr.length - 1 : -1;
    if (idx < 0) return '—';
    return formatValue(maxArr[idx] ?? null, tag?.unit, isBoolean);
  }

  // Raw path: single value.
  const s = data.series.get(tagId);
  if (!s || s.value.length === 0) return '—';
  const isBoolean = tag?.data_type === 'bool';
  if (cursorIdx !== undefined) {
    return formatValue(s.value[Math.min(cursorIdx, s.value.length - 1)] ?? null, tag?.unit, isBoolean);
  }
  return showLastWhenIdle
    ? formatValue(s.value[s.value.length - 1] ?? null, tag?.unit, isBoolean)
    : '—';
}

interface EntryProps {
  tagId: number;
  tag: TagDef | undefined;
  isSelected: boolean;
  displayText: string;
  onSelect: () => void;
  onRemove: () => void;
}

function LegendEntry({ tagId, tag, isSelected, displayText, onSelect, onRemove }: EntryProps) {
  const color = colorAssign(tagId);
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
      <span style={valueStyle}>{displayText}</span>
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
  const { headerText } = deriveLegendContext(data.type, cursorIdx, showLastWhenIdle);
  return (
    <div style={STRIP}>
      <div style={HEADER_STYLE}>{headerText}</div>
      {tagIds.map(tagId => {
        const tag = tagMap.get(tagId);
        return (
          <LegendEntry
            key={tagId}
            tagId={tagId}
            tag={tag}
            isSelected={tagId === selectedTagId}
            displayText={getLegendDisplayText(data, tag, tagId, cursorIdx, showLastWhenIdle)}
            onSelect={() => onSelect(tagId)}
            onRemove={() => onRemove(tagId)}
          />
        );
      })}
    </div>
  );
}
