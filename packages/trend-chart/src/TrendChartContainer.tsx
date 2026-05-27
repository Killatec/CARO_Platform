import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTagMap } from '@caro/hmi-context';
import { useTrendMode, trendModeReducer, isLive } from './useTrendMode.js';
import type { TrendModeAction, ModeState } from './useTrendMode.js';
import { useTrendData } from './useTrendData.js';
import { useLiveSubscription } from './useLiveSubscription.js';
import type { UseLiveSubscriptionResult } from './useLiveSubscription.js';
import { mergeTrendData } from './mergeTrendData.js';
import { useZoomState } from './useZoomState.js';
import { TrendChart } from './TrendChart.js';
import { TagPickerModal } from './TagPickerModal.js';
import { SpanIndicator } from './SpanIndicator.js';
import { SpanPresets } from './SpanPresets.js';
import { EndPicker } from './EndPicker.js';
import { CursorDisplay } from './CursorDisplay.js';
import { TREND_VIEWER_DEFAULTS, MIN_VIEWPORT_SPAN_MS, MAX_VIEWPORT_SPAN_MS } from './level.js';
import type { ActiveTileEntry, AggregateSeriesData } from './types.js';
import {
  loadSession, saveSession,
  type TrendViewerSessionV1,
} from './sessionPersistence.js';

const VISIBLE_TILES_PER_WINDOW = TREND_VIEWER_DEFAULTS.visibleTilesPerWindow;
const BUCKET_COUNT = TREND_VIEWER_DEFAULTS.bucketCount;

export interface TrendChartContainerProps {
  /**
   * Initial tag ID list (seed only at first mount). Container owns the list
   * and handles removes via the Legend. Tag additions go through TagPickerModal.
   * When `persistKey` is set, session data takes precedence over this seed.
   */
  tagIds: number[];
  siteTimezone?: string;
  height?: number;
  /**
   * When provided, session state (tagIds, mode, spans, Y-scale overrides,
   * selected tag) is persisted in localStorage under this key and restored on
   * next mount. When undefined, persistence is off entirely.
   */
  persistKey?: string;
}

const FOOTER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '8px 0 0 0',
};

