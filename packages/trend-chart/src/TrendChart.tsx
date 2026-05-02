import 'uplot/dist/uPlot.min.css';
import uPlot from 'uplot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTagMap } from '@caro/hmi-context';
import type { TrendData } from './types.js';
import { Legend } from './Legend.js';
import { ResolutionIndicator } from './ResolutionIndicator.js';
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
import { computeZoomLevelTransition } from './level.js';

export interface TrendChartProps {
  data: TrendData;
  /** Effective tag list — container is responsible for filtering removed ids. */
  tagIds: number[];
  siteTimezone?: string;
  width?: number;
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
  onTagRemove,
  ensureCovered,
  zoomAnchorSpan,
  onZoomLevelSwitch,
  swapCounter,
  activeTileCount,
  onDragZoom,
}: TrendChartProps) {
  const tagMap = useTagMap();

  // selectedTagId is pure UI state — stays in TrendChart.
  const [selectedTagId, setSelectedTagId] = useState<number>(() => tagIds[0] ?? 0);
  const [cursorState, setCursorState] = useState<{ idx: number; tsMs: number | null } | null>(null);

  // If the selected tag was removed by the container, fall back to first remaining.
  const effectiveSelectedId = tagIds.includes(selectedTagId)
    ? selectedTagId
    : (tagIds[0] ?? 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
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

  const onCursorChange = useCallback(
    (idx: number | null, tsMs: number | null) => {
      if (idx === null || idx < 0) {
        setCursorState(null);
      } else {
        setCursorState({ idx, tsMs });
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
      yScaleOverrides: yScaleOverridesRef.current,
      onDragZoom: (s, e) => onDragZoomRef.current?.(s, e),
    });

    // Old instance was destroyed in cleanup; preservedXRangeRef was written there.
    container.innerHTML = '';

    const u = new uPlot(config, uplotData, container);
    uplotRef.current = u;

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

      // Check for zoom-level threshold crossing after the scale has been updated.
      const xScale = u.scales['x'];
      if (xScale) {
        const newSpanSec = (xScale.max ?? 0) - (xScale.min ?? 0);
        const newSpanMs = BigInt(Math.round(newSpanSec * 1000));
        const anchorSpan = zoomAnchorSpanRef.current;
        const switchCb = onZoomLevelSwitchRef.current;
        if (anchorSpan && switchCb) {
          const transition = computeZoomLevelTransition(newSpanMs, anchorSpan);
          if (transition) {
            // Cursor data-X at the current pixel position.
            const cursorXSec = (xScale.min ?? 0) + (cursorXPx / u.over.clientWidth) * newSpanSec;
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
  }, [tagIds, effectiveSelectedId, tagMap, width, height, siteTimezone, onCursorChange]);

  // ── Apply data updates without rebuilding uPlot ───────────────────────────
  // Cheap path: preserves the uPlot instance, all event listeners, and drag state.
  // Fires after the rebuild effect on the same render (React effect ordering), so
  // uplotRef.current is always the current instance when this runs.
  useEffect(() => {
    if (!uplotRef.current || tagIds.length === 0) return;
    const { xs, ys } = seriesFromTrendData(data, tagIds);
    uplotRef.current.setData([xs, ...ys] as uPlot.AlignedData);
    console.log(`[TrendChart] setData: ${xs.length} points (${activeTileCount ?? 0} active tiles)`);
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
  useEffect(() => {
    if (!uplotRef.current || !xRange) return;
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
        onSelect={setSelectedTagId}
        onRemove={tagId => onTagRemove?.(tagId)}
        cursorTsMs={cursorState?.tsMs ?? null}
        siteTimezone={siteTimezone}
      />
    ) : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [tagIds, data, tagMap, effectiveSelectedId, cursorState?.idx, cursorState?.tsMs, onTagRemove, siteTimezone]);

  return (
    <div style={{ ...WRAPPER, width: width + 24 }} ref={canvasWrapRef}>
      <div style={HEADER}>
        <ResolutionIndicator data={data} />
      </div>
      <div ref={containerRef} />
      {legend}
    </div>
  );
}
