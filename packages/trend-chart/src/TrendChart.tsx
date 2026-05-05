import 'uplot/dist/uPlot.min.css';
import uPlot from 'uplot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTagMap } from '@caro/hmi-context';
import type { TrendData } from './types.js';
import type { LastIntent } from './useTrendMode.js';
import { Legend } from './Legend.js';
import {
  pruneRemovedTagOverrides,
  isInYAxisHitZone,
  panYScale,
  zoomYScale,
  panThresholdCheck,
  isInXAxisHitZone,
  panXScale,
  zoomXScale,
  checkAndExtendXCoverage,
} from './axisInteractions.js';
import { buildUplotConfig } from './render/uplotConfig.js';
import { seriesFromTrendData } from './render/seriesFromTrendData.js';
import { bandsFromTrendData } from './render/bandsFromTrendData.js';
import { computeZoomLevelTransition } from './level.js';

export interface TrendChartProps {
  data: TrendData;
  /** Effective tag list — container is responsible for filtering removed ids. */
  tagIds: number[];
  siteTimezone?: string;
  height?: number;
  /** Initial X scale and live imperative updates (not in rebuild deps — see below). */
  xRange?: { startMs: bigint; endMs: bigint };
  /** Called when the legend remove button is clicked for a tag. */
  onTagRemove?: (tagId: number) => void;
  /** Triggers background prefetch when the visible window approaches the cached extent. */
  ensureCovered?: (startMs: bigint, endMs: bigint) => void;
  /** Visible span (ms) at which the current zoom level was last set. Used by the wheel handler to detect 1.5× threshold crossings. */
  zoomAnchorSpan?: bigint;
  /** Called when continuous wheel-zoom crosses the 1.5× threshold. Container responds by switching bucket size and dataViewport. */
  onZoomLevelSwitch?: (direction: 'in' | 'out', cursorTimeMs: bigint) => void;
  /** Incremented by useTrendData each time performSwap completes. Triggers a single post-swap coverage check. */
  swapCounter?: number;
  /** Current active-tile count from useTrendData. Used in the setData log. */
  activeTileCount?: number;
  /** Called when the user completes a drag-zoom selection. Container snaps to nearest discrete level. */
  onDragZoom?: (startMs: bigint, endMs: bigint) => void;
  /** Rendered inside the left column, below the canvas. Sized to canvas width by the flex column. */
  footer?: ReactNode;
  /** Called whenever the cursor timestamp changes (or becomes null on leave). */
  onCursorTsChange?: (tsMs: number | null) => void;
  /** When true (tailing), Legend shows last bucket at rest; when false (fixed), shows '--'. Defaults to true. */
  showLastWhenIdle?: boolean;
  /** Called after every wheel X-scale mutation with the post-mutation range in ms. */
  onXRangeChange?: (min: bigint, max: bigint) => void;
  /** Called after every X-axis pan setScale with the post-pan range in ms. */
  onXPan?: (min: bigint, max: bigint) => void;
  /** When 'zoom' or 'pan', the imperative setScale effect is skipped so wheel/pan don't fight modeViewport updates. */
  lastIntent?: LastIntent;
}

const WRAPPER: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 12,
  width: '100%',
  fontFamily: 'monospace',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: 12,
  boxSizing: 'border-box',
};

const LEFT_COLUMN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
};


