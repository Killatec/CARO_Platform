import 'uplot/dist/uPlot.min.css';
import uPlot from 'uplot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTagMap } from '@caro/hmi-context';
import type { TrendData } from './types.js';
import { Legend } from './Legend.js';
import { ResolutionIndicator } from './ResolutionIndicator.js';
import { Tooltip } from './Tooltip.js';
import { buildUplotConfig } from './render/uplotConfig.js';
import { seriesFromTrendData } from './render/seriesFromTrendData.js';

export interface TrendChartProps {
  data: TrendData;
  /** Effective tag list — container is responsible for filtering removed ids. */
  tagIds: number[];
  siteTimezone?: string;
  width?: number;
  height?: number;
  /** Initial X scale and live imperative updates (not in rebuild deps — see below). */
  xRange?: { startMs: bigint; endMs: bigint };
  /**
   * Called during pan (isFinal=false per frame) and at drag-end / wheel
   * (isFinal=true). Container uses isFinal to optionally flush the debounce.
   */
  onRangeChange?: (range: { startMs: bigint; endMs: bigint }, isFinal: boolean) => void;
  /** Called when the legend remove button is clicked for a tag. */
  onTagRemove?: (tagId: number) => void;
}

const WRAPPER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'monospace',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: 12,
  boxSizing: 'border-box',
};

const HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  marginBottom: 6,
  minHeight: 20,
};

