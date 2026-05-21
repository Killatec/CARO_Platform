import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTrendMode, trendModeReducer, isLive } from './useTrendMode.js';
import type { TrendModeAction } from './useTrendMode.js';
import { useTrendData } from './useTrendData.js';
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
import type { ActiveTileEntry, AggregateSeriesData } from './types.js';

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

/** Returns responseTailTs of the rightmost active tile — used as the merge seam point (§5.2). */
function getSeamResponseTailTs(activeTilesRef: { readonly current: ActiveTileEntry[] }): number | null {
  const active = activeTilesRef.current;
  if (active.length === 0) return null;
  return active[active.length - 1]!.responseTailTs;
}

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
  const { zoomAnchorSpan, dataViewport, handleDragZoom: _handleDragZoom, handleZoomLevelSwitch: _handleZoomLevelSwitch } = useZoomState({
    modeViewport,
    visibleTilesPerWindow: VISIBLE_TILES_PER_WINDOW,
    bucketCount: BUCKET_COUNT,
    lastIntent: modeState.lastIntent,
  });

  // ── Live subscription ref (stable ref; populated synchronously after useLiveSubscription) ──
  const liveSubRef = useRef<UseLiveSubscriptionResult | null>(null);

  // Stable callback — reads from liveSubRef so useTrendData's fetch effect can sample
  // the latest HWM timestamp without creating a dependency cycle.
  const getLatestSampleTs = useCallback(() => liveSubRef.current?.getLatestSampleTs() ?? null, []);

  // ── Data fetch (driven by explicit dataViewport) ──────────────────────────
  const trendData = useTrendData({ viewport: dataViewport, tagIds, isLive: isLive(modeState.mode), getLatestSampleTs });
  const { data, isLoading, swapCounter, activeTileCount, lastFetchMs } = trendData;

  // ── Stable ref for synchronous access from callbacks ─────────────────────
  const modeStateRef = useRef(modeState);
  modeStateRef.current = modeState;

  // ── Live subscription inputs ──────────────────────────────────────────────
  const viewportSpanMs = modeViewport.end - modeViewport.start;

  // Derived from tile data (unified path — no spine).
  const tailMode: 'aggregate' | 'raw' | null =
    data?.type === 'aggregate' ? 'aggregate'
    : data?.type === 'raw'       ? 'raw'
    : null;

  const bucketSMs: bigint | null =
    data?.type === 'aggregate' ? BigInt(data.bucketSMs) : null;

  // Active-set-aware trim threshold (§4.2): max responseTailTs − 1000 ms absorbs writer lag.
  const trimThreshold: number | null =
    trendData.responseTailTs != null ? trendData.responseTailTs - 1000 : null;

  const seedFromCachedTile = useMemo(() => {
    if (data?.type !== 'aggregate') return null;
    const m = new Map<number, number | boolean | string | null>();
    for (const [tagId, arrs] of data.series) {
      m.set(tagId, arrs.value[arrs.value.length - 1] ?? null);
    }
    return m;
  }, [data, swapCounter]);

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

  // Phase 4 refinement: button is orange ONLY when the live edge is off-screen
  // (latestSampleTs is BEFORE the viewport's left edge in live-fixed). When the
  // live edge is visible inside [from, to] OR no live data has arrived yet, the
  // button stays highlighted same as live-trailing. Read per render — refs update
  // on every WS sample's setTail re-render, so this is fresh.
  const liveEdgeBehindWindow = (() => {
    if (modeState.mode !== 'live-fixed') return false;
    const lts = liveSubRef.current?.getLatestSampleTs() ?? null;
    if (lts === null) return false;
    return lts < modeState.from;
  })();

  // ── Merged data for rendering ─────────────────────────────────────────────
  // Single unified path: tile data + live tail (§5.2).
  // swapCounter drives recompute when the active tile set changes;
  // seamResponseTailTs aligns the seam-bucket min/max combination.
  const mergedData = useMemo(
    () => mergeTrendData(data, liveSub.tail, {
      seamResponseTailTs: getSeamResponseTailTs(trendData.activeTilesRef),
    }),
    [data, liveSub.tail, swapCounter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── xRange: passes the live mode viewport to TrendChart for imperative
  //    setScale — updated every tick in tailing, or on preset/EndPicker/zoom. ──
  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  const bucketSMsIndicator = data?.type === 'aggregate' ? BigInt(data.bucketSMs) : null;

  // ── dispatchModeAction: drain on Live→fixed, then dispatch ──────────────
  // dataViewport is owned by useZoomState: reset effect for non-zoom intents,
  // zoom handlers for wheel-zoom. No syncDataViewport needed here (§4.5 v1.5).
  const dispatchModeAction = useCallback((action: TrendModeAction) => {
    const prev = modeStateRef.current;
    const next = trendModeReducer(prev, action);
    if (isLive(prev.mode) && !isLive(next.mode)) {
      liveSubRef.current?.drainBuffers();
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
        dispatchModeAction({
          type: 'zoomApplied',
          from: r.min,
          to: r.max,
          nowMs: BigInt(Date.now()),
          latestSampleTs: liveSubRef.current?.getLatestSampleTs() ?? null,
        });
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
        latestSampleTs: liveSubRef.current?.getLatestSampleTs() ?? null,
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
            liveEdgeBehindWindow={liveEdgeBehindWindow}
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

  // Bridge across mode transitions: when chartData briefly drops to null
  // (tile fetch in-flight after a mode change) the loading hint would unmount
  // <TrendChart>, flickering the uPlot canvas. Hold the most-recent non-null
  // chartData so the chart stays mounted across the in-flight window.
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
      zoomAnchorSpan={zoomAnchorSpan}
      onZoomLevelSwitch={handleZoomLevelSwitch}
      swapCounter={swapCounter}
      activeTileCount={activeTileCount}
      onDragZoom={handleDragZoom}
      footer={footerJsx}
      onCursorTsChange={setCursorTsMs}
      showLastWhenIdle={isLive(modeState.mode)}
      onXRangeChange={handleXRangeChange}
      onXPan={handleXPan}
      lastIntent={modeState.lastIntent}
      rangeExceeded={uxRangeExceeded}
      rangeTooNarrow={uxRangeTooNarrow}
    />
  );
}
