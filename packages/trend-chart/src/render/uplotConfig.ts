import uPlot from 'uplot';
import type { TagDef } from '@caro/hmi-context';
import { colorAssign } from '../colorAssign.js';
import { defaultYScale } from './yScales.js';
import { formatTickLabel } from './formatTickLabel.js';

export interface BuildUplotConfigOpts {
  tagIds: number[];
  selectedTagId: number;
  tagMap: Map<number, TagDef>;
  width: number;
  height: number;
  siteTimezone?: string;
  onCursorChange?: (idx: number | null, tsMs: number | null) => void;
  /** User-applied Y-scale overrides that survive rebuilds. Keyed by tagId. */
  yScaleOverrides?: Map<number, { min: number; max: number }>;
  /** Called when the user completes a drag-zoom selection on the plot area. */
  onDragZoom?: (startMs: bigint, endMs: bigint) => void;
  /**
   * When true, registers two band series per tag (min + max) with filled area
   * between them. Raw mode (false/absent) registers one stepped value line per tag.
   */
  isAggregate?: boolean;
}

/** Parse a hex color like '#4e79a7' into rgba(r,g,b,alpha). */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Builds uPlot options for the trend chart.
 *
 * Aggregate mode: two series per tag (min / max) drawn as a filled band.
 *   Selected band fill α=0.5, stroke α=0.8; non-selected α=0.15 / α=0.4.
 * Raw mode: one stepped value line per tag (existing behavior).
 * Only the selected trace's Y axis is visible in both modes.
 */
export function buildUplotConfig(opts: BuildUplotConfigOpts): uPlot.Options {
  const { tagIds, selectedTagId, tagMap, width, height, siteTimezone, onCursorChange, yScaleOverrides, onDragZoom, isAggregate } = opts;

  // Named scale entries — one per tag, shared by both band series (aggregate) and value series (raw).
  const xScale: uPlot.Scale = { time: true, auto: false };
  const scales: uPlot.Options['scales'] = { x: xScale };
  for (const tagId of tagIds) {
    const override = yScaleOverrides?.get(tagId);
    if (override) {
      scales[`y_${tagId}`] = { auto: false, range: [override.min, override.max] };
      continue;
    }
    const tag = tagMap.get(tagId);
    const yRange = tag ? defaultYScale(tag) : null;
    scales[`y_${tagId}`] = yRange
      ? { auto: false, range: yRange }
      : { auto: true };
  }

  const selectedTag = tagMap.get(selectedTagId);
  const selectedColor = colorAssign(selectedTagId);
  const selectedUnit = selectedTag?.unit ?? '';

  const axes: uPlot.Axis[] = [
    {
      scale: 'x',
      space: 150,
      values: (_u, vals, _axisIdx, _foundSpace, _foundIncr) => {
        const incrSec = vals.length >= 2 ? Math.abs(vals[1]! - vals[0]!) : 60;
        return vals.map((v, i) => {
          if (v == null) return '';
          const prevMs = i > 0 && vals[i - 1] != null ? vals[i - 1]! * 1000 : undefined;
          return formatTickLabel(v * 1000, siteTimezone, incrSec, prevMs);
        });
      },
    },
    {
      scale: `y_${selectedTagId}`,
      label: selectedUnit || undefined,
      stroke: selectedColor,
      grid: { show: true },
      ticks: { show: true },
    },
  ];

  let series: uPlot.Series[];
  let bands: uPlot.Band[] | undefined;

  if (isAggregate) {
    // Two series per tag: min (bottom edge, no stroke) + max (top edge, thin stroke).
    // uPlot fills the region between them via the bands config.
    const bandSeriesArr: uPlot.Series[] = [];
    const bandsArr: uPlot.Band[] = [];

    tagIds.forEach((tagId, i) => {
      const color = colorAssign(tagId);
      const isSelected = tagId === selectedTagId;
      const fillAlpha   = isSelected ? 0.5  : 0.15;
      const strokeAlpha = isSelected ? 0.8  : 0.4;

      // series[0] is X; min is at 1+i*2, max is at 1+i*2+1.
      const minSeriesIdx = 1 + i * 2;
      const maxSeriesIdx = 1 + i * 2 + 1;

      // Min series: bottom edge — no visible stroke.
      bandSeriesArr.push({
        scale: `y_${tagId}`,
        stroke: 'transparent',
        fill: 'transparent',
        width: 0,
        points: { show: false },
        spanGaps: false,
        paths: uPlot.paths.stepped!({ align: 1 }),
      } satisfies uPlot.Series);

      // Max series: top edge — thin stroke so collapsed (min===max) bands stay visible.
      bandSeriesArr.push({
        scale: `y_${tagId}`,
        stroke: hexToRgba(color, strokeAlpha),
        fill: 'transparent',
        width: 1,
        points: { show: false },
        spanGaps: false,
        paths: uPlot.paths.stepped!({ align: 1 }),
      } satisfies uPlot.Series);

      bandsArr.push({
        series: [minSeriesIdx, maxSeriesIdx],
        fill: hexToRgba(color, fillAlpha),
      } satisfies uPlot.Band);
    });

    series = [{}, ...bandSeriesArr];
    bands = bandsArr;
  } else {
    // Raw mode: one stepped value line per tag.
    series = [
      {},
      ...tagIds.map(tagId => {
        const color = colorAssign(tagId);
        const tag = tagMap.get(tagId);
        const isSelected = tagId === selectedTagId;
        return {
          label: tag?.tag_path ?? String(tagId),
          scale: `y_${tagId}`,
          stroke: color,
          width: isSelected ? 2 : 1.5,
          alpha: isSelected ? 1.0 : 0.55,
          spanGaps: false,
          paths: uPlot.paths.stepped!({ align: 1 }),
        } satisfies uPlot.Series;
      }),
    ];
  }

  const setSelectHook = (u: uPlot) => {
    if (u.select.width <= 0) return;
    const minSec = u.posToVal(u.select.left, 'x');
    const maxSec = u.posToVal(u.select.left + u.select.width, 'x');
    u.setScale('x', { min: minSec, max: maxSec });
    const minMs = BigInt(Math.round(minSec * 1000));
    const maxMs = BigInt(Math.round(maxSec * 1000));
    onDragZoom?.(minMs, maxMs);
    u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  };

  const hooks: uPlot.Hooks.Arrays = {
    ...(onCursorChange
      ? {
          setCursor: [
            (u) => {
              const left = u.cursor.left ?? -1;
              const idx = u.cursor.idx ?? null;
              if (left < 0 || idx == null) {
                onCursorChange(null, null);
                return;
              }
              const tsSec = u.data[0]?.[idx];
              const tsMs = tsSec != null ? Number(tsSec) * 1000 : null;
              onCursorChange(idx, tsMs);
            },
          ],
        }
      : {}),
    setSelect: [setSelectHook],
  };

  return {
    width,
    height,
    scales,
    axes,
    series,
    bands,
    hooks,
    cursor: {
      points: { show: true },
      bind: {
        dblclick: () => null,
      },
      drag: {
        x: true,
        y: false,
        setScale: false,
      },
    },
    legend: { show: false },
  };
}
