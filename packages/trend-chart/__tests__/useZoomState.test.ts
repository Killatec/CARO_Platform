import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZoomState, computeDragZoomViewport } from '../src/useZoomState.js';
import type { LastIntent } from '../src/useTrendMode.js';

// A modern viewport base so initial currentBucketSMs is well above zero.
const MODERN_START = 1_746_000_000_000n; // ~2025-04-30
const ONE_HOUR_MS  = 3_600_000n;

const DEFAULT_OPTS = {
  modeViewport: { start: MODERN_START, end: MODERN_START + ONE_HOUR_MS },
  visibleTilesPerWindow: 2,
  bucketCount: 500,
  lastIntent: 'preset' as LastIntent,
};

// ── handleZoomLevelSwitch ─────────────────────────────────────────────────────

describe('useZoomState — handleZoomLevelSwitch', () => {
  it('normal cursor: newStart is positive', () => {
    const { result } = renderHook(() => useZoomState(DEFAULT_OPTS));
    const midpoint = MODERN_START + ONE_HOUR_MS / 2n;
    act(() => { result.current.handleZoomLevelSwitch('in', midpoint); });
    expect(result.current.dataViewport.start).toBeGreaterThan(1n);
  });

  it('near-epoch cursor (cursorTimeMs=0n): newStart is clamped to 1n', () => {
    const { result } = renderHook(() => useZoomState(DEFAULT_OPTS));
    act(() => { result.current.handleZoomLevelSwitch('in', 0n); });
    // Without clamp: newStart = 0n - newSpan/2n → large negative.
    expect(result.current.dataViewport.start).toBeGreaterThanOrEqual(1n);
  });

  it('negative implied start (cursorTimeMs = 1ms): clamped to 1n', () => {
    const { result } = renderHook(() => useZoomState(DEFAULT_OPTS));
    // initial bucketSMs = ONE_HOUR_MS / (2 * 500) = 3600n
    // after 'in': newBucketSMs = 1800n, newSpan = 1_800_000n
    // newStart = 1n - 900_000n = -899_999n → clamped to 1n
    act(() => { result.current.handleZoomLevelSwitch('in', 1n); });
    expect(result.current.dataViewport.start).toBe(1n);
  });

  it('zoom-out: newSpan doubles, positive start preserved', () => {
    const { result } = renderHook(() => useZoomState(DEFAULT_OPTS));
    const cursor = MODERN_START + ONE_HOUR_MS / 2n;
    act(() => { result.current.handleZoomLevelSwitch('out', cursor); });
    // newBucketSMs = 3600*2 = 7200n, newSpan = 7_200_000n
    // newStart = cursor - 3_600_000n — still a modern timestamp
    expect(result.current.dataViewport.start).toBeGreaterThan(1n);
    expect(result.current.dataViewport.end).toBeGreaterThan(result.current.dataViewport.start);
  });

  it('zero newBucketSMs guard: returns without state update', () => {
    const opts = {
      ...DEFAULT_OPTS,
      // Start with bucketSMs=1n (tiny viewport) so zoom-in halves to 0n.
      modeViewport: { start: 0n, end: 1000n }, // span=1000ms, bucketSMs=1n
    };
    const { result } = renderHook(() => useZoomState(opts));
    const before = result.current.dataViewport;
    act(() => { result.current.handleZoomLevelSwitch('in', 500n); });
    // newBucketSMs = 1n / 2n = 0n → early return, no state change
    expect(result.current.dataViewport).toEqual(before);
  });
});

// ── computeDragZoomViewport (pure, already exported) ─────────────────────────

describe('computeDragZoomViewport', () => {
  it('returns null for zero-span selection', () => {
    expect(computeDragZoomViewport(3600n, 1000n, 1000n, 2, 500)).toBeNull();
  });

  it('centers the new viewport on the selection midpoint', () => {
    const result = computeDragZoomViewport(3600n, 0n, 3_600_000n, 2, 500);
    expect(result).not.toBeNull();
    const center = (result!.newStart + result!.newEnd) / 2n;
    // Selection midpoint = 1_800_000n; center should be close (within 1 bucket of drift).
    expect(Number(center - 1_800_000n)).toBeLessThan(Number(result!.newEnd - result!.newStart) / 500);
  });
});