export function TrendChart({
  data,
  tagIds,
  siteTimezone,
  height = 400,
  xRange,
  onTagRemove,
  ensureCovered,
  zoomAnchorSpan,
  onZoomLevelSwitch,
  swapCounter,
  activeTileCount,
  onDragZoom,
  footer,
  onCursorTsChange,
  showLastWhenIdle = true,
  onXRangeChange,
  onXPan,
  lastIntent,
}: TrendChartProps) {
  const tagMap = useTagMap();

  // selectedTagId is pure UI state — stays in TrendChart.
  const [selectedTagId, setSelectedTagId] = useState<number>(() => tagIds[0] ?? 0);
  const [cursorState, setCursorState] = useState<{ idx: number; tsMs: number | null } | null>(null);

  // If the selected tag was removed by the container, fall back to first remaining.
  const effectiveSelectedId = tagIds.includes(selectedTagId)
    ? selectedTagId
    : (tagIds[0] ?? 0);

  const [plotInset, setPlotInset] = useState<{ left: number; right: number }>({ left: 0, right: 0 });

  // Incremented when the first ResizeObserver measurement arrives (or jsdom fallback).
  // Triggers the initial uPlot build without including measuredWidthRef in rebuild deps.
  const [rebuildToken, setRebuildToken] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  // Holds the latest measured LEFT_COLUMN width. Updated imperatively by ResizeObserver;
  // never stored in state so resizes don't trigger React re-renders / rebuilds.
  const measuredWidthRef = useRef(0);
  // Always-fresh height for use in the ResizeObserver callback closure.
  const heightRef = useRef(height);
  heightRef.current = height;

  // Captured in cleanup, consumed on next effect body — preserves user X-zoom across rebuilds.
  const preservedXRangeRef = useRef<{ min: number; max: number } | null>(null);
  // Persists user Y-axis pan/zoom across rebuilds. Keyed by tagId.
  // Ref (not state) so handler writes don't trigger re-renders.
  const yScaleOverridesRef = useRef<Map<number, { min: number; max: number }>>(new Map());

  // Stable ref so pan/zoom handlers never stale-close over effectiveSelectedId.
  const selectedTagIdRef = useRef(effectiveSelectedId);
  selectedTagIdRef.current = effectiveSelectedId;

  // Capture the latest xRange for use in the rebuild effect without
  // making it a rebuild dep.
  const xRangeRef = useRef(xRange);
  xRangeRef.current = xRange;

  // Stable ref so onXMove never stale-closes over ensureCovered.
  const ensureCoveredRef = useRef(ensureCovered);
  ensureCoveredRef.current = ensureCovered;

  // Stable refs for zoom-level switch — updated each render so the wheel handler never stale-closes.
  const zoomAnchorSpanRef = useRef(zoomAnchorSpan);
  const onZoomLevelSwitchRef = useRef(onZoomLevelSwitch);
  zoomAnchorSpanRef.current = zoomAnchorSpan;
  onZoomLevelSwitchRef.current = onZoomLevelSwitch;

  const onDragZoomRef = useRef(onDragZoom);
  onDragZoomRef.current = onDragZoom;

  const onCursorTsChangeRef = useRef(onCursorTsChange);
  onCursorTsChangeRef.current = onCursorTsChange;

  const onXRangeChangeRef = useRef(onXRangeChange);
  onXRangeChangeRef.current = onXRangeChange;

  const onXPanRef = useRef(onXPan);
  onXPanRef.current = onXPan;

  const lastIntentRef = useRef(lastIntent);
  lastIntentRef.current = lastIntent;

  const onCursorChange = useCallback(
    (idx: number | null, tsMs: number | null) => {
      if (idx === null || idx < 0) {
        setCursorState(null);
        onCursorTsChangeRef.current?.(null);
      } else {
        setCursorState({ idx, tsMs });
        onCursorTsChangeRef.current?.(tsMs);
      }
    },
    [],
  );

  // ── ResizeObserver: measures LEFT_COLUMN width ────────────────────────────
  // On first fire → sets measuredWidthRef and increments rebuildToken to trigger
  // the initial uPlot build. On subsequent fires → calls setSize directly (no rebuild).
  useEffect(() => {
    const el = leftColRef.current;
    if (!el) return;

    if (typeof ResizeObserver === 'undefined') {
      // jsdom fallback: use placeholder width so tests can create uPlot.
      measuredWidthRef.current = 800;
      setRebuildToken(t => t + 1);
      return;
    }

    let insetRafId = 0;

    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0]!.contentRect.width);
      if (w <= 0) return;
      const isFirst = measuredWidthRef.current === 0;
      measuredWidthRef.current = w;

      if (uplotRef.current) {
        // Resize existing instance in place — no rebuild, no state update.
        uplotRef.current.setSize({ width: w, height: heightRef.current });
        cancelAnimationFrame(insetRafId);
        insetRafId = requestAnimationFrame(() => {
          const c = containerRef.current;
          if (!c || !uplotRef.current) return;
          const cRect = c.getBoundingClientRect();
          const oRect = uplotRef.current.over.getBoundingClientRect();
          setPlotInset({ left: oRect.left - cRect.left, right: cRect.right - oRect.right });
        });
      } else if (isFirst) {
        // First measurement, uPlot not built yet — trigger the rebuild effect.
        setRebuildToken(t => t + 1);
      }
    });

    ro.observe(el);
    return () => {
      cancelAnimationFrame(insetRafId);
      ro.disconnect();
    };
  }, []);

  // ── Rebuild uPlot when chart config changes ───────────────────────────────
  // NOTE: xRange is intentionally NOT in this dep list — handled by the narrow
  // imperative effect below so pan/zoom never triggers a rebuild.
  // measuredWidthRef is also NOT a dep — it's a ref. rebuildToken triggers the
  // initial build when the first ResizeObserver measurement arrives.
  useEffect(() => {
    const container = containerRef.current;
    const width = measuredWidthRef.current;

    if (!container || tagIds.length === 0 || width === 0) {
      uplotRef.current?.destroy();
      uplotRef.current = null;
      return;
    }

    const isAggregate = data.type === 'aggregate';
    let uplotData: uPlot.AlignedData;
    if (isAggregate) {
      const bands = bandsFromTrendData(data, tagIds)!;
      const interleaved: (number | null)[][] = [];
      for (let i = 0; i < tagIds.length; i++) {
        interleaved.push(bands.mins[i]!);
        interleaved.push(bands.maxs[i]!);
      }
      uplotData = [bands.xs, ...interleaved] as uPlot.AlignedData;
    } else {
      const { xs, ys } = seriesFromTrendData(data, tagIds);
      uplotData = [xs, ...ys] as uPlot.AlignedData;
    }

    const config = buildUplotConfig({
      tagIds,
      selectedTagId: effectiveSelectedId,
      tagMap,
      width,
      height,
      siteTimezone,
      onCursorChange,
      yScaleOverrides: yScaleOverridesRef.current,
      onDragZoom: (s, e) => onDragZoomRef.current?.(s, e),
      isAggregate,
    });

    // Old instance was destroyed in cleanup; preservedXRangeRef was written there.
    container.innerHTML = '';

    const u = new uPlot(config, uplotData, container);
    uplotRef.current = u;

    // Measure plot area after uPlot's layout frame — u.over has zero width synchronously.
    let insetRafId = requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c || !uplotRef.current) return;
      const cRect = c.getBoundingClientRect();
      const oRect = uplotRef.current.over.getBoundingClientRect();
      setPlotInset({ left: oRect.left - cRect.left, right: cRect.right - oRect.right });
    });

    // Consume the X range captured in cleanup. Null on first mount → fall back to prop.
    const preservedXRange = preservedXRangeRef.current;
    preservedXRangeRef.current = null;

    if (preservedXRange) {
      u.setScale('x', preservedXRange);
    } else if (xRangeRef.current) {
      u.setScale('x', {
        min: Number(xRangeRef.current.startMs) / 1000,
        max: Number(xRangeRef.current.endMs) / 1000,
      });
    }

    // ── Y-axis hover: vertical pan / zoom ─────────────────────────────────────
    // Hit zone: the strip left of u.over (Y-axis labels), full height of u.over.
    // Wheel in zone → zoom selected Y scale. Left-drag in zone → pan selected Y scale.
    // No keyboard modifier required. Other Y scales and the X axis are unaffected.
    const wrap = container;
    let yDragStart: { clientY: number; minY: number; maxY: number } | null = null;
    let inYZone = false;
    let xDragStart: { clientX: number; minX: number; maxX: number } | null = null;
    let inXZone = false;

    // Single cursor-state resolver: X drag/zone wins over Y; both off → default.
    const updateCursor = () => {
      if (xDragStart !== null || inXZone) wrap.style.cursor = 'ew-resize';
      else if (yDragStart !== null || inYZone) wrap.style.cursor = 'ns-resize';
      else wrap.style.cursor = '';
    };

    const onYMove = (e: MouseEvent) => {
      const wasInYZone = inYZone;
      inYZone = isInYAxisHitZone(u, e.clientX, e.clientY);
      if (inYZone !== wasInYZone) updateCursor();
      if (yDragStart !== null) {
        const key = `y_${selectedTagIdRef.current}`;
        const overH = u.over.clientHeight;
        const dyPx = e.clientY - yDragStart.clientY;
        const span = yDragStart.maxY - yDragStart.minY;
        if (overH === 0 || span === 0) return;
        const dataDy = (dyPx / overH) * span;
        u.setScale(key, { min: yDragStart.minY + dataDy, max: yDragStart.maxY + dataDy });
        const sc = u.scales[key];
        if (sc?.min != null && sc?.max != null) {
          yScaleOverridesRef.current.set(selectedTagIdRef.current, { min: sc.min, max: sc.max });
        }
      }
    };

    const onYDown = (e: MouseEvent) => {
      if (!inYZone || e.button !== 0) return;
      const key = `y_${selectedTagIdRef.current}`;
      const yScale = u.scales[key];
      if (!yScale) return;
      yDragStart = {
        clientY: e.clientY,
        minY: yScale.min ?? 0,
        maxY: yScale.max ?? 1,
      };
      e.preventDefault();
    };

    const onYUp = () => {
      yDragStart = null;
      updateCursor();
    };

    const onYWheel = (e: WheelEvent) => {
      if (!inYZone) return;
      e.preventDefault();
      const key = `y_${selectedTagIdRef.current}`;
      const r = u.over.getBoundingClientRect();
      zoomYScale(u, key, e.deltaY, e.clientY - r.top, u.over.clientHeight);
      const sc = u.scales[key];
      if (sc?.min != null && sc?.max != null) {
        yScaleOverridesRef.current.set(selectedTagIdRef.current, { min: sc.min, max: sc.max });
      }
    };

    // ── X-axis hover: horizontal pan (visual-only, no refetch) ────────────────
    // Hit zone: the strip below u.over (X-axis labels), full plot width.
    // Left-drag → translates X scale. No wheel (future). No onRangeChange call —
    // the pan is ephemeral; preset / Live / Custom resets it via the imperative effect.
    const onXMove = (e: MouseEvent) => {
      const wasInXZone = inXZone;
      inXZone = isInXAxisHitZone(u, e.clientX, e.clientY);
      if (inXZone !== wasInXZone) updateCursor();
      if (xDragStart !== null) {
        const overW = u.over.clientWidth;
        const dxPx = e.clientX - xDragStart.clientX;
        const span = xDragStart.maxX - xDragStart.minX;
        if (overW === 0 || span === 0) return;
        const dataDx = (dxPx / overW) * span;
        u.setScale('x', { min: xDragStart.minX - dataDx, max: xDragStart.maxX - dataDx });
        const xScalePan = u.scales['x'];
        if (xScalePan?.min != null && xScalePan?.max != null) {
          onXPanRef.current?.(
            BigInt(Math.round(xScalePan.min * 1000)),
            BigInt(Math.round(xScalePan.max * 1000)),
          );
        }
        // Prefetch check: fire ensureCovered when visible edge approaches cached extent.
        checkAndExtendXCoverage(u, ensureCoveredRef.current);
      }
    };

    const onXDown = (e: MouseEvent) => {
      if (!inXZone || e.button !== 0) return;
      const xScale = u.scales['x'];
      if (!xScale) return;
      xDragStart = {
        clientX: e.clientX,
        minX: xScale.min ?? 0,
        maxX: xScale.max ?? 1,
      };
      e.preventDefault();
    };

    const onXUp = () => {
      xDragStart = null;
      updateCursor();
    };

    const onXWheel = (e: WheelEvent) => {
      if (!inXZone) return;
      e.preventDefault();
      const r = u.over.getBoundingClientRect();
      const cursorXPx = e.clientX - r.left;
      zoomXScale(u, e.deltaY, cursorXPx, u.over.clientWidth);

      const xScale = u.scales['x'];
      if (xScale?.min != null && xScale?.max != null) {
        // Fire on every wheel tick — drives mode-state sync regardless of threshold.
        onXRangeChangeRef.current?.(
          BigInt(Math.round(xScale.min * 1000)),
          BigInt(Math.round(xScale.max * 1000)),
        );

        // Check for zoom-level threshold crossing (CAG bucket-size switch).
        const newSpanSec = xScale.max - xScale.min;
        const newSpanMs = BigInt(Math.round(newSpanSec * 1000));
        const anchorSpan = zoomAnchorSpanRef.current;
        const switchCb = onZoomLevelSwitchRef.current;
        if (anchorSpan && switchCb) {
          const transition = computeZoomLevelTransition(newSpanMs, anchorSpan);
          if (transition) {
            const cursorXSec = xScale.min + (cursorXPx / u.over.clientWidth) * newSpanSec;
            const cursorTimeMs = BigInt(Math.round(cursorXSec * 1000));
            switchCb(transition, cursorTimeMs);
            return; // Skip coverage check — fresh fetches will fire from the new dataViewport.
          }
        }
      }

      // No level transition: standard coverage check (Prompt 1 behavior).
      checkAndExtendXCoverage(u, ensureCoveredRef.current);
    };

    wrap.addEventListener('mousemove', onYMove);
    wrap.addEventListener('mousedown', onYDown);
    window.addEventListener('mouseup', onYUp);
    wrap.addEventListener('wheel', onYWheel, { passive: false });
    wrap.addEventListener('mousemove', onXMove);
    wrap.addEventListener('mousedown', onXDown);
    window.addEventListener('mouseup', onXUp);
    wrap.addEventListener('wheel', onXWheel, { passive: false });

    return () => {
      cancelAnimationFrame(insetRafId);
      // Capture X scale before destroying so the next effect body can restore it.
      if (uplotRef.current) {
        const oldX = uplotRef.current.scales['x'];
        if (oldX && oldX.min != null && oldX.max != null && Number.isFinite(oldX.min) && Number.isFinite(oldX.max)) {
          preservedXRangeRef.current = { min: oldX.min, max: oldX.max };
        }
      }
      wrap.removeEventListener('mousemove', onYMove);
      wrap.removeEventListener('mousedown', onYDown);
      window.removeEventListener('mouseup', onYUp);
      wrap.removeEventListener('wheel', onYWheel);
      wrap.removeEventListener('mousemove', onXMove);
      wrap.removeEventListener('mousedown', onXDown);
      window.removeEventListener('mouseup', onXUp);
      wrap.removeEventListener('wheel', onXWheel);
      wrap.style.cursor = '';
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [tagIds, effectiveSelectedId, tagMap, height, siteTimezone, onCursorChange, rebuildToken, data.type]);

  // ── Apply data updates without rebuilding uPlot ───────────────────────────
  // Cheap path: preserves the uPlot instance, all event listeners, and drag state.
  // Fires after the rebuild effect on the same render (React effect ordering), so
  // uplotRef.current is always the current instance when this runs.
  useEffect(() => {
    if (!uplotRef.current || tagIds.length === 0) return;
    if (data.type === 'aggregate') {
      const bands = bandsFromTrendData(data, tagIds)!;
      const interleaved: (number | null)[][] = [];
      for (let i = 0; i < tagIds.length; i++) {
        interleaved.push(bands.mins[i]!);
        interleaved.push(bands.maxs[i]!);
      }
      uplotRef.current.setData([bands.xs, ...interleaved] as uPlot.AlignedData);
    } else {
      const { xs, ys } = seriesFromTrendData(data, tagIds);
      uplotRef.current.setData([xs, ...ys] as uPlot.AlignedData);
    }
  }, [data, tagIds]);

  // ── Post-swap coverage check — fires once per performSwap, not on every setData ──
  // swapCounter increments only when useTrendData installs a new active tile set.
  // This handles the case where the user kept zooming past the level-switch threshold,
  // leaving xRange wider than the new active set. Pan-driven setData events do NOT
  // increment swapCounter, so panThresholdCheck in onXMove handles those instead.
  useEffect(() => {
    if (uplotRef.current && ensureCoveredRef.current) {
      checkAndExtendXCoverage(uplotRef.current, ensureCoveredRef.current);
    }
  }, [swapCounter]);

  // ── Imperative X-scale update — does NOT rebuild uPlot ───────────────────
  // Skipped when lastIntent === 'zoom' or 'pan': uPlot already has the right
  // scale from the gesture handler; firing here would overwrite it or cause jitter.
  useEffect(() => {
    if (!uplotRef.current || !xRange) return;
    if (lastIntentRef.current === 'zoom' || lastIntentRef.current === 'pan') return;
    uplotRef.current.setScale('x', {
      min: Number(xRange.startMs) / 1000,
      max: Number(xRange.endMs) / 1000,
    });
  }, [xRange]);

  // ── Prune Y-scale overrides when tags are removed ─────────────────────────
  // Runs on every tagIds change. Re-adding a previously removed tag starts fresh.
  useEffect(() => {
    pruneRemovedTagOverrides(yScaleOverridesRef.current, tagIds);
  }, [tagIds]);

  // Memoised to avoid flickering on parent re-renders caused by xRange ticks.
  const legend = useMemo(() => (
    tagIds.length > 0 ? (
      <Legend
        tagIds={tagIds}
        data={data}
        tagMap={tagMap}
        selectedTagId={effectiveSelectedId}
        cursorIdx={cursorState?.idx}
        showLastWhenIdle={showLastWhenIdle}
        onSelect={setSelectedTagId}
        onRemove={tagId => onTagRemove?.(tagId)}
      />
    ) : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [tagIds, data, tagMap, effectiveSelectedId, cursorState?.idx, onTagRemove, showLastWhenIdle]);

  return (
    <div style={WRAPPER}>
      <div style={LEFT_COLUMN} ref={leftColRef}>
        <div ref={containerRef} />
        {footer && (
          <div style={{
            width: '100%',
            boxSizing: 'border-box',
            paddingLeft: plotInset.left,
            paddingRight: plotInset.right,
          }}>
            {footer}
          </div>
        )}
      </div>
      {legend}
    </div>
  );
}
