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
  /** Prevents the reset effect from clobbering zoom anchor on sub-threshold wheel ticks. */
  lastIntent: LastIntent;
}

export interface UseZoomStateResult {
  currentBucketSMs: bigint;
  zoomAnchorSpan: bigint;
  handleDragZoom: (selectionStartMs: bigint, selectionEndMs: bigint) => void;
  handleZoomLevelSwitch: (direction: 'in' | 'out') => void;
}

export function useZoomState({
  modeViewport,
  visibleTilesPerWindow,
  bucketCount,
  lastIntent,
}: UseZoomStateOpts): UseZoomStateResult {
  const buckets = BigInt(visibleTilesPerWindow * bucketCount);
  const modeViewportSpan = modeViewport.end - modeViewport.start;

  // Pure render-time derivation: always consistent with modeViewport in the same render.
  // Eliminates the one-render lag that fired a tile storm on large preset jumps (a wide
  // modeViewport paired with the previous narrow gestureBucketSMs for one render).
  const derivedBucketSMs = modeViewportSpan / buckets;

  // Sticky resolution consumed ONLY during a wheel-zoom gesture (lastIntent === 'zoom').
  // Initialized from derivedBucketSMs so the first gesture starts from the correct baseline.
  const [gestureBucketSMs, setGestureBucketSMs] = useState<bigint>(derivedBucketSMs);

  const isZooming = lastIntent === 'zoom';

  // When zooming: use the sticky gesture resolution so continuous wheel-zoom does not
  // re-derive a new (larger) resolution from the growing modeViewport on each tick.
  // When not zooming: use derivedBucketSMs — always fresh in the same render as the intent.
  const currentBucketSMs = isZooming ? gestureBucketSMs : derivedBucketSMs;
  const zoomAnchorSpan   = isZooming ? gestureBucketSMs * buckets : modeViewportSpan;

  // Keep gestureBucketSMs in sync with derivedBucketSMs while not zooming, so the next
  // gesture starts from the correct baseline. The lag is harmless: while not zooming,
  // currentBucketSMs reads derivedBucketSMs directly, not gestureBucketSMs.
  //
  // Critically, this effect's deps are [derivedBucketSMs, isZooming]. When
  // handleZoomLevelSwitch fires (still with the old lastIntent), neither dep changes —
  // so the effect is NOT re-run and does not reset the newly written gestureBucketSMs.
  useEffect(() => {
    if (isZooming) return;
    setGestureBucketSMs(derivedBucketSMs);
  }, [derivedBucketSMs, isZooming]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragZoom = useCallback(
    (selectionStartMs: bigint, selectionEndMs: bigint) => {
      const result = computeDragZoomViewport(
        currentBucketSMs, selectionStartMs, selectionEndMs,
        visibleTilesPerWindow, bucketCount,
      );
      if (!result) return;
      setGestureBucketSMs(result.newBucketSMs);
    },
    [currentBucketSMs, visibleTilesPerWindow, bucketCount],
  );

  // Stable callback ([] deps) — uses functional update so it never captures stale state.
  const handleZoomLevelSwitch = useCallback(
    (direction: 'in' | 'out') => {
      setGestureBucketSMs(prev => {
        const next = direction === 'out' ? prev * 2n : prev / 2n;
        return next <= 0n ? prev : next;
      });
    },
    [],
  );

  return { currentBucketSMs, zoomAnchorSpan, handleDragZoom, handleZoomLevelSwitch };
}
