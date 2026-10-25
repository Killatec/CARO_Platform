import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Button } from '@caro/ui';
import { useLiveValue } from '@caro/hmi-context';
import { useTagGroup } from './shared/useTagGroup.js';
import { resolveLabel } from './shared/utils.js';
import { withErrorBoundary } from './shared/withErrorBoundary.js';

export interface SpecAChartProps {
  /** Base path of the spectrum-analyser block, e.g. "RF1.SpecA". */
  assetPath: string;
  label?: string;
  height?: number;
}

// Statically defined per widget type — see useTagGroup.
const SPECA_CHART_CHILDREN = [
  'Spectrum',
  'Spec_Start',
  'Spec_Bin',
  'Spec_Trace_Ok',
  'Spec_Intk_Level_Mon',
  'Spec_Intk_Band_Mon',
  'Spec_Intk_Freq_Mon',
];

const DEFAULT_HEIGHT = 400;
const FALLBACK_WIDTH = 640;

// dBFS, not dBm. The array is int16 dB x 10 (0.1 dB resolution).
const Y_MIN = -110;
const Y_MAX = 0;
const DB_SCALE = 10;

const LIVE_STROKE = '#1e3a8a';
const OFFENDER_STROKE = '#dc2626';
// Low alpha: the zone is drawn over the traces, which must read through it.
const ZONE_FILL_DETECT = 'rgba(255, 0, 0, 0.10)';
const ZONE_FILL_GUARD = 'rgba(0, 176, 80, 0.12)';

export interface Trace {
  x: number[];
  y: number[];
}

/** One rectangle per entry, from `level` up to the top of the Y axis. */
export interface ZoneRect {
  x0: number;
  x1: number;
  fill: string;
}

export interface Zone {
  level: number;
  rects: ZoneRect[];
}

type ScaleRange = { min: number; max: number };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Builds a trace from one frame. The X axis comes from Spec_Start (MHz) and
 * Spec_Bin (Hz, the display bin), which the module publishes in the same frame
 * as the array. An empty array is how the module says "no frame" (it sends
 * Spec_Start/Spec_Bin as 0 then), so it — and a stalled (null) value — yield null.
 */
export function buildTrace(spectrum: unknown, specStart: unknown, specBin: unknown): Trace | null {
  const start = num(specStart);
  const bin = num(specBin);
  if (!Array.isArray(spectrum) || spectrum.length === 0 || start === null || bin === null || bin <= 0) {
    return null;
  }
  const n = spectrum.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    x[i] = start + (i * bin) / 1e6;
    y[i] = (spectrum[i] as number) / DB_SCALE;
  }
  return { x, y };
}

/**
 * The spectrum-interlock zone over the frame's range [x0, x1] (MHz): red
 * detection flanks either side of a green guard band of total width `band`
 * (kHz) centred on `centre` (MHz). A flank is omitted when the guard band runs
 * past that end of the frame; the guard band is clipped to the frame.
 */
export function buildZone(
  level: unknown,
  band: unknown,
  centre: unknown,
  x0: number,
  x1: number,
): Zone | null {
  const lvl = num(level);
  const bw = num(band);
  const c = num(centre);
  if (lvl === null || bw === null || c === null) return null;

  const lo = c - bw / 2000;
  const hi = c + bw / 2000;
  const rects: ZoneRect[] = [];
  if (lo > x0) rects.push({ x0, x1: lo, fill: ZONE_FILL_DETECT });
  if (hi < x1) rects.push({ x0: hi, x1, fill: ZONE_FILL_DETECT });
  const guardLo = Math.max(lo, x0);
  const guardHi = Math.min(hi, x1);
  if (guardHi > guardLo) rects.push({ x0: guardLo, x1: guardHi, fill: ZONE_FILL_GUARD });
  return { level: lvl, rects };
}

/** [x, live, offender] for uPlot. Two traces captured on different axes are merged onto one X. */
export function buildData(live: Trace | null, offender: Trace | null): uPlot.AlignedData {
  if (live && offender) {
    return uPlot.join([
      [live.x, live.y],
      [offender.x, offender.y],
    ]);
  }
  const t = live ?? offender;
  if (!t) return [[], [], []];
  const empty = new Array<null>(t.x.length).fill(null);
  return live ? [t.x, t.y, empty] : [t.x, empty, t.y];
}

interface BuildConfigOpts {
  width: number;
  height: number;
  xScaleRef: MutableRefObject<ScaleRange | null>;
  yScaleRef: MutableRefObject<ScaleRange | null>;
  zoneRef: MutableRefObject<Zone | null>;
}

