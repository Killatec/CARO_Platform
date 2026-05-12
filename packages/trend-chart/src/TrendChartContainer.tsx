import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTrendMode, trendModeReducer } from './useTrendMode.js';
import type { TrendModeAction } from './useTrendMode.js';
import { useTrendData } from './useTrendData.js';
import type { UseTrendDataResult } from './useTrendData.js';
import { useLiveSubscription } from './useLiveSubscription.js';
import type { UseLiveSubscriptionResult } from './useLiveSubscription.js';
import { mergeTrendData } from './mergeTrendData.js';
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
  const trendData = useTrendData({ viewport: dataViewport, tagIds, isTailing: modeState.mode === 'tailing' });
  const { data, isLoading, ensureCovered, swapCounter, activeTileCount, lastFetchMs } = trendData;

  // ── Stable refs for synchronous access from callbacks and cleanup ─────────
  // Updated synchronously during render so callbacks always see the latest values.
  const modeStateRef = useRef(modeState);
  const trendDataRef = useRef<UseTrendDataResult>(trendData);
  const liveSubRef   = useRef<UseLiveSubscriptionResult | null>(null);

  modeStateRef.current = modeState;
  trendDataRef.current = trendData;

  // ── Live subscription inputs ──────────────────────────────────────────────
  const viewportSpanMs = modeViewport.end - modeViewport.start;
  const cachedData = data;

  const tailMode: 'aggregate' | 'raw' | null =
    cachedData?.type === 'aggregate' ? 'aggregate'
    : cachedData?.type === 'raw'       ? 'raw'
    : null;

  const bucketSMs: bigint | null =
    cachedData?.type === 'aggregate' ? BigInt(cachedData.bucketSMs) : null;

  const trimThreshold: number | null =
    trendData.responseTailTs != null ? trendData.responseTailTs - 1000 : null;

  const seedFromCachedTile = useMemo(() => {
    if (!cachedData) return null;
    const m = new Map<number, number | boolean | string | null>();
    if (cachedData.type === 'aggregate') {
      for (const [tagId, arrs] of cachedData.series) {
        m.set(tagId, arrs.value[arrs.value.length - 1] ?? null);
      }
    } else {
      for (const [tagId, s] of cachedData.series) {
        m.set(tagId, s.value[s.value.length - 1] ?? null);
      }
    }
    return m;
  }, [cachedData]);

  // Advances nowMs from WS frame's max moduleTs — only while tailing.
  const handleDataReceived = useCallback((maxModuleTs: number) => {
    if (modeStateRef.current.mode !== 'tailing') return;
    dispatch({ type: 'tick', nowMs: BigInt(maxModuleTs) });
  }, [dispatch]);

  const liveSub = useLiveSubscription({
    tagIds,
    isTailing: modeState.mode === 'tailing',
    trimThreshold,
    seedFromCachedTile,
    tailMode,
    bucketSMs,
    viewportSpanMs,
    onDataReceived: handleDataReceived,
  });

  // Synchronous ref update — liveSubRef is always fresh before any callback fires.
  liveSubRef.current = liveSub;

  // ── Container unmount cleanup: drain + evict on tailing exit ─────────────
  useEffect(() => () => {
    if (modeStateRef.current.mode === 'tailing') {
      const range = liveSubRef.current?.commitAndDrain();
      if (range && range.end > range.start) {
        trendDataRef.current.evictRange(range.start, range.end);
      }
    }
  }, []);

  // ── Merged data for rendering ─────────────────────────────────────────────
  const mergedData = useMemo(
    () => mergeTrendData(data, liveSub.tail, modeState.mode === 'tailing'),
    [data, liveSub.tail, modeState.mode],
  );

  // ── xRange: passes the live mode viewport to TrendChart for imperative
  //    setScale — updated every tick in tailing, or on preset/EndPicker/zoom. ──
  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  const bucketSMsIndicator = data?.type === 'aggregate' ? BigInt(data.bucketSMs) : null;

  // ── dispatchModeAction: live drain before dispatch ────────────────────────
  // Used for all actions that can change the tailing/fixed mode boundary.
  const dispatchModeAction = useCallback((action: TrendModeAction) => {
    console.log('[DIAG-live] dispatchModeAction',
      'action.type=', action.type,
      'curMode=', modeStateRef.current.mode,
      'nowMs=', BigInt(Date.now()).toString());
    const cur  = modeStateRef.current;
    const next = trendModeReducer(cur, action);
    console.log('[DIAG-live] mode transition',
      'cur.mode=', cur.mode,
      'next.mode=', next.mode,
      'next.from=', next.mode === 'fixed' ? next.from.toString() : 'n/a',
      'next.to=', next.mode === 'fixed' ? next.to.toString() : 'n/a',
      'next.sizeMs=', next.sizeMs.toString());

    // Tailing → fixed: drain the live buffer so accumulated FIFO/accumulator
    // coverage is committed. No cache eviction needed — live mode never writes
    // to the LRU cache, so there is nothing to evict. History fetches start
    // fresh against any stale tiles that remain (LRU displaces them naturally).
    if (cur.mode === 'tailing' && next.mode === 'fixed') {
      liveSubRef.current?.commitAndDrain();
    }

    // Fixed → tailing: the live-spine path never touches the cache, so existing
    // history tiles can stay. The spine fetch overwrites hookResult.data directly
    // on the first live tick.

    dispatch(action);
  }, [dispatch]);

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
      if (r) dispatchModeAction({ type: 'zoomApplied', from: r.min, to: r.max, nowMs: BigInt(Date.now()) });
    });
  }, [dispatchModeAction]);

  const handleXPan = useCallback((min: bigint, max: bigint) => {
    pendingPanRef.current = { min, max };
    if (panRafIdRef.current !== null) return;
    panRafIdRef.current = requestAnimationFrame(() => {
      panRafIdRef.current = null;
      const r = pendingPanRef.current;
      pendingPanRef.current = null;
      if (r) dispatchModeAction({ type: 'panApplied', from: r.min, to: r.max, nowMs: BigInt(Date.now()) });
    });
  }, [dispatchModeAction]);

  const handlePreset = useCallback(
    (sizeMs: bigint) => {
      dispatch({ type: 'presetClicked', sizeMs, nowMs: BigInt(Date.now()) });
    },
    [dispatch],
  );

  const handleLive = useCallback(() => {
    dispatchModeAction({ type: 'liveClicked', nowMs: BigInt(Date.now()) });
  }, [dispatchModeAction]);

  const handleEndCommitted = useCallback(
    (to: bigint) => {
      dispatchModeAction({ type: 'endPickerCommitted', to, nowMs: BigInt(Date.now()) });
    },
    [dispatchModeAction],
  );

  // Dispatch zoomApplied with the raw selection bounds: modeViewport reflects
  // the user's intended range, while dataViewport (set by _handleDragZoom below)
  // tracks the snapped tile-aligned range. The two are intentionally distinct —
  // EndPicker shows the intended end, fetches use the snapped range.
  const handleDragZoom = useCallback(
    (selectionStartMs: bigint, selectionEndMs: bigint) => {
      _handleDragZoom(selectionStartMs, selectionEndMs);
      dispatchModeAction({
        type: 'zoomApplied',
        from: selectionStartMs,
        to: selectionEndMs,
        nowMs: BigInt(Date.now()),
      });
    },
    [_handleDragZoom, dispatchModeAction],
  );

  // Wrap zoom-level switch: update data-fetch state (bucketSMs, dataViewport, zoomAnchorSpan).
  // zoomApplied is NOT dispatched here — onXRangeChange fires on every X-scale mutation
  // (including level-switch ticks) and handleXRangeChange dispatches it via RAF, covering
  // all cases (sub-threshold, zoom-out, level-switch) through a single path.
  const handleZoomLevelSwitch = useCallback(
    (direction: 'in' | 'out', cursorTimeMs: bigint) => {
      _handleZoomLevelSwitch(direction, cursorTimeMs);
    },
    [_handleZoomLevelSwitch],
  );

  const footerJsx = (
    <>
      <CursorDisplay cursorTsMs={cursorTsMs} siteTimezone={siteTimezone} />
      <div style={FOOTER}>
        <div style={FOOTER_LEFT}>
          <SpanPresets state={modeState} onPreset={handlePreset} />
          <SpanBucketIndicator spanMs={viewportSpanMs} bucketSMs={bucketSMsIndicator} lastFetchMs={lastFetchMs} />
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

  if (!mergedData) {
    return (
      <div style={LOADING_HINT}>
        {isLoading ? 'Loading…' : tagIds.length === 0 ? 'No tags selected.' : null}
      </div>
    );
  }

  return (
    <TrendChart
      data={mergedData}
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
