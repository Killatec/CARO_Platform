import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTrendMode, trendModeReducer, modeToViewport, isLive } from './useTrendMode.js';
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
import { TREND_VIEWER_DEFAULTS, MIN_VIEWPORT_SPAN_MS, MAX_VIEWPORT_SPAN_MS } from './level.js';
import type { AggregateSeriesData, RawSeriesData } from './types.js';

const VISIBLE_TILES_PER_WINDOW = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow;
const BUCKET_COUNT = TREND_VIEWER_DEFAULTS.bucketCount;

export interface TrendChartContainerProps {
  /**
   * Initial tag ID list. Container owns the list and handles removes via the
   * Legend. Tag additions wired in the tag picker drawer.
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

  // ── modeViewport-derived out-of-range booleans ────────────────────────────
  // Drive render decisions (placeholderData, CursorDisplay message, TrendChart
  // setScale bypass) from modeViewport, which updates on every wheel/pan tick
  // via the RAF-coalesced zoomApplied/panApplied actions.
  // useTrendData's internal rangeExceeded/rangeTooNarrow flags are keyed on
  // dataViewport (which doesn't update on every wheel tick because useZoomState
  // skips the reset on lastIntent='zoom') and are retained for fetch suppression.
  const uxRangeTooNarrow = useMemo(
    () => modeViewport.end - modeViewport.start < MIN_VIEWPORT_SPAN_MS,
    [modeViewport.start, modeViewport.end],
  );
  const uxRangeExceeded = useMemo(
    () => modeViewport.end - modeViewport.start > MAX_VIEWPORT_SPAN_MS,
    [modeViewport.start, modeViewport.end],
  );

  // ── Tag list (container owns; removes come from Legend via TrendChart) ────
  const [tagIds, setTagIds] = useState<number[]>(initialTagIds);

  // ── Cursor time (lifted from TrendChart for CursorDisplay) ────────────────
  const [cursorTsMs, setCursorTsMs] = useState<number | null>(null);

  // ── Zoom-level state ──────────────────────────────────────────────────────
  const { zoomAnchorSpan, dataViewport, syncDataViewport, handleDragZoom: _handleDragZoom, handleZoomLevelSwitch: _handleZoomLevelSwitch } = useZoomState({
    modeViewport,
    visibleTilesPerWindow: VISIBLE_TILES_PER_WINDOW,
    bucketCount: BUCKET_COUNT,
    lastIntent: modeState.lastIntent,
  });

  // ── Live subscription ref (declared before useTrendData so the spine callbacks
  //    can reference it; stable ref, never null after first render) ─────────────
  const liveSubRef = useRef<UseLiveSubscriptionResult | null>(null);
  const getLiveGeneration = useCallback(() => liveSubRef.current?.getCurrentGeneration() ?? 0, []);
  const onSpineResolved = useCallback(
    (tagId: number, series: AggregateSeriesData | RawSeriesData, gen: number) => {
      liveSubRef.current?.seedFromSpineFetch(tagId, series, gen);
    },
    [],
  );

  // ── Data fetch (driven by explicit dataViewport) ──────────────────────────
  const trendData = useTrendData({ viewport: dataViewport, tagIds, isLive: isLive(modeState.mode), getLiveGeneration, onSpineResolved });
  const { data, isLoading, ensureCovered, getActiveRange, swapCounter, activeTileCount, lastFetchMs } = trendData;

  // ── Stable refs for synchronous access from callbacks and cleanup ─────────
  // Updated synchronously during render so callbacks always see the latest values.
  const modeStateRef = useRef(modeState);
  const trendDataRef = useRef<UseTrendDataResult>(trendData);

  modeStateRef.current = modeState;
  trendDataRef.current = trendData;

  // ── Live subscription inputs ──────────────────────────────────────────────
  const viewportSpanMs = modeViewport.end - modeViewport.start;
  // In Live mode, read from the unified buffer (previous render's getBufferSnapshot) so
  // tailMode and bucketSMs are derivable without holding spine data in useTrendData state.
  const cachedData = isLive(modeState.mode)
    ? (liveSubRef.current?.getBufferSnapshot() ?? null)
    : data;

  const tailMode: 'aggregate' | 'raw' | null =
    cachedData?.type === 'aggregate' ? 'aggregate'
    : cachedData?.type === 'raw'       ? 'raw'
    : null;

  const bucketSMs: bigint | null =
    cachedData?.type === 'aggregate' ? BigInt(cachedData.bucketSMs) : null;

  const trimThreshold: number | null =
    trendData.responseTailTs != null ? trendData.responseTailTs - 1000 : null;

  const seedFromCachedTile = useMemo(() => {
    if (cachedData?.type !== 'aggregate') return null;
    const m = new Map<number, number | boolean | string | null>();
    for (const [tagId, arrs] of cachedData.series) {
      m.set(tagId, arrs.value[arrs.value.length - 1] ?? null);
    }
    return m;
  }, [cachedData]);

  // Advances nowMs from WS frame's max moduleTs — only while tailing.
  const handleDataReceived = useCallback((maxModuleTs: number) => {
    if (!isLive(modeStateRef.current.mode)) return;
    dispatch({ type: 'tick', nowMs: BigInt(maxModuleTs) });
  }, [dispatch]);

  const liveSub = useLiveSubscription({
    tagIds,
    isLive: isLive(modeState.mode),
    trimThreshold,
    seedFromCachedTile,
    tailMode,
    bucketSMs,
    viewportSpanMs,
    onDataReceived: handleDataReceived,
  });

  // Synchronous ref update — liveSubRef is always fresh before any callback fires.
  liveSubRef.current = liveSub;

  // ── Merged data for rendering ─────────────────────────────────────────────
  // History path: useMemo on real state deps.
  const historyMerged = useMemo(
    () => mergeTrendData(data, liveSub.tail),
    [data, liveSub.tail],
  );
  // Live path: getBufferSnapshot reads spineRef + tailModeRef (refs).
  // Refs are not observable React state so useMemo cannot subscribe to them.
  // Calling fresh every render is correct and cheap (bounded buffer merge).
  const mergedData = isLive(modeState.mode)
    ? liveSub.getBufferSnapshot()
    : historyMerged;

  // ── xRange: passes the live mode viewport to TrendChart for imperative
  //    setScale — updated every tick in tailing, or on preset/EndPicker/zoom. ──
  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  const bucketSMsIndicator = cachedData?.type === 'aggregate' ? BigInt(cachedData.bucketSMs) : null;

  // ── dispatchModeAction: live drain before dispatch ────────────────────────
  // Used for all actions that can change the tailing/fixed mode boundary.
  const dispatchModeAction = useCallback((action: TrendModeAction) => {
    const cur  = modeStateRef.current;
    const next = trendModeReducer(cur, action);

    // Fixed → tailing: evict all tiles. Forces every subsequent live exit to
    // refetch fresh data, eliminating Gap B (stale CAG-lag nulls accumulating
    // in the tile cache across sessions). Trade-off: every live exit pays a full
    // tile re-fetch (~3 tiles); negligible at expected usage rates.
    if (cur.mode === 'fixed' && next.mode === 'live-trailing') {
      trendDataRef.current.evictAll();
    }

    // Tailing → fixed: drain the live buffer so accumulated ring/accumulator
    // coverage is committed. No cache eviction needed — live mode never writes
    // to the LRU cache, so there is nothing to evict. History fetches start
    // fresh against the now-clean cache.
    if (cur.mode === 'live-trailing' && next.mode === 'fixed') {
      liveSubRef.current?.commitAndDrain();
      // Force dataViewport to match the post-pan modeViewport so the main
      // useTrendData effect fires and runs the history-fetch path.
      // Without this, dataViewport stays stuck at the live-mode value
      // (useZoomState's reset effect skips on lastIntent='pan'), and the
      // empty activeTilesRef from live mode causes ensureCovered to no-op,
      // leaving the chart with no data for the new pan position.
      syncDataViewport(modeToViewport(next));
      // Force the history fetch even when syncDataViewport's bounds equal the
      // current dataViewport (pan-from-live: first panApplied carries live
      // viewport bounds, so no state change would occur from syncDataViewport alone).
      trendDataRef.current.refetchHistory();
    }

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
      if (r) {
        dispatchModeAction({ type: 'zoomApplied', from: r.min, to: r.max, nowMs: BigInt(Date.now()) });
      }
    });
  }, [dispatchModeAction]);

  const handleXPan = useCallback((min: bigint, max: bigint) => {
    pendingPanRef.current = { min, max };
    if (panRafIdRef.current !== null) return;
    panRafIdRef.current = requestAnimationFrame(() => {
      panRafIdRef.current = null;
      const r = pendingPanRef.current;
      pendingPanRef.current = null;
      if (r) {
        dispatchModeAction({
          type: 'panApplied',
          from: r.min,
          to: r.max,
          nowMs: BigInt(Date.now()),
          latestSampleTs: liveSubRef.current?.getLatestSampleTs() ?? null,
        });
      }
    });
  }, [dispatchModeAction]);

  const handlePreset = useCallback(
    (sizeMs: bigint) => {
      dispatchModeAction({ type: 'presetClicked', sizeMs, nowMs: BigInt(Date.now()) });
    },
    [dispatchModeAction],
  );

  const handleLive = useCallback(() => {
    dispatchModeAction({ type: 'liveClicked', nowMs: BigInt(Date.now()) });
  }, [dispatchModeAction]);

  const handleEndCommitted = useCallback(
    (to: bigint) => {
      dispatchModeAction({
        type: 'endPickerCommitted',
        to,
        nowMs: BigInt(Date.now()),
        latestSampleTs: liveSubRef.current?.getLatestSampleTs() ?? null,
      });
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

  const rangeMessage = uxRangeExceeded
    ? 'Range too wide. Zoom in or pick a smaller preset.'
    : uxRangeTooNarrow
    ? 'Range too narrow. Zoom out or pick a wider preset.'
    : null;

  const footerJsx = (
    <>
      <CursorDisplay
        cursorTsMs={cursorTsMs}
        siteTimezone={siteTimezone}
        rangeMessage={rangeMessage}
      />
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

  const chartData = (uxRangeExceeded || uxRangeTooNarrow)
    ? (() => {
        const span = modeViewport.end - modeViewport.start;
        return {
          type: 'aggregate',
          source: 'mixed',
          startTime: modeViewport.start,
          endTime:   modeViewport.end,
          bucketSMs: Number(span),
          n: 2,
          series: new Map(
            tagIds.map(tagId => [tagId, {
              value: [null, null],
              min:   [null, null],
              max:   [null, null],
            }]),
          ),
        } as AggregateSeriesData;
      })()
    : mergedData;

  // Bridge across history↔live transitions: when chartData briefly drops to null
  // (spine fetch in-flight after evictAll, or history fetch in-flight after
  // commitAndDrain), the loading hint would unmount <TrendChart>, flickering the
  // uPlot canvas. Hold the most-recent non-null chartData so the chart stays
  // mounted across the in-flight window. New data replaces the bridge on arrival;
  // the ref does not accumulate stale state because chartData is fresh on every
  // render where it is non-null.
  // Synchronous-ref-update-during-render matches the existing pattern at lines
  // 117-118 (modeStateRef / trendDataRef).
  const lastChartDataRef = useRef<typeof chartData>(null);
  if (chartData !== null) lastChartDataRef.current = chartData;
  const effectiveChartData = chartData ?? lastChartDataRef.current;

  if (!effectiveChartData) {
    return (
      <div style={LOADING_HINT}>
        {isLoading ? 'Loading…' : tagIds.length === 0 ? 'No tags selected.' : null}
      </div>
    );
  }

  return (
    <TrendChart
      data={effectiveChartData}
      tagIds={tagIds}
      siteTimezone={siteTimezone}
      height={height}
      xRange={xRange}
      onTagRemove={handleTagRemove}
      ensureCovered={ensureCovered}
      getActiveRange={getActiveRange}
      zoomAnchorSpan={zoomAnchorSpan}
      onZoomLevelSwitch={handleZoomLevelSwitch}
      swapCounter={swapCounter}
      activeTileCount={activeTileCount}
      onDragZoom={handleDragZoom}
      footer={footerJsx}
      onCursorTsChange={setCursorTsMs}
      showLastWhenIdle={modeState.mode === 'live-trailing'}
      onXRangeChange={handleXRangeChange}
      onXPan={handleXPan}
      lastIntent={modeState.lastIntent}
      rangeExceeded={uxRangeExceeded}
      rangeTooNarrow={uxRangeTooNarrow}
    />
  );
}
