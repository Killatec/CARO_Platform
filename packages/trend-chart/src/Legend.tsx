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
  /** Cursor X position in milliseconds from uPlot posToVal; null/absent means no cursor. */
  cursorTsMs?: number | null;
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
  cursorTsMs: number | null | undefined,
  showLastWhenIdle: boolean,
): { headerText: string } {
  const hasCursor = cursorTsMs != null;
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
 * Aggregate + cursor: bucketIdx = floor((cursorTsMs - startTime) / bucketSMs);
 *   out of [0,n) → '—'; null bucket → '—'; v0.8 shows max, v0.7 shows value.
 * Aggregate + idle: last bucket when showLastWhenIdle, else '—'.
 * Raw + cursor: LOCF — last sample with ts ≤ cursorTsMs, seeded by prev.
 *   null sample resets carried value → '—'.
 *   Upper bound: cursor past the union-extent max ts across all tags → '—'.
 *   bandsFromTrendData forward-fills every tag to the union max, not the
 *   per-tag last ts, so the per-tag bound is wrong for quiet / prev-only tags.
 *   Lower bound: cursor before this tag's first data or prev seed → '—'.
 * Raw + idle: last value when showLastWhenIdle, else '—'.
 */
function getLegendDisplayText(
  data: TrendData,
  tag: TagDef | undefined,
  tagId: number,
  cursorTsMs: number | null | undefined,
  showLastWhenIdle: boolean,
): string {
  if (data.type === 'aggregate') {
    const entry = data.series.get(tagId);
    if (!entry) return '—';
    const isBoolean = tag?.data_type === 'bool';

    let bucketIdx: number | undefined;
    if (cursorTsMs != null) {
      const startTimeMs = Number(data.startTime);
      const idx = Math.floor((cursorTsMs - startTimeMs) / data.bucketSMs);
      if (idx < 0 || idx >= data.n) return '—';
      bucketIdx = idx;
    }

    // v0.7 cache fallback: no bands — show single value.
    if (!entry.min || !entry.max) {
      const vals = entry.value;
      if (vals.length === 0) return '—';
      const idx = bucketIdx !== undefined
        ? bucketIdx
        : showLastWhenIdle ? vals.length - 1 : -1;
      if (idx < 0) return '—';
      return formatValue(vals[idx] ?? null, tag?.unit, isBoolean);
    }

    // v0.8: show max only — spread is already conveyed by the visible band height.
    const maxArr = entry.max;
    if (maxArr.length === 0) return '—';
    const idx = bucketIdx !== undefined
      ? bucketIdx
      : showLastWhenIdle ? maxArr.length - 1 : -1;
    if (idx < 0) return '—';
    return formatValue(maxArr[idx] ?? null, tag?.unit, isBoolean);
  }

  // Raw path: LOCF at cursorTsMs.
  const s = data.series.get(tagId);
  if (!s || (s.value.length === 0 && !s.prev)) return '—';
  const isBoolean = tag?.data_type === 'bool';

  if (cursorTsMs != null) {
    const cursorBigInt = BigInt(Math.round(cursorTsMs));
    // Upper bound: union extent across ALL tags. bandsFromTrendData forward-fills
    // every tag to the latest ts of any tag (including prev seeds), so bounding by
    // the per-tag last-ts is wrong for quiet tags and prev-only flat tags.
    let unionMaxTs: bigint | null = null;
    for (const [, entry] of data.series) {
      if (entry.prev && (unionMaxTs === null || entry.prev.ts > unionMaxTs)) {
        unionMaxTs = entry.prev.ts;
      }
      for (const t of entry.ts) {
        if (unionMaxTs === null || t > unionMaxTs) unionMaxTs = t;
      }
    }
    if (unionMaxTs === null || cursorBigInt > unionMaxTs) return '—';
    let lastVal: number | null = null;
    let seeded = false;
    if (s.prev && s.prev.ts <= cursorBigInt) {
      lastVal = s.prev.value;
      seeded = true;
    }
    for (let i = 0; i < s.ts.length; i++) {
      if (s.ts[i]! > cursorBigInt) break;
      lastVal = s.value[i] ?? null;
      seeded = true;
    }
    if (!seeded) return '—';
    return formatValue(lastVal, tag?.unit, isBoolean);
  }

  if (!s.value.length) return '—';
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
    flexGrow: 1,
  };

  const removeBtn: CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9ca3af',
    padding: '0 2px',
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
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

export function Legend({ tagIds, data, tagMap, selectedTagId, cursorTsMs, showLastWhenIdle, onSelect, onRemove }: LegendProps) {
  const { headerText } = deriveLegendContext(data.type, cursorTsMs, showLastWhenIdle);
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
            displayText={getLegendDisplayText(data, tag, tagId, cursorTsMs, showLastWhenIdle)}
            onSelect={() => onSelect(tagId)}
            onRemove={() => onRemove(tagId)}
          />
        );
      })}
    </div>
  );
}
