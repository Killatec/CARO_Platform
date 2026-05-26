import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { TagDef } from '@caro/hmi-context';
import { formatDateTime } from '@caro/ui';
import type { TrendData } from './types.js';
import { colorAssign } from './colorAssign.js';
import { formatValue } from './render/formatValue.js';
import { BucketFetchIndicator } from './BucketFetchIndicator.js';

export interface LegendProps {
  tagIds: number[];
  data: TrendData;
  tagMap: Map<number, TagDef>;
  selectedTagId: number;
  /** Cursor X position in milliseconds from uPlot posToVal; null/absent means no cursor. */
  cursorTsMs?: number | null;
  /** IANA timezone for cursor timestamp formatting (e.g. "America/Chicago"). */
  siteTimezone?: string;
  /** Bucket width in ms; null in raw mode or before first fetch. */
  bucketSMs: bigint | null;
  /** Wall-clock ms of the most recent viewport-change batch; null until first batch. */
  lastFetchMs: number | null;
  /** When true (tailing), idle state shows the last bucket value. When false (fixed), idle state shows '--'. */
  showLastWhenIdle: boolean;
  onSelect: (tagId: number) => void;
  onRemove: (tagId: number) => void;
  /** Called when the gear icon in the Signals header is clicked. */
  onSettingsClick?: () => void;
}

const SWATCH_COL_PX = 18;
const REMOVE_COL_PX = 20;
const FONT_WIDTH_PX = 7.2;
const CELL_PAD_PX   = 8;
const MIN_CHARS = 4;
const MAX_INT_DIGITS = 8;

const STRIP: CSSProperties = {
  paddingLeft: 8,
  overflowY: 'auto',
  flexShrink: 0,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  color: '#374151',
  fontFamily: 'monospace',
  lineHeight: '16px',
};

const CURSOR_ROW: CSSProperties = { ...LABEL_STYLE, paddingLeft: 4, paddingBottom: 2 };
const HEADER_STYLE: CSSProperties = { ...LABEL_STYLE, paddingLeft: 4, paddingBottom: 2 };

const SIGNALS_HEADER: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingLeft: 4,
  paddingBottom: 6,
};

const GEAR_BTN: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#6b7280',
  padding: 0,
  lineHeight: 0,
};
const BUCKET_SECTION: CSSProperties = { marginTop: 12 };

const TABLE_STYLE: CSSProperties = {
  marginTop: 12,
  borderCollapse: 'collapse',
  tableLayout: 'auto',
  border: '1px solid #e5e7eb',
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
 * Computes the character count needed for the value column based on
 * eng_min, eng_max, format, and data_type — not from live data values.
 */
export function charsForTag(tag: TagDef | undefined): number {
  if (!tag) return MIN_CHARS;
  if (tag.data_type === 'bool') return 1;
  const engMax = Math.abs(tag.eng_max ?? 9999);
  const engMin = Math.abs(tag.eng_min ?? 9999);
  const maxAbs = Math.max(engMax, engMin, 1);
  const intDigits = Math.min(MAX_INT_DIGITS, Math.floor(Math.log10(maxAbs)) + 1);
  const m = tag.format ? /%[.](\d+)f/.exec(tag.format) : null;
  const decimals = m ? parseInt(m[1]!, 10) : 4;
  const sign = (tag.eng_min ?? 0) < 0 ? 1 : 0;
  const dot = decimals > 0 ? 1 : 0;
  return sign + intDigits + dot + decimals;
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
      return formatValue(vals[idx] ?? null, tag?.format, isBoolean);
    }

    // v0.8: show max only — spread is already conveyed by the visible band height.
    const maxArr = entry.max;
    if (maxArr.length === 0) return '—';
    const idx = bucketIdx !== undefined
      ? bucketIdx
      : showLastWhenIdle ? maxArr.length - 1 : -1;
    if (idx < 0) return '—';
    return formatValue(maxArr[idx] ?? null, tag?.format, isBoolean);
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
    return formatValue(lastVal, tag?.format, isBoolean);
  }

  if (!s.value.length) return '—';
  return showLastWhenIdle
    ? formatValue(s.value[s.value.length - 1] ?? null, tag?.format, isBoolean)
    : '—';
}

