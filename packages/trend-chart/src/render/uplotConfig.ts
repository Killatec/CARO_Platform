import uPlot from 'uplot';
import type { MutableRefObject } from 'react';
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
   * Ref holding the last user-requested X scale range. The range function
   * reads this to return the requested min/max rather than data extent,
   * preventing uPlot from clamping setScale calls to the data range.
   */
  userScaleRef?: MutableRefObject<{ min: number; max: number } | null>;
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
 * Always registers two series per tag (min + max) and a bands[] config.
 *
 * Aggregate mode: mins/maxs are real bucket extremes → visible filled band.
 * Raw mode: mins[i] === maxs[i] (same value array) → zero-area band; only the
 *   max-series 1px stroke is visible, rendering the stepped COV line.
 *
 * Selected trace: fill α=0.6, stroke α=0.8, width 2. Non-selected: fill α=0.25, stroke α=0.4, width 1.5.
 * Both min and max series draw the same stroke so both band edges are visible.
 * This contrast applies uniformly to both aggregate bands and raw stepped lines.
 */
export function buildUplotConfig(opts: BuildUplotConfigOpts): uPlot.Options {
  const { tagIds, selectedTagId, tagMap, width, height, siteTimezone, onCursorChange, yScaleOverrides, onDragZoom, userScaleRef } = opts;

  // Named scale entries — one per tag, shared by both band series.
  // range: returns userScaleRef values when set, so setScale requests aren't
  // clamped to the data extent by uPlot's default range computation.
  const xScale: uPlot.Scale = {
    time: true,
    auto: false,
    range: (_u, dataMin, dataMax) => {
      const userScale = userScaleRef?.current;
      if (userScale != null) return [userScale.min, userScale.max];
      return [dataMin, dataMax];
    },
  };
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

  // Always-band: 2 series per tag (min bottom edge + max top edge) + bands[] fill config.
  // Aggregate: band is visible (min < max). Raw: min === max → zero-area band, stroke draws the line.
  const bandSeriesArr: uPlot.Series[] = [];
  const bandsArr: uPlot.Band[] = [];

  tagIds.forEach((tagId, i) => {
    const color = colorAssign(tagId);
    const isSelected = tagId === selectedTagId;
    const fillAlpha   = isSelected ? 0.6  : 0.25;
    const strokeAlpha = isSelected ? 0.8  : 0.4;
    const strokeWidth = isSelected ? 2    : 1.5;

    // series[0] is X placeholder; min is at 1 + i*2, max is at 1 + i*2 + 1.
    const minSeriesIdx = 1 + i * 2;
    const maxSeriesIdx = 1 + i * 2 + 1;

    // Min series: bottom edge — same stroke as max so both band edges are visible.
    // NOTE: width must NOT be 0. uPlot skips _paths computation for zero-width
    // series, which prevents _paths.band from being generated. The band fill
    // polygon requires both referenced series to have computed paths.
    bandSeriesArr.push({
      scale: `y_${tagId}`,
      stroke: hexToRgba(color, strokeAlpha),
      fill: 'transparent',
      width: strokeWidth,
      spanGaps: false,
      paths: uPlot.paths.stepped!({ align: 1 }),
    } satisfies uPlot.Series);

    // Max series: top edge — stroke renders the line when band is zero-area (raw).
    bandSeriesArr.push({
      scale: `y_${tagId}`,
      stroke: hexToRgba(color, strokeAlpha),
      fill: 'transparent',
      width: strokeWidth,
      spanGaps: false,
      paths: uPlot.paths.stepped!({ align: 1 }),
    } satisfies uPlot.Series);

    // uPlot convention: series[0] = upper/"from" edge (max), series[1] = lower/"to" edge (min).
    // Fill goes downward from max; min provides the upward clip. Inversion → empty band.
    bandsArr.push({
      series: [maxSeriesIdx, minSeriesIdx],
      fill: hexToRgba(color, fillAlpha),
    } satisfies uPlot.Band);
  });

  const series: uPlot.Series[] = [{}, ...bandSeriesArr];
  const bands: uPlot.Band[] = bandsArr;

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
