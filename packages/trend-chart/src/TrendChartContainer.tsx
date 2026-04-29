import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTrendMode } from './useTrendMode.js';
import { useTrendData } from './useTrendData.js';
import { TimeRangeBar } from './TimeRangeBar.js';
import { TrendChart } from './TrendChart.js';
import type { Viewport } from './types.js';

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

  // ── dataViewport: debounced behind the live mode viewport ─────────────────
  // renderViewport = modeViewport (updated immediately by mode reducer + tick)
  // dataViewport   = debounced 100 ms behind modeViewport
  const [dataViewport, setDataViewport] = useState<Viewport>(modeViewport);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDataViewport({ start: modeViewport.start, end: modeViewport.end });
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [modeViewport.start, modeViewport.end]);

  // ── Data fetch (driven by debounced viewport) ─────────────────────────────
  const { data, isLoading } = useTrendData({ viewport: dataViewport, tagIds });

  // ── xRange: passes the live mode viewport to TrendChart for imperative
  //    setScale — updated every tick in tailing, or on preset/custom/pan. ──
  const xRange = useMemo(
    () => ({ startMs: modeViewport.start, endMs: modeViewport.end }),
    [modeViewport.start, modeViewport.end],
  );

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleRangeChange = useCallback(
    (range: { startMs: bigint; endMs: bigint }, _isFinal: boolean) => {
      dispatch({
        type: 'viewportChanged',
        from: range.startMs,
        to: range.endMs,
        nowMs: BigInt(Date.now()),
      });
    },
    [dispatch],
  );

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
          onRangeChange={handleRangeChange}
          onTagRemove={handleTagRemove}
        />
      ) : (
        <div style={LOADING_HINT}>
          {isLoading ? 'Loading…' : tagIds.length === 0 ? 'No tags selected.' : null}
        </div>
      )}
    </div>
  );
}