export function Legend({ tagIds, data, tagMap, selectedTagId, cursorTsMs, siteTimezone, bucketSMs, lastFetchMs, showLastWhenIdle, onSelect, onRemove, onSettingsClick }: LegendProps) {
  const { headerText } = deriveLegendContext(data.type, cursorTsMs, showLastWhenIdle);

  const valueColPx = useMemo(() => {
    const maxChars = tagIds.reduce((max, id) => {
      const c = charsForTag(tagMap.get(id));
      return c > max ? c : max;
    }, MIN_CHARS);
    return Math.ceil(maxChars * FONT_WIDTH_PX) + CELL_PAD_PX * 2;
  }, [tagIds, tagMap]);

  return (
    <div style={STRIP}>
      <div style={SIGNALS_HEADER}>
        <span style={LABEL_STYLE}>Signals</span>
        <button
          onClick={onSettingsClick}
          title="Configure signals"
          style={GEAR_BTN}
          aria-label="Configure signals"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
        </button>
      </div>
      <div style={CURSOR_ROW}>
        Cursor: {cursorTsMs == null ? '--' : formatDateTime(cursorTsMs, { timezone: siteTimezone })}
      </div>
      <div style={HEADER_STYLE}>{headerText}</div>
      <table style={TABLE_STYLE}>
        <colgroup>
          <col style={{ width: SWATCH_COL_PX }} />
          <col />
          <col style={{ width: valueColPx }} />
          <col />
          <col style={{ width: REMOVE_COL_PX }} />
        </colgroup>
        <tbody>
          {tagIds.map(tagId => {
            const tag = tagMap.get(tagId);
            const tagName = tag?.tag_name ?? `Tag-${tagId}`;
            const color = colorAssign(tagId);
            const isSelected = tagId === selectedTagId;
            const displayText = getLegendDisplayText(data, tag, tagId, cursorTsMs, showLastWhenIdle);

            const rowStyle: CSSProperties = {
              cursor: 'pointer',
              background: isSelected ? '#f9fafb' : '#fff',
              borderBottom: '1px solid #e5e7eb',
              ...(isSelected && { outline: `1px solid ${color}`, outlineOffset: -1 }),
              userSelect: 'none',
            };

            const cellBase: CSSProperties = {
              padding: `4px ${CELL_PAD_PX}px`,
              fontSize: 12,
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            };

            const swatchStyle: CSSProperties = {
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 2,
              background: color,
              border: isSelected ? `2px solid ${color}` : 'none',
              boxSizing: 'border-box',
              verticalAlign: 'middle',
            };

            const nameStyle: CSSProperties = {
              ...cellBase,
              fontWeight: isSelected ? 700 : 400,
              color: '#111827',
            };

            const valueStyle: CSSProperties = {
              ...cellBase,
              color: '#374151',
              textAlign: 'right',
              width: valueColPx,
            };

            const unitStyle: CSSProperties = {
              ...cellBase,
              color: '#6b7280',
              paddingLeft: 4,
            };

            const removeCellStyle: CSSProperties = {
              padding: '0 2px',
              width: REMOVE_COL_PX,
              textAlign: 'center',
            };

            const removeBtn: CSSProperties = {
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9ca3af',
              padding: '0 2px',
              fontSize: 14,
              lineHeight: 1,
            };

            return (
              <tr
                key={tagId}
                style={rowStyle}
                onClick={() => onSelect(tagId)}
                title={tag?.tag_path ?? String(tagId)}
              >
                <td style={{ ...cellBase, padding: `4px ${CELL_PAD_PX}px` }}>
                  <div style={swatchStyle} />
                </td>
                <td style={nameStyle}>{tagName}</td>
                <td style={valueStyle}>{displayText}</td>
                <td style={unitStyle}>{tag?.unit ?? ''}</td>
                <td style={removeCellStyle}>
                  <button
                    style={removeBtn}
                    onClick={e => { e.stopPropagation(); onRemove(tagId); }}
                    title="Remove trace"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={BUCKET_SECTION}>
        <BucketFetchIndicator bucketSMs={bucketSMs} lastFetchMs={lastFetchMs} />
      </div>
    </div>
  );
}