/** Drag-to-zoom and double-click reset follow SpectrumChart's ref-backed scale pattern. */
function buildConfig(opts: BuildConfigOpts): uPlot.Options {
  const { width, height, xScaleRef, yScaleRef, zoneRef } = opts;

  const setSelectHook = (u: uPlot) => {
    if (u.select.width > 0) {
      const min = u.posToVal(u.select.left, 'x');
      const max = u.posToVal(u.select.left + u.select.width, 'x');
      xScaleRef.current = { min, max };
      u.setScale('x', { min, max });
    }
    if (u.select.height > 0) {
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
    const xs = u.data[0];
    if (xs.length > 0) u.setScale('x', { min: xs[0], max: xs[xs.length - 1] });
    u.setScale('y', { min: Y_MIN, max: Y_MAX });
  };

  // Drawn after the series, so the tint sits over the traces and gridlines.
  const drawZone = (u: uPlot) => {
    const zone = zoneRef.current;
    if (!zone || zone.rects.length === 0) return;
    const { ctx, bbox } = u;
    const yTop = u.valToPos(Y_MAX, 'y', true);
    const yLevel = u.valToPos(zone.level, 'y', true);
    ctx.save();
    ctx.beginPath();
    ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
    ctx.clip();
    for (const r of zone.rects) {
      const left = u.valToPos(r.x0, 'x', true);
      const right = u.valToPos(r.x1, 'x', true);
      ctx.fillStyle = r.fill;
      ctx.fillRect(left, yTop, right - left, yLevel - yTop);
    }
    ctx.restore();
  };

  return {
    width,
    height,
    scales: {
      x: {
        time: false,
        // Must be true: with auto false, setData() reuses the scale's current
        // min/max (null on a fresh mount) and the chart stays empty until a
        // double-click. auto true hands range() the data extent on every frame.
        auto: true,
        range: (_u, dataMin, dataMax) => {
          const s = xScaleRef.current;
          return s ? [s.min, s.max] : [dataMin, dataMax];
        },
      },
      y: {
        auto: false,
        range: () => {
          const s = yScaleRef.current;
          return s ? [s.min, s.max] : [Y_MIN, Y_MAX];
        },
      },
    },
    axes: [
      { label: 'MHz', stroke: '#6b7280', grid: { show: true } },
      { label: 'dBFS', stroke: '#6b7280', grid: { show: true } },
    ],
    series: [
      {},
      { label: 'Live', stroke: LIVE_STROKE, width: 1, spanGaps: true, points: { show: false } },
      { label: 'Offender', stroke: OFFENDER_STROKE, width: 1, spanGaps: true, points: { show: false } },
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
    hooks: { setSelect: [setSelectHook], draw: [drawZone] },
  };
}

/**
 * Frequency-mapped spectrum-analyser chart. Spec_Trace_Ok is only a colour: an
 * array with false replaces the red (offender) trace, any other replaces the
 * blue (live) one, and neither clears the other. RF_Control decides which
 * frames are red (it sends the first failing frame once). The offender keeps
 * the axis it was captured on and persists until Clear, which wipes both
 * traces in the browser only. The interlock zone is drawn while a frame is
 * present.
 */
function SpecAChartInner({ assetPath, label, height = DEFAULT_HEIGHT }: SpecAChartProps) {
  const tags = useTagGroup(assetPath, SPECA_CHART_CHILDREN, 'SpecAChart');
  const displayLabel = resolveLabel(assetPath, label);

  const spectrum = useLiveValue(tags['Spectrum'].tag_id).value;
  const specStart = useLiveValue(tags['Spec_Start'].tag_id).value;
  const specBin = useLiveValue(tags['Spec_Bin'].tag_id).value;
  const traceOk = useLiveValue(tags['Spec_Trace_Ok'].tag_id).value;
  const level = useLiveValue(tags['Spec_Intk_Level_Mon'].tag_id).value;
  const band = useLiveValue(tags['Spec_Intk_Band_Mon'].tag_id).value;
  const centre = useLiveValue(tags['Spec_Intk_Freq_Mon'].tag_id).value;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const xScaleRef = useRef<ScaleRange | null>(null);
  const yScaleRef = useRef<ScaleRange | null>(null);
  const zoneRef = useRef<Zone | null>(null);
  const liveRef = useRef<Trace | null>(null);
  const offenderRef = useRef<Trace | null>(null);
  const lastSpectrumRef = useRef<unknown>(undefined);
  const lastTraceOkRef = useRef<unknown>(undefined);

  const badQuality = spectrum === null;

  const pushData = () => {
    uplotRef.current?.setData(buildData(liveRef.current, offenderRef.current));
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const u = new uPlot(
      buildConfig({ width: container.clientWidth || FALLBACK_WIDTH, height, xScaleRef, yScaleRef, zoneRef }),
      buildData(liveRef.current, offenderRef.current),
      container,
    );
    uplotRef.current = u;

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        const w = container.clientWidth;
        if (w > 0) u.setSize({ width: w, height });
      });
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
      u.destroy();
      uplotRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const frame = buildTrace(spectrum, specStart, specBin);
    // Assign a trace only for a new array (or a late Spec_Trace_Ok for it), so
    // a zone-tag change cannot redraw a frame the operator just cleared.
    const isNewFrame = spectrum !== lastSpectrumRef.current || traceOk !== lastTraceOkRef.current;
    lastSpectrumRef.current = spectrum;
    lastTraceOkRef.current = traceOk;
    if (!frame) {
      // No frame: blank the live trace only — the offender is deliberately kept.
      liveRef.current = null;
      zoneRef.current = null;
    } else {
      // Spec_Trace_Ok is a colour only: false draws red, anything else blue.
      // Each array replaces only its own trace.
      if (isNewFrame) {
        if (traceOk === false) offenderRef.current = frame;
        else liveRef.current = frame;
      }
      const n = frame.x.length;
      const x0 = frame.x[0];
      const x1 = x0 + (n * (specBin as number)) / 1e6;
      zoneRef.current = buildZone(level, band, centre, x0, x1);
    }
    pushData();
  }, [spectrum, specStart, specBin, traceOk, level, band, centre]);

  const handleClear = () => {
    liveRef.current = null;
    offenderRef.current = null;
    pushData();
  };

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex flex-row items-center justify-between gap-3">
        <span className="text-xs text-gray-900 font-medium tracking-wide">{displayLabel}</span>
        <div className="flex flex-row items-center gap-3">
          {badQuality && <span className="text-xs text-red-600 font-mono">---</span>}
          <Button variant="secondary" className="px-2! py-0.5! text-xs" onClick={handleClear}>
            Clear
          </Button>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}

export const SpecAChart = withErrorBoundary(SpecAChartInner);
