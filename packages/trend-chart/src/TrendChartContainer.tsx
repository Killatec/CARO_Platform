import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTrendMode } from './useTrendMode.js';
import { useTrendData } from './useTrendData.js';
import { useZoomState } from './useZoomState.js';
import { TrendChart } from './TrendChart.js';
import { SpanBucketIndicator } from './SpanBucketIndicator.js';
import { SpanPresets } from './SpanPresets.js';
import { EndPicker } from './EndPicker.js';
import { CursorDisplay } from './CursorDisplay.js';
import { TREND_VIEWER_DEFAULTS } from './level.js';

const VISIBLE_TILES_PER_WINDOW = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow;
const BUCKET_COUNT = TREND_VIEWER_DEFAULTS.bucketCount;

export interface TrendChartContainerProps {
  /**
   * Initial tag ID list. Container owns the list and handles removes via the
   * Legend. Tag additions are wired in Step 12 (TagPickerDrawer).
   */
  tagIds: number[];
  siteTimezone?: string;
  height?: number;
}

const FOOTER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '8px 0 0 0',
};

const FOOTER_LEFT: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const FOOTER_RIGHT: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const LOADING_HINT: CSSProperties = {
  fontSize: 12,
  color: '#9ca3af',
  padding: '4px 0',
  fontFamily: 'monospace',
};

