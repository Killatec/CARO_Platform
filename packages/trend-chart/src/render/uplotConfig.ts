import uPlot from 'uplot';
import type { TagDef } from '@caro/hmi-context';
import { colorAssign } from '../colorAssign.js';
import { defaultYScale } from './yScales.js';
import { formatTimestamp } from './formatTimestamp.js';

export interface BuildUplotConfigOpts {
  tagIds: number[];
  selectedTagId: number;
  tagMap: Map<number, TagDef>;
  width: number;
  height: number;
  siteTimezone?: string;
  onCursorChange?: (idx: number | null, left: number, top: number) => void;
  /** Initial X scale in ms — sets the visible range when uPlot is first built. */
  initialXRange?: { startMs: bigint; endMs: bigint };
}

/**
 * Builds uPlot options for the trend chart.
 *
 * Per-trace named scales (y_<tagId>) are configured with engineering range or
 * autoscale per spec §8.1.1. Stepped interpolation + spanGaps: false per §8.3.
 * Only the selected trace's Y axis is visible.
 */
export function buildUplotConfig(opts: BuildUplotConfigOpts): uPlot.Options {
  const { tagIds, selectedTagId, tagMap, width, height, siteTimezone, onCursorChange, initialXRange } = opts;

  // Build named scale entries for each tag.
  const xScale: uPlot.Scale = initialXRange
    ? {
        time: true,
        range: [
          Number(initialXRange.startMs) / 1000,
          Number(initialXRange.endMs) / 1000,
        ],
      }
    : { time: true };
  const scales: uPlot.Options['scales'] = { x: xScale };
  for (const tagId of tagIds) {
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
      values: (_u, vals) =>
        vals.map(v => {
          if (v == null) return '';
          return formatTimestamp(v * 1000, siteTimezone);
        }),
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

  const hooks: uPlot.Hooks.Arrays = onCursorChange
    ? {
        setCursor: [
          (u) => {
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? 0;
            const idx = u.cursor.idx ?? null;
            if (left < 0) {
              onCursorChange(null, 0, 0);
            } else {
              onCursorChange(idx, left, top);
            }
          },
        ],
      }
    : {};

  return {
    width,
    height,
    scales,
    axes,
    series,
    hooks,
    cursor: {
      points: { show: true },
    },
  };
}