export function TrendChart({
  data,
  tagIds,
  siteTimezone,
  width = 800,
  height = 400,
  xRange,
  onRangeChange,
  onTagRemove,
}: TrendChartProps) {
  const tagMap = useTagMap();

  // selectedTagId is pure UI state — stays in TrendChart.
  const [selectedTagId, setSelectedTagId] = useState<number>(() => tagIds[0] ?? 0);
  const [cursorState, setCursorState] = useState<{ idx: number; left: number; top: number } | null>(null);

  // If the selected tag was removed by the container, fall back to first remaining.
  const effectiveSelectedId = tagIds.includes(selectedTagId)
    ? selectedTagId
    : (tagIds[0] ?? 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // Stable refs so pan/zoom handlers never stale-close over props.
  const onRangeChangeRef = useRef(onRangeChange);
  const selectedTagIdRef = useRef(effectiveSelectedId);
  // Synchronised on every render (not a useEffect) so they're current when
  // the init hook's closures next fire.
  onRangeChangeRef.current = onRangeChange;
  selectedTagIdRef.current = effectiveSelectedId;

  // Capture the latest xRange for use in the rebuild effect without
  // making it a rebuild dep.
  const xRangeRef = useRef(xRange);
  xRangeRef.current = xRange;

  const onCursorChange = useCallback(
    (idx: number | null, left: number, top: number) => {
      if (idx === null || idx < 0) {
        setCursorState(null);
      } else {
        setCursorState({ idx, left, top });
      }
    },
    [],
  );

  // ── Rebuild uPlot when chart config or data changes ───────────────────────
  // NOTE: xRange is intentionally NOT in this dep list. It is handled by the
  // narrow imperative effect below so that pan/zoom never triggers a rebuild.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || tagIds.length === 0) {
      uplotRef.current?.destroy();
      uplotRef.current = null;
      return;
    }

    const { xs, ys } = seriesFromTrendData(data, tagIds);
    const uplotData: uPlot.AlignedData = [xs, ...ys] as uPlot.AlignedData;

    const config = buildUplotConfig({
      tagIds,
      selectedTagId: effectiveSelectedId,
      tagMap,
      width,
      height,
      siteTimezone,
      onCursorChange,
      initialXRange: xRangeRef.current,
    });

    uplotRef.current?.destroy();
    uplotRef.current = null;
    container.innerHTML = '';

    const u = new uPlot(config, uplotData, container);
    uplotRef.current = u;

    // ── Pan / Zoom listeners ───────────────────────────────────────────────
    const over = u.over;

    let dragStartClientX: number | null = null;
    let dragStartClientY: number | null = null;
    let dragStartXMin = 0;
    let dragStartXMax = 0;
    let dragStartYMin = 0;
    let dragStartYMax = 0;
    let isShiftDrag = false;

    const onMouseDown = (e: MouseEvent) => {
      const xScale = u.scales['x'];
      if (!xScale) return;
      dragStartClientX = e.clientX;
      dragStartClientY = e.clientY;
      dragStartXMin = xScale.min ?? 0;
      dragStartXMax = xScale.max ?? 0;
      isShiftDrag = e.shiftKey;
      if (isShiftDrag) {
        const key = `y_${selectedTagIdRef.current}`;
        const yScale = u.scales[key];
        dragStartYMin = yScale?.min ?? 0;
        dragStartYMax = yScale?.max ?? 0;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (dragStartClientX === null) return;
      const overW = over.clientWidth;
      const overH = over.clientHeight;

      if (isShiftDrag) {
        // Vertical pan on selected trace Y-scale.
        const key = `y_${selectedTagIdRef.current}`;
        const ySpan = dragStartYMax - dragStartYMin;
        if (overH === 0 || ySpan === 0) return;
        const dy = e.clientY - (dragStartClientY ?? 0);
        const dataDy = (dy / overH) * ySpan;
        u.setScale(key, { min: dragStartYMin + dataDy, max: dragStartYMax + dataDy });
        return;
      }

      // Horizontal pan.
      const xSpan = dragStartXMax - dragStartXMin;
      if (overW === 0) return;
      const dx = e.clientX - dragStartClientX;
      const dataDx = (dx / overW) * xSpan;
      const newMin = dragStartXMin - dataDx;
      const newMax = dragStartXMax - dataDx;
      u.setScale('x', { min: newMin, max: newMax });
      onRangeChangeRef.current?.(
        { startMs: BigInt(Math.round(newMin * 1000)), endMs: BigInt(Math.round(newMax * 1000)) },
        false,
      );
    };

    const onMouseUp = () => {
      if (dragStartClientX === null) return;
      if (!isShiftDrag) {
        const xScale = u.scales['x'];
        if (xScale) {
          const newMin = xScale.min ?? dragStartXMin;
          const newMax = xScale.max ?? dragStartXMax;
          onRangeChangeRef.current?.(
            { startMs: BigInt(Math.round(newMin * 1000)), endMs: BigInt(Math.round(newMax * 1000)) },
            true,
          );
        }
      }
      dragStartClientX = null;
      dragStartClientY = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const xScale = u.scales['x'];
      if (!xScale) return;

      if (e.shiftKey) {
        // Vertical zoom on selected trace Y-scale.
        const key = `y_${selectedTagIdRef.current}`;
        const yScale = u.scales[key];
        if (!yScale) return;
        const yMin = yScale.min ?? 0;
        const yMax = yScale.max ?? 1;
        const ySpan = yMax - yMin;
        const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
        const newYSpan = ySpan * factor;
        const overH = over.clientHeight;
        const cursorFrac = overH > 0 ? Math.max(0, Math.min(1, 1 - e.offsetY / overH)) : 0.5;
        const cursorY = yMin + cursorFrac * ySpan;
        u.setScale(key, { min: cursorY - cursorFrac * newYSpan, max: cursorY + (1 - cursorFrac) * newYSpan });
        return;
      }

      // Horizontal zoom anchored at cursor x.
      const xMin = xScale.min ?? 0;
      const xMax = xScale.max ?? 1;
      const xSpan = xMax - xMin;
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const newXSpan = xSpan * factor;
      const overW = over.clientWidth;
      const cursorFrac = overW > 0 ? Math.max(0, Math.min(1, e.offsetX / overW)) : 0.5;
      const cursorX = xMin + cursorFrac * xSpan;
      const newMin = cursorX - cursorFrac * newXSpan;
      const newMax = cursorX + (1 - cursorFrac) * newXSpan;
      u.setScale('x', { min: newMin, max: newMax });
      onRangeChangeRef.current?.(
        { startMs: BigInt(Math.round(newMin * 1000)), endMs: BigInt(Math.round(newMax * 1000)) },
        true,
      );
    };

    over.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    over.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      over.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      over.removeEventListener('wheel', onWheel);
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [data, tagIds, effectiveSelectedId, tagMap, width, height, siteTimezone, onCursorChange]);

  // ── Imperative X-scale update — does NOT rebuild uPlot ───────────────────
  useEffect(() => {
    if (!uplotRef.current || !xRange) return;
    uplotRef.current.setScale('x', {
      min: Number(xRange.startMs) / 1000,
      max: Number(xRange.endMs) / 1000,
    });
  }, [xRange]);

  // Compute chart bounds for tooltip snap.
  const [chartBounds, setChartBounds] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setChartBounds({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }, [width, height]);

  // Tooltip x position is relative to canvas container.
  const canvasBounds = canvasWrapRef.current?.getBoundingClientRect();
  const tooltipClientX = canvasBounds ? canvasBounds.left + (cursorState?.left ?? 0) : 0;
  const tooltipClientY = canvasBounds ? canvasBounds.top + (cursorState?.top ?? 0) : 0;

  // Memoised to avoid flickering on parent re-renders caused by xRange ticks.
  const legend = useMemo(() => (
    tagIds.length > 0 ? (
      <Legend
        tagIds={tagIds}
        data={data}
        tagMap={tagMap}
        selectedTagId={effectiveSelectedId}
        cursorIdx={cursorState?.idx}
        onSelect={setSelectedTagId}
        onRemove={tagId => onTagRemove?.(tagId)}
      />
    ) : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [tagIds, data, tagMap, effectiveSelectedId, cursorState?.idx, onTagRemove]);

  return (
    <div style={{ ...WRAPPER, width: width + 24 }} ref={canvasWrapRef}>
      <div style={HEADER}>
        <ResolutionIndicator data={data} />
      </div>
      <div ref={containerRef} />
      {cursorState !== null && tagIds.length > 0 && (
        <Tooltip
          cursorIdx={cursorState.idx}
          cursorClientX={tooltipClientX}
          cursorClientY={tooltipClientY}
          chartBounds={chartBounds}
          data={data}
          tagIds={tagIds}
          tagMap={tagMap}
          siteTimezone={siteTimezone}
        />
      )}
      {legend}
    </div>
  );
}
