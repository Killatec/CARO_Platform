import { useCallback, useEffect, useState } from 'react';
import type { Viewport } from './types.js';
import type { LastIntent } from './useTrendMode.js';

/** Pure snap-and-center math for drag-zoom. Exported for testing. */
export function computeDragZoomViewport(
  currentBucketSMs: bigint,
  selectionStartMs: bigint,
  selectionEndMs: bigint,
  visibleTilesPerWindow: number,
  bucketCount: number,
): { newBucketSMs: bigint; newStart: bigint; newEnd: bigint } | null {
  const selectionSpan = selectionEndMs - selectionStartMs;
  if (selectionSpan <= 0n) return null;
  const targetBucketSMs = selectionSpan / BigInt(visibleTilesPerWindow * bucketCount);
  if (targetBucketSMs <= 0n) return null;
  const ratio = Number(currentBucketSMs) / Number(targetBucketSMs);
  const N = Math.round(Math.log2(ratio));
  let newBucketSMs: bigint;
  if (N > 0) {
    newBucketSMs = currentBucketSMs >> BigInt(N);
    if (newBucketSMs <= 0n) newBucketSMs = 1n;
  } else if (N < 0) {
    newBucketSMs = currentBucketSMs << BigInt(-N);
  } else {
    newBucketSMs = currentBucketSMs;
  }
  const newSpan = newBucketSMs * BigInt(visibleTilesPerWindow * bucketCount);
  const center = (selectionStartMs + selectionEndMs) / 2n;
  const newStart = center - newSpan / 2n;
  const newEnd = newStart + newSpan;
  return { newBucketSMs, newStart, newEnd };
}

export interface UseZoomStateOpts {
  modeViewport: Viewport;
  visibleTilesPerWindow: number;
  bucketCount: number;
  /** Prevents the reset effect from clobbering zoom anchor/dataViewport on sub-threshold wheel ticks. */
  lastIntent: LastIntent;
}

export interface UseZoomStateResult {
  zoomAnchorSpan: bigint;
  dataViewport: Viewport;
  /** Forces dataViewport to the given viewport, bypassing the lastIntent skip logic.
   *  Used on live → fixed transition where the reset effect would otherwise skip. */
  syncDataViewport: (v: Viewport) => void;
  handleDragZoom: (selectionStartMs: bigint, selectionEndMs: bigint) => void;
  handleZoomLevelSwitch: (direction: 'in' | 'out', cursorTimeMs: bigint) => void;
}

export function useZoomState({
  modeViewport,
  visibleTilesPerWindow,
  bucketCount,
  lastIntent,
}: UseZoomStateOpts): UseZoomStateResult {
  const [currentBucketSMs, setCurrentBucketSMs] = useState<bigint>(
    () => (modeViewport.end - modeViewport.start) / BigInt(visibleTilesPerWindow * bucketCount),
  );
  const [zoomAnchorSpan, setZoomAnchorSpan] = useState<bigint>(
    () => modeViewport.end - modeViewport.start,
  );
  const [dataViewport, setDataViewport] = useState<Viewport>(modeViewport);

  // Reset zoom level when modeViewport changes (preset click, custom commit, Live tick).
  // Skipped when lastIntent === 'zoom' or 'pan': both gestures keep the anchor/bucket
  // size intact so incremental threshold accumulation works correctly.
  useEffect(() => {
    if (lastIntent === 'zoom' || lastIntent === 'pan') return;
    const span = modeViewport.end - modeViewport.start;
    const bucketSMs = span / BigInt(visibleTilesPerWindow * bucketCount);
    setCurrentBucketSMs(bucketSMs);
    setZoomAnchorSpan(span);
    setDataViewport({ start: modeViewport.start, end: modeViewport.end });
  }, [modeViewport.start, modeViewport.end, visibleTilesPerWindow, bucketCount, lastIntent]);

  const handleDragZoom = useCallback(
    (selectionStartMs: bigint, selectionEndMs: bigint) => {
      const result = computeDragZoomViewport(
        currentBucketSMs, selectionStartMs, selectionEndMs,
        visibleTilesPerWindow, bucketCount,
      );
      if (!result) return;
      const { newBucketSMs, newStart, newEnd } = result;
      const newSpan = newEnd - newStart;
      setCurrentBucketSMs(newBucketSMs);
      setZoomAnchorSpan(newSpan);
      setDataViewport({ start: newStart, end: newEnd });
    },
    [currentBucketSMs, visibleTilesPerWindow, bucketCount],
  );

  const handleZoomLevelSwitch = useCallback(
    (direction: 'in' | 'out', cursorTimeMs: bigint) => {
      const newBucketSMs = direction === 'out' ? currentBucketSMs * 2n : currentBucketSMs / 2n;
      if (newBucketSMs <= 0n) return;
      const newSpan = newBucketSMs * BigInt(visibleTilesPerWindow * bucketCount);
      const unsaturatedStart = cursorTimeMs - newSpan / 2n;
      let newStart = unsaturatedStart;
      const saturated = newStart < 1n;
      if (saturated) newStart = 1n;
      const newEnd = newStart + newSpan;
      setCurrentBucketSMs(newBucketSMs);
      setZoomAnchorSpan(newSpan);
      setDataViewport({ start: newStart, end: newEnd });
    },
    [currentBucketSMs, visibleTilesPerWindow, bucketCount],
  );

  const syncDataViewport = useCallback((v: Viewport) => {
    setDataViewport({ start: v.start, end: v.end });
  }, []);

  return { zoomAnchorSpan, dataViewport, syncDataViewport, handleDragZoom, handleZoomLevelSwitch };
}
