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
  tagIds: number[];
  siteTimezone?: string;
  width?: number;
  height?: number;
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
}: TrendChartProps) {
  const tagMap = useTagMap();

  const [selectedTagId, setSelectedTagId] = useState<number>(() => tagIds[0] ?? 0);
  const [cursorState, setCursorState] = useState<{ idx: number; left: number; top: number } | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());

  // Effective tag list: original order minus removed ones.
  const effectiveTagIds = useMemo(
    () => tagIds.filter(id => !removedIds.has(id)),
    [tagIds, removedIds],
  );

  // If the selected tag was removed, fall back to the first remaining.
  const effectiveSelectedId = effectiveTagIds.includes(selectedTagId)
    ? selectedTagId
    : (effectiveTagIds[0] ?? 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

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

  // Rebuild uPlot whenever chart config or data changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || effectiveTagIds.length === 0) {
      uplotRef.current?.destroy();
      uplotRef.current = null;
      return;
    }

    const { xs, ys } = seriesFromTrendData(data, effectiveTagIds);
    // uPlot data: [xs, ...per-tag-ys]. Null values in ys produce gaps (spanGaps:false).
    const uplotData: uPlot.AlignedData = [xs, ...ys] as uPlot.AlignedData;

    const config = buildUplotConfig({
      tagIds: effectiveTagIds,
      selectedTagId: effectiveSelectedId,
      tagMap,
      width,
      height,
      siteTimezone,
      onCursorChange,
    });

    // Destroy any prior instance before mounting a new one.
    uplotRef.current?.destroy();
    uplotRef.current = null;
    // Clear container children so uPlot starts fresh.
    container.innerHTML = '';

    uplotRef.current = new uPlot(config, uplotData, container);

    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [data, effectiveTagIds, effectiveSelectedId, tagMap, width, height, siteTimezone, onCursorChange]);

  // Compute chart bounds for tooltip snap.
  const [chartBounds, setChartBounds] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setChartBounds({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }, [width, height]);

  const handleRemove = useCallback((tagId: number) => {
    setRemovedIds(prev => new Set([...prev, tagId]));
  }, []);

  // Tooltip x position is relative to canvas container.
  const canvasBounds = canvasWrapRef.current?.getBoundingClientRect();
  const tooltipClientX = canvasBounds ? canvasBounds.left + (cursorState?.left ?? 0) : 0;
  const tooltipClientY = canvasBounds ? canvasBounds.top + (cursorState?.top ?? 0) : 0;

  return (
    <div style={{ ...WRAPPER, width: width + 24 }} ref={canvasWrapRef}>
      <div style={HEADER}>
        <ResolutionIndicator data={data} />
      </div>
      <div ref={containerRef} />
      {cursorState !== null && effectiveTagIds.length > 0 && (
        <Tooltip
          cursorIdx={cursorState.idx}
          cursorClientX={tooltipClientX}
          cursorClientY={tooltipClientY}
          chartBounds={chartBounds}
          data={data}
          tagIds={effectiveTagIds}
          tagMap={tagMap}
          siteTimezone={siteTimezone}
        />
      )}
      {effectiveTagIds.length > 0 && (
        <Legend
          tagIds={effectiveTagIds}
          data={data}
          tagMap={tagMap}
          selectedTagId={effectiveSelectedId}
          cursorIdx={cursorState?.idx}
          onSelect={setSelectedTagId}
          onRemove={handleRemove}
        />
      )}
    </div>
  );
}
