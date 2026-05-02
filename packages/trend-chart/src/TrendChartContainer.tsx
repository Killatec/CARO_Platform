import { useCallback, useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTrendMode } from './useTrendMode.js';
import { useTrendData } from './useTrendData.js';
import { useZoomState } from './useZoomState.js';
import { TimeRangeBar } from './TimeRangeBar.js';
import { TrendChart } from './TrendChart.js';
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
  width?: number;
  height?: number;
}

const CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'monospace',
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
  width = 900,
  height = 420,
}: TrendChartContainerProps) {
  // ── Mode state machine ────────────────────────────────────────────────────
  const { state: modeState, viewport: modeViewport, dispatch } = useTrendMode();

  // ── Tag list (container owns; removes come from Legend via TrendChart) ────
  const [tagIds, setTagIds] = useState<number[]>(initialTagIds);

  // ── Zoom-level state ──────────────────────────────────────────────────────
  const { zoomAnchorSpan, dataViewport, handleDragZoom, handleZoomLevelSwitch } = useZoomState({
    modeViewport,
    visibleTilesPerWindow: VISIBLE_TILES_PER_WINDOW,
    bucketCount: BUCKET_COUNT,
  });

  // ── Data fetch (driven by explicit dataViewport) ──────────────────────────
  const { data, isLoading, ensureCovered, swapCounter, activeTileCount } = useTrendData({ viewport: dataViewport, tagIds });

  // ── xRange: passes the live mode viewport to TrendChart for imperative
  //    setScale — updated every tick in tailing, or on preset/custom/pan. ──
  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleTagRemove = useCallback((tagId: number) => {
    setTagIds(prev => prev.filter(id => id !== tagId));
  }, []);

  const handlePreset = useCallback(
    (sizeMs: bigint) => {
      dispatch({ type: 'presetClicked', sizeMs, nowMs: BigInt(Date.now()) });
    },
    [dispatch],
  );

  const handleLive = useCallback(() => {
    dispatch({ type: 'liveClicked', nowMs: BigInt(Date.now()) });
  }, [dispatch]);

  const handleCustom = useCallback(
    (from: bigint, to: bigint) => {
      dispatch({ type: 'customCommitted', from, to, nowMs: BigInt(Date.now()) });
    },
    [dispatch],
  );

  return (
    <div style={CONTAINER}>
      <TimeRangeBar
        mode={modeState}
        viewport={modeViewport}
        siteTimezone={siteTimezone}
        onPreset={handlePreset}
        onLive={handleLive}
        onCustom={handleCustom}
      />
      {data ? (
        <TrendChart
          data={data}
          tagIds={tagIds}
          siteTimezone={siteTimezone}
          width={width}
          height={height}
          xRange={xRange}
          onTagRemove={handleTagRemove}
          ensureCovered={ensureCovered}
          zoomAnchorSpan={zoomAnchorSpan}
          onZoomLevelSwitch={handleZoomLevelSwitch}
          swapCounter={swapCounter}
          activeTileCount={activeTileCount}
          onDragZoom={handleDragZoom}
        />
      ) : (
        <div style={LOADING_HINT}>
          {isLoading ? 'Loading…' : tagIds.length === 0 ? 'No tags selected.' : null}
        </div>
      )}
    </div>
  );
}