/** Returns committedThroughTs of the rightmost active tile — used as the merge seam point (§5.2). */
function getSeamCommittedThroughTs(activeTilesRef: { readonly current: ActiveTileEntry[] }): number | null {
  const active = activeTilesRef.current;
  if (active.length === 0) return null;
  return active[active.length - 1]!.committedThroughTs;
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

/** Build a ModeState from a saved session, applying the live-fixed→live-trailing
 *  reconciliation when Date.now() >= savedToMs. */
function buildInitialModeState(session: TrendViewerSessionV1): ModeState {
  const sizeMs = BigInt(session.sizeMs);
  if (session.mode === 'live-trailing') {
    return { mode: 'live-trailing', sizeMs, nowMs: BigInt(Date.now()), lastIntent: null };
  }
  const toMs = BigInt(session.toMs!);
  if (session.mode === 'live-fixed') {
    // Reconcile: if now >= savedToMs the live-fixed window has elapsed → live-trailing.
    if (Date.now() >= Number(toMs)) {
      return { mode: 'live-trailing', sizeMs, nowMs: BigInt(Date.now()), lastIntent: null };
    }
    return { mode: 'live-fixed', from: toMs - sizeMs, to: toMs, sizeMs, lastIntent: null };
  }
  // fixed
  return { mode: 'fixed', from: toMs - sizeMs, to: toMs, sizeMs, lastIntent: null };
}


export function TrendChartContainer({
  tagIds: initialTagIds,
  siteTimezone,
  height = 420,
  persistKey,
}: TrendChartContainerProps) {

  // ── Session loading (runs once — ref guards re-initialization) ────────────
  // Sentinel: undefined = "not yet initialized", null = "no session found".
  const initRef = useRef<{
    session: TrendViewerSessionV1 | null;
    modeState: ModeState | undefined;
  } | null>(null);

  if (initRef.current === null) {
    const session = persistKey ? loadSession(persistKey) : null;
    initRef.current = {
      session,
      modeState: session ? buildInitialModeState(session) : undefined,
    };
  }

  const savedSession = initRef.current.session;
  const initialModeState = initRef.current.modeState;

  // ── Mode state machine ────────────────────────────────────────────────────
  const { state: modeState, viewport: modeViewport, dispatch } = useTrendMode(initialModeState);

  // ── modeViewport-derived out-of-range booleans ────────────────────────────
  const uxRangeTooNarrow = useMemo(
    () => modeViewport.end - modeViewport.start < MIN_VIEWPORT_SPAN_MS,
    [modeViewport.start, modeViewport.end],
  );
  const uxRangeExceeded = useMemo(
    () => modeViewport.end - modeViewport.start > MAX_VIEWPORT_SPAN_MS,
    [modeViewport.start, modeViewport.end],
  );

  // ── Tag list (tagMap first so it's available in useState initializer) ─────
  const tagMap = useTagMap();

  // Tag list: seeded from session if available (filtered against current trendable set),
  // otherwise falls through to the prop. With persistKey + session → filtered or [];
  // without session → prop as-is (backward compat for non-persisted consumers).
  const [tagIds, setTagIds] = useState<number[]>(() => {
    if (!savedSession) return initialTagIds;
    const trendableIds = new Set(
      [...tagMap.values()].filter(t => t.trendable).map(t => t.tag_id),
    );
    const filtered = savedSession.tagIds.filter(id => trendableIds.has(id));
    // Empty after filtering → treat as no saved session (fall through to empty chart,
    // NOT to the prop — there is no prop default when persistKey is set).
    return filtered.length > 0 ? filtered : [];
  });

  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // ── Zoom-level state ──────────────────────────────────────────────────────
  const { currentBucketSMs, zoomAnchorSpan, handleDragZoom: _handleDragZoom, handleZoomLevelSwitch: _handleZoomLevelSwitch } = useZoomState({
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

  // ── Data fetch (driven by modeViewport + currentBucketSMs) ───────────────
  const trendData = useTrendData({
    viewport: modeViewport,
    bucketSMs: currentBucketSMs,
    tagIds,
    isLive: isLive(modeState.mode),
  });
  const { data, isLoading, swapCounter, activeTileCount, lastFetchMs } = trendData;

  // ── Stable ref for synchronous access from callbacks ─────────────────────
  const modeStateRef = useRef(modeState);
  modeStateRef.current = modeState;

  // ── Live subscription inputs ──────────────────────────────────────────────
  const viewportSpanMs = modeViewport.end - modeViewport.start;

  const tailMode: 'aggregate' | 'raw' | null =
    data?.type === 'aggregate' ? 'aggregate'
    : data?.type === 'raw'       ? 'raw'
    : null;

  const bucketSMs: bigint | null =
    data?.type === 'aggregate' ? BigInt(data.bucketSMs) : null;

  const trimThreshold: number | null = trendData.committedThroughTs ?? null;

  const seedFromCachedTile = useMemo(() => {
    if (data?.type !== 'aggregate') return null;
    const m = new Map<number, number | boolean | string | null>();
    for (const [tagId, arrs] of data.series) {
      m.set(tagId, arrs.value[arrs.value.length - 1] ?? null);
    }
    return m;
  }, [data, swapCounter]);

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

  liveSubRef.current = liveSub;

  const liveEdgeBehindWindow = (() => {
    if (modeState.mode !== 'live-fixed') return false;
    const lts = liveSubRef.current?.getLatestSampleTs() ?? null;
    if (lts === null) return false;
    return lts < modeState.from;
  })();

  // ── Merged data for rendering ─────────────────────────────────────────────
  const mergedData = useMemo(
    () => mergeTrendData(data, liveSub.tail, {
      seamCommittedThroughTs: getSeamCommittedThroughTs(trendData.activeTilesRef),
    }),
    [data, liveSub.tail, swapCounter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  const bucketSMsIndicator = data?.type === 'aggregate' ? BigInt(data.bucketSMs) : null;

  // ── dispatchModeAction: drain on Live→fixed, then dispatch ──────────────
  const dispatchModeAction = useCallback((action: TrendModeAction) => {
    const prev = modeStateRef.current;
    const next = trendModeReducer(prev, action);
    if (isLive(prev.mode) && !isLive(next.mode)) {
      liveSubRef.current?.drainBuffers();
    } else if (!isLive(prev.mode) && isLive(next.mode)) {
      trendData.invalidateNonTerminalTiles();
    }
    dispatch(action);
  }, [dispatch, trendData.invalidateNonTerminalTiles]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  // Single mutation entry point for tagIds. All callers MUST go through here
  // so the live-edge tile's committedThroughTs is invalidated before the state
  // update — otherwise the merge seam falls outside the accumulator's coverage
  // and the chart shows a null gap. See Docs/hmi_trend_viewer_deltas.md (2026-05-27)
  // and Docs/hmi_trend_viewer_spec.md §10.6/§10.7.
  const commitTagIds = useCallback((newIds: number[]) => {
    trendData.invalidateNonTerminalTiles();
    setTagIds(newIds);
  }, [trendData.invalidateNonTerminalTiles, setTagIds]);

  const handleTagRemove = useCallback((tagId: number) => {
    commitTagIds(tagIds.filter(id => id !== tagId));
  }, [commitTagIds, tagIds]);

  const rafIdRef = useRef<number | null>(null);
  const pendingRangeRef = useRef<{ min: bigint; max: bigint } | null>(null);

  const panRafIdRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ min: bigint; max: bigint } | null>(null);

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

  const handleZoomLevelSwitch = useCallback(
    (direction: 'in' | 'out') => {
      _handleZoomLevelSwitch(direction);
    },
    [_handleZoomLevelSwitch],
  );

  // ── Session persistence ───────────────────────────────────────────────────
  // Refs track the latest selectedTagId and yScaleOverrides from TrendChart
  // callbacks without lifting those values to container state (which would
  // cause extra renders on every Y-pan tick).
  const persistKeyRef = useRef(persistKey);
  persistKeyRef.current = persistKey;

  const latestSaveDataRef = useRef<{
    tagIds: number[];
    modeState: ModeState;
    selectedTagId: number | null;
    yScaleOverrides: Map<number, { min: number; max: number }>;
  }>({
    tagIds,
    modeState,
    selectedTagId: savedSession?.selectedTagId ?? null,
    yScaleOverrides: savedSession?.yScaleOverrides
      ? new Map(Object.entries(savedSession.yScaleOverrides).map(([k, v]) => [Number(k), v]))
      : new Map(),
  });

  // Always-fresh ref — keep in sync with latest state without making it a dep.
  latestSaveDataRef.current.tagIds = tagIds;
  latestSaveDataRef.current.modeState = modeState;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    const key = persistKeyRef.current;
    if (!key) return;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const { tagIds: ids, modeState: ms, selectedTagId: sel, yScaleOverrides: ys } = latestSaveDataRef.current;
      const toMs = ms.mode !== 'live-trailing' ? String(ms.to) : null;
      saveSession(key, {
        version: 1,
        tagIds: ids,
        selectedTagId: sel,
        sizeMs: String(ms.sizeMs),
        mode: ms.mode,
        toMs,
        yScaleOverrides: Object.fromEntries([...ys.entries()]),
      });
    }, 250);
  }, []);

  // Schedule a save whenever tagIds or modeState change.
  useEffect(() => {
    if (!persistKey) return;
    scheduleSave();
  }, [tagIds, modeState, persistKey, scheduleSave]);

  // Flush any pending write on unmount (avoids losing the last state change
  // if the component unmounts within the 250 ms debounce window).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const key = persistKeyRef.current;
        if (!key) return;
        const { tagIds: ids, modeState: ms, selectedTagId: sel, yScaleOverrides: ys } = latestSaveDataRef.current;
        const toMs = ms.mode !== 'live-trailing' ? String(ms.to) : null;
        saveSession(key, {
          version: 1,
          tagIds: ids,
          selectedTagId: sel,
          sizeMs: String(ms.sizeMs),
          mode: ms.mode,
          toMs,
          yScaleOverrides: Object.fromEntries([...ys.entries()]),
        });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Callbacks from TrendChart — update snapshot refs and schedule a save.
  const handleSelectedTagChange = useCallback((tagId: number) => {
    latestSaveDataRef.current.selectedTagId = tagId;
    scheduleSave();
  }, [scheduleSave]);

  const handleYScaleOverridesChange = useCallback(
    (overrides: Map<number, { min: number; max: number }>) => {
      latestSaveDataRef.current.yScaleOverrides = overrides;
      scheduleSave();
    },
    [scheduleSave],
  );

  // Initial overrides Map derived from session (stable across renders).
  const initialYScaleOverridesMapRef = useRef<Map<number, { min: number; max: number }>>(
    latestSaveDataRef.current.yScaleOverrides,
  );

  // ── Range message ─────────────────────────────────────────────────────────
  const rangeMessage = uxRangeExceeded
    ? 'Range too wide. Zoom in or pick a smaller preset.'
    : uxRangeTooNarrow
    ? 'Range too narrow. Zoom out or pick a wider preset.'
    : null;

  const footerJsx = (
    <>
      <CursorDisplay rangeMessage={rangeMessage} />
      <div style={FOOTER}>
        <div style={FOOTER_LEFT}>
          <SpanPresets state={modeState} onPreset={handlePreset} />
          <SpanIndicator spanMs={viewportSpanMs} />
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

  const chartData = (uxRangeExceeded || uxRangeTooNarrow || tagIds.length === 0)
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
    <>
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
        bucketSMs={bucketSMsIndicator}
        lastFetchMs={lastFetchMs}
        showLastWhenIdle={isLive(modeState.mode)}
        onXRangeChange={handleXRangeChange}
        onXPan={handleXPan}
        lastIntent={modeState.lastIntent}
        rangeExceeded={uxRangeExceeded}
        rangeTooNarrow={uxRangeTooNarrow}
        onSettingsClick={() => setIsPickerOpen(true)}
        initialSelectedTagId={savedSession?.selectedTagId}
        initialYScaleOverrides={persistKey ? initialYScaleOverridesMapRef.current : undefined}
        onSelectedTagChange={persistKey ? handleSelectedTagChange : undefined}
        onYScaleOverridesChange={persistKey ? handleYScaleOverridesChange : undefined}
      />
      <TagPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onCommit={commitTagIds}
        currentTagIds={tagIds}
        tagMap={tagMap}
      />
    </>
  );
}
