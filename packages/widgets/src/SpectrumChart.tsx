import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useLiveValue } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { withErrorBoundary } from './shared/withErrorBoundary.js';

export interface SpectrumChartProps {
  assetPath: string;
  label?: string;
  width?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
}

const DEFAULT_HEIGHT = 320;
const DEFAULT_WIDTH = 640;
const DEFAULT_Y_MIN = -1000;
const DEFAULT_Y_MAX = 1000;

type ScaleRange = { min: number; max: number };

interface BuildConfigOpts {
  width: number;
  height: number;
  unit: string | null;
  yMin: number;
  yMax: number;
  xScaleRef: MutableRefObject<ScaleRange | null>;
  yScaleRef: MutableRefObject<ScaleRange | null>;
  binCountRef: MutableRefObject<number>;
}

/**
 * Drag-to-zoom on both axes via a custom setSelect hook (uPlot's native
 * drag.setScale is disabled) — mirrors @caro/trend-chart's ref-backed range
 * function so a zoomed range survives the next live setData() push instead
 * of snapping back to the default range on every new spectrum capture.
 */
function buildConfig(opts: BuildConfigOpts): uPlot.Options {
  const { width, height, unit, yMin, yMax, xScaleRef, yScaleRef, binCountRef } = opts;

  const setSelectHook = (u: uPlot) => {
    if (u.select.width > 0) {
      const min = u.posToVal(u.select.left, 'x');
      const max = u.posToVal(u.select.left + u.select.width, 'x');
      xScaleRef.current = { min, max };
      u.setScale('x', { min, max });
    }
    if (u.select.height > 0) {
      // Pixel Y grows downward, so the top of the drag box is the larger value.
      const top = u.posToVal(u.select.top, 'y');
      const bottom = u.posToVal(u.select.top + u.select.height, 'y');
      yScaleRef.current = { min: Math.min(top, bottom), max: Math.max(top, bottom) };
      u.setScale('y', { min: Math.min(top, bottom), max: Math.max(top, bottom) });
    }
    u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  };

  const resetZoom = (u: uPlot) => {
    xScaleRef.current = null;
    yScaleRef.current = null;
    u.setScale('x', { min: 0, max: Math.max(binCountRef.current - 1, 1) });
    u.setScale('y', { min: yMin, max: yMax });
  };

  return {
    width,
    height,
    scales: {
      x: {
        time: false,
        auto: false,
        range: (_u, dataMin, dataMax) => {
          const s = xScaleRef.current;
          return s ? [s.min, s.max] : [dataMin, dataMax];
        },
      },
      y: {
        auto: false,
        range: () => {
          const s = yScaleRef.current;
          return s ? [s.min, s.max] : [yMin, yMax];
        },
      },
    },
    axes: [
      { label: 'Bin', stroke: '#6b7280', grid: { show: true } },
      { label: unit ?? undefined, stroke: '#6b7280', grid: { show: true } },
    ],
    series: [
      {},
      { stroke: '#4e79a7', width: 1.5, fill: 'rgba(78,121,167,0.15)', points: { show: false } },
    ],
    legend: { show: false },
    cursor: {
      drag: { x: true, y: true, setScale: false },
      bind: {
        dblclick: (u) => () => {
          resetZoom(u);
          return null;
        },
      },
    },
    hooks: { setSelect: [setSelectHook] },
  };
}

function SpectrumChartInner({
  assetPath,
  label,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  yMin = DEFAULT_Y_MIN,
  yMax = DEFAULT_Y_MAX,
}: SpectrumChartProps) {
  const tag = useSingleTag(assetPath, 'SpectrumChart');
  const lv = useLiveValue(tag.tag_id);
  const displayLabel = resolveLabel(assetPath, label);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const xScaleRef = useRef<ScaleRange | null>(null);
  const yScaleRef = useRef<ScaleRange | null>(null);
  const binCountRef = useRef(0);

  const badQuality = lv.value === null;
  const values = Array.isArray(lv.value) ? (lv.value as number[]) : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const u = new uPlot(
      buildConfig({ width, height, unit: tag.unit, yMin, yMax, xScaleRef, yScaleRef, binCountRef }),
      [[], []],
      container,
    );
    uplotRef.current = u;

    return () => {
      u.destroy();
      uplotRef.current = null;
    };
  }, [width, height, tag.unit, yMin, yMax]);

  useEffect(() => {
    binCountRef.current = values?.length ?? 0;
    const u = uplotRef.current;
    if (!u) return;
    if (!values) {
      u.setData([[], []]);
      return;
    }
    const bins = values.map((_, i) => i);
    u.setData([bins, values]);
  }, [values]);

  return (
    <div className="flex flex-col gap-1 self-start">
      <div className="flex flex-row items-center justify-between gap-3">
        <span className="text-xs text-gray-900 font-medium tracking-wide">{displayLabel}</span>
        {badQuality && <span className="text-xs text-red-600 font-mono">---</span>}
      </div>
      <div ref={containerRef} style={{ width, height }} />
    </div>
  );
}

export const SpectrumChart = withErrorBoundary(SpectrumChartInner);