export function TrendChartContainer({
  tagIds: initialTagIds,
  siteTimezone,
  height = 420,
}: TrendChartContainerProps) {
  // ── Mode state machine ────────────────────────────────────────────────────
  const { state: modeState, viewport: modeViewport, dispatch } = useTrendMode();

  // ── Tag list (container owns; removes come from Legend via TrendChart) ────
  const [tagIds, setTagIds] = useState<number[]>(initialTagIds);

  // ── Cursor time (lifted from TrendChart for CursorDisplay) ────────────────
  const [cursorTsMs, setCursorTsMs] = useState<number | null>(null);

  // ── Zoom-level state ──────────────────────────────────────────────────────
  const { zoomAnchorSpan, dataViewport, handleDragZoom: _handleDragZoom, handleZoomLevelSwitch: _handleZoomLevelSwitch } = useZoomState({
    modeViewport,
    visibleTilesPerWindow: VISIBLE_TILES_PER_WINDOW,
    bucketCount: BUCKET_COUNT,
    lastIntent: modeState.lastIntent,
  });

  // ── Data fetch (driven by explicit dataViewport) ──────────────────────────
  const { data, isLoading, ensureCovered, swapCounter, activeTileCount } = useTrendData({ viewport: dataViewport, tagIds });

  // ── xRange: passes the live mode viewport to TrendChart for imperative
  //    setScale — updated every tick in tailing, or on preset/EndPicker/zoom. ──
  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  const viewportSpanMs = modeViewport.end - modeViewport.start;
  const bucketSMs = data?.type === 'aggregate' ? BigInt(data.bucketSMs) : null;

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleTagRemove = useCallback((tagId: number) => {
    setTagIds(prev => prev.filter(id => id !== tagId));
  }, []);

  const rafIdRef = useRef<number | null>(null);
  const pendingRangeRef = useRef<{ min: bigint; max: bigint } | null>(null);

  const panRafIdRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ min: bigint; max: bigint } | null>(null);

  // Cancel any pending RAFs on unmount so we don't dispatch into an unmounted tree.
  useEffect(() => () => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    if (panRafIdRef.current !== null) cancelAnimationFrame(panRafIdRef.current);
  }, []);

  const handleXRangeChange = useCallback((min: bigint, max: bigint) => {
    pendingRangeRef.current = { min, max };
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const r = pendingRangeRef.current;
      pendingRangeRef.current = null;
      if (r) dispatch({ type: 'zoomApplied', from: r.min, to: r.max, nowMs: BigInt(Date.now()) });
    });
  }, [dispatch]);

  const handleXPan = useCallback((min: bigint, max: bigint) => {
    pendingPanRef.current = { min, max };
    if (panRafIdRef.current !== null) return;
    panRafIdRef.current = requestAnimationFrame(() => {
      panRafIdRef.current = null;
      const r = pendingPanRef.current;
      pendingPanRef.current = null;
      if (r) dispatch({ type: 'panApplied', from: r.min, to: r.max, nowMs: BigInt(Date.now()) });
    });
  }, [dispatch]);

  const handlePreset = useCallback(
    (sizeMs: bigint) => {
      dispatch({ type: 'presetClicked', sizeMs, nowMs: BigInt(Date.now()) });
    },
    [dispatch],
  );

  const handleLive = useCallback(() => {
    dispatch({ type: 'liveClicked', nowMs: BigInt(Date.now()) });
  }, [dispatch]);

  const handleEndCommitted = useCallback(
    (to: bigint) => {
      dispatch({ type: 'endPickerCommitted', to, nowMs: BigInt(Date.now()) });
    },
    [dispatch],
  );

  // Wrap drag-zoom: call useZoomState handler first, then sync modeState to the
  // resulting dataViewport so EndPicker always shows the correct post-zoom End.
  const handleDragZoom = useCallback(
    (selectionStartMs: bigint, selectionEndMs: bigint) => {
      _handleDragZoom(selectionStartMs, selectionEndMs);
      // dataViewport update is async (setState), so derive the new viewport from
      // the same computation that useZoomState performs.
      // We dispatch zoomApplied with the raw selection center anchored to selectionEnd
      // so the reducer sets modeViewport = dataViewport after the next render.
      // The selection end is the user's intended End.
      dispatch({
        type: 'zoomApplied',
        from: selectionStartMs,
        to: selectionEndMs,
        nowMs: BigInt(Date.now()),
      });
    },
    [_handleDragZoom, dispatch],
  );

  // Wrap zoom-level switch: same pattern — sync mode state after zoom.
  const handleZoomLevelSwitch = useCallback(
    (direction: 'in' | 'out', cursorTimeMs: bigint) => {
      _handleZoomLevelSwitch(direction, cursorTimeMs);
      // Derive the new viewport the same way useZoomState does, then dispatch.
      const newBucketSMs = direction === 'out'
        ? (dataViewport.end - dataViewport.start) / BigInt(VISIBLE_TILES_PER_WINDOW * BUCKET_COUNT) * 2n
        : (dataViewport.end - dataViewport.start) / BigInt(VISIBLE_TILES_PER_WINDOW * BUCKET_COUNT) / 2n;
      if (newBucketSMs <= 0n) return;
      const newSpan = newBucketSMs * BigInt(VISIBLE_TILES_PER_WINDOW * BUCKET_COUNT);
      const newStart = cursorTimeMs - newSpan / 2n;
      const newEnd = newStart + newSpan;
      dispatch({
        type: 'zoomApplied',
        from: newStart,
        to: newEnd,
        nowMs: BigInt(Date.now()),
      });
    },
    [_handleZoomLevelSwitch, dispatch, dataViewport],
  );

  const footerJsx = (
    <>
      <CursorDisplay cursorTsMs={cursorTsMs} siteTimezone={siteTimezone} />
      <div style={FOOTER}>
        <div style={FOOTER_LEFT}>
          <SpanPresets state={modeState} onPreset={handlePreset} />
          <SpanBucketIndicator spanMs={viewportSpanMs} bucketSMs={bucketSMs} />
        </div>
        <div style={FOOTER_RIGHT}>
          <EndPicker
            state={modeState}
            viewport={modeViewport}
            siteTimezone={siteTimezone}
            onEndCommitted={handleEndCommitted}
            onLive={handleLive}
          />
        </div>
      </div>
    </>
  );

  if (!data) {
    return (
      <div style={LOADING_HINT}>
        {isLoading ? 'Loading…' : tagIds.length === 0 ? 'No tags selected.' : null}
      </div>
    );
  }

  return (
    <TrendChart
      data={data}
      tagIds={tagIds}
      siteTimezone={siteTimezone}
      height={height}
      xRange={xRange}
      onTagRemove={handleTagRemove}
      ensureCovered={ensureCovered}
      zoomAnchorSpan={zoomAnchorSpan}
      onZoomLevelSwitch={handleZoomLevelSwitch}
      swapCounter={swapCounter}
      activeTileCount={activeTileCount}
      onDragZoom={handleDragZoom}
      footer={footerJsx}
      onCursorTsChange={setCursorTsMs}
      showLastWhenIdle={modeState.mode === 'tailing'}
      onXRangeChange={handleXRangeChange}
      onXPan={handleXPan}
      lastIntent={modeState.lastIntent}
    />
  );
}
