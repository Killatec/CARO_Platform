import uPlot from 'uplot';
import type { TagDef } from '@caro/hmi-context';
import { colorAssign } from '../colorAssign.js';
import { defaultYScale } from './yScales.js';
import { formatTimestamp, formatTickLabel } from './formatTimestamp.js';

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
}

/**
 * Builds uPlot options for the trend chart.
 *
 * Per-trace named scales (y_<tagId>) are configured with engineering range or
 * autoscale per spec §8.1.1. Stepped interpolation + spanGaps: false per §8.3.
 * Only the selected trace's Y axis is visible.
 */
export function buildUplotConfig(opts: BuildUplotConfigOpts): uPlot.Options {
  const { tagIds, selectedTagId, tagMap, width, height, siteTimezone, onCursorChange, yScaleOverrides, onDragZoom } = opts;

  // Build named scale entries for each tag.
  // X scale has no static range — the caller applies the initial range via setScale
  // immediately after construction so that uPlot never stores a permanent range constraint
  // (a static range array is wrapped by uPlot as a constraint that overrides setScale).
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

  // X axis + one visible Y axis for the selected trace.
  const axes: uPlot.Axis[] = [
    {
      scale: 'x',
      space: 150,
      values: (_u, vals, _axisIdx, _foundSpace, _foundIncr) => {
        const incrSec = vals.length >= 2 ? Math.abs(vals[1]! - vals[0]!) : 60;
        return vals.map(v => v == null ? '' : formatTickLabel(v * 1000, siteTimezone, incrSec));
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

  const series: uPlot.Series[] = [
    // index 0 is the X series in uPlot.
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
    hooks,
    cursor: {
      points: { show: true },
      bind: {
        dblclick: () => null,  // Disable uPlot's default fit-to-data on double-click.
      },
      drag: {
        x: true,
        y: false,
        setScale: false,  // we handle scale application manually in setSelect hook
      },
    },
    // Suppress uPlot's built-in legend table; we render our own <Legend> strip.
    legend: { show: false },
  };
}
