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
  it('zoom-in: halves gestureBucketSMs; visible as currentBucketSMs while zooming', () => {
    // In production: handleZoomLevelSwitch fires, then zoomApplied sets lastIntent='zoom'.
    // Simulate that two-step flow with rerender.
    const { result, rerender } = renderHook(
      (opts) => useZoomState(opts),
      { initialProps: DEFAULT_OPTS },
    );
    // initial bucketSMs = ONE_HOUR_MS / (2 * 500) = 3600n
    const initialBucketSMs = result.current.currentBucketSMs;
    act(() => { result.current.handleZoomLevelSwitch('in'); });
    rerender({ ...DEFAULT_OPTS, lastIntent: 'zoom' as LastIntent });
    expect(result.current.currentBucketSMs).toBe(initialBucketSMs / 2n);
    // newSpan = (initialBucketSMs/2) * 2 * 500 = ONE_HOUR_MS / 2
    expect(result.current.zoomAnchorSpan).toBe(ONE_HOUR_MS / 2n);
  });

  it('zoom-out: doubles gestureBucketSMs; visible as currentBucketSMs while zooming', () => {
    const { result, rerender } = renderHook(
      (opts) => useZoomState(opts),
      { initialProps: DEFAULT_OPTS },
    );
    const initialBucketSMs = result.current.currentBucketSMs; // 3600n
    act(() => { result.current.handleZoomLevelSwitch('out'); });
    rerender({ ...DEFAULT_OPTS, lastIntent: 'zoom' as LastIntent });
    expect(result.current.currentBucketSMs).toBe(initialBucketSMs * 2n);
    // newSpan = (initialBucketSMs*2) * 2 * 500 = ONE_HOUR_MS * 2
    expect(result.current.zoomAnchorSpan).toBe(ONE_HOUR_MS * 2n);
  });

  it('does not expose dataViewport — no cursor-centered viewport shift', () => {
    const { result } = renderHook(() => useZoomState(DEFAULT_OPTS));
    // The result must not have a dataViewport property (eliminated by this fix).
    expect((result.current as Record<string, unknown>)['dataViewport']).toBeUndefined();
  });

  it('zero newBucketSMs guard: returns without state update', () => {
    const opts = {
      ...DEFAULT_OPTS,
      // Start with bucketSMs=1n (tiny viewport) so zoom-in halves to 0n.
      modeViewport: { start: 0n, end: 1000n }, // span=1000ms, bucketSMs=1n
    };
    const { result } = renderHook(() => useZoomState(opts));
    const beforeBucketSMs = result.current.currentBucketSMs;
    const beforeAnchorSpan = result.current.zoomAnchorSpan;
    act(() => { result.current.handleZoomLevelSwitch('in'); });
    // newBucketSMs = 1n / 2n = 0n → guard rejects, gestureBucketSMs unchanged.
    // While not zooming, currentBucketSMs = derivedBucketSMs = 1n = beforeBucketSMs.
    expect(result.current.currentBucketSMs).toBe(beforeBucketSMs);
    expect(result.current.zoomAnchorSpan).toBe(beforeAnchorSpan);
  });
});

// ── Render-time derivation — storm fix ───────────────────────────────────────

describe('useZoomState — render-time derivation (storm fix)', () => {
  it('preset update: currentBucketSMs reflects new modeViewport span in the same render', () => {
    // Verifies the storm fix: a wide preset click must never produce a render where
    // the new wide modeViewport is paired with the old narrow bucketSMs. The old
    // effect-based reset lagged by one render, causing tilesForViewport to emit
    // hundreds of tiles (e.g. 24h at 1m resolution ≈ 1440 tiles).
    const { result, rerender } = renderHook(
      (opts) => useZoomState(opts),
      {
        initialProps: {
          ...DEFAULT_OPTS,
          modeViewport: { start: MODERN_START, end: MODERN_START + 60_000n }, // 1 min
          lastIntent: 'preset' as LastIntent,
        },
      },
    );
    // 1min: bucketSMs = 60_000n / (2 * 500) = 60n
    expect(result.current.currentBucketSMs).toBe(60n);

    // Simulate a 24h preset click: modeViewport jumps, lastIntent stays 'preset'.
    rerender({
      ...DEFAULT_OPTS,
      modeViewport: { start: MODERN_START, end: MODERN_START + 86_400_000n }, // 24 hours
      lastIntent: 'preset' as LastIntent,
    });

    // Derived immediately in the same render — no stale 60n from the 1m preset.
    expect(result.current.currentBucketSMs).toBe(86_400_000n / 1000n); // 86_400n
  });

  it('zoom intent: currentBucketSMs stays sticky when modeViewport grows', () => {
    // Verifies the wheel-zoom coverage fix: during a gesture, continuous viewport
    // growth must NOT change the resolution (tile IDs must stay stable).
    const { result, rerender } = renderHook(
      (opts) => useZoomState(opts),
      { initialProps: { ...DEFAULT_OPTS, lastIntent: 'zoom' as LastIntent } },
    );
    const stickyBucketSMs = result.current.currentBucketSMs; // gestureBucketSMs at mount

    // Viewport grows (continuous wheel-zoom out); lastIntent stays 'zoom'.
    rerender({
      ...DEFAULT_OPTS,
      lastIntent: 'zoom' as LastIntent,
      modeViewport: { start: MODERN_START - ONE_HOUR_MS, end: MODERN_START + 2n * ONE_HOUR_MS },
    });

    // Sticky: currentBucketSMs uses gestureBucketSMs, not re-derived from the wider viewport.
    expect(result.current.currentBucketSMs).toBe(stickyBucketSMs);
  });

  it('non-zoom intent after zoom: currentBucketSMs immediately re-derives from new modeViewport', () => {
    const twoHourViewport = { start: MODERN_START, end: MODERN_START + 2n * ONE_HOUR_MS };
    const { result, rerender } = renderHook(
      (opts) => useZoomState(opts),
      { initialProps: { ...DEFAULT_OPTS, lastIntent: 'zoom' as LastIntent } },
    );

    // Transition back to non-zoom intent with a new 2h viewport.
    rerender({ ...DEFAULT_OPTS, lastIntent: 'preset' as LastIntent, modeViewport: twoHourViewport });

    // Immediately returns derivedBucketSMs from the 2h viewport: 7_200_000n / 1000n = 7200n.
    expect(result.current.currentBucketSMs).toBe(7200n);
  });

  it('handleDragZoom sets gestureBucketSMs; visible as currentBucketSMs while zooming', () => {
    const { result, rerender } = renderHook(
      (opts) => useZoomState(opts),
      { initialProps: DEFAULT_OPTS },
    );
    // 1h viewport: currentBucketSMs = 3600n. Drag-zoom to a 30-min selection.
    const selStart = MODERN_START + ONE_HOUR_MS / 4n;
    const selEnd   = selStart + ONE_HOUR_MS / 2n; // 30 min

    act(() => { result.current.handleDragZoom(selStart, selEnd); });
    // Simulate zoomApplied setting lastIntent = 'zoom'.
    rerender({ ...DEFAULT_OPTS, lastIntent: 'zoom' as LastIntent });

    // selSpan=1_800_000n / 1000 = 1800n target; log2(3600/1800) = 1; newBucketSMs = 3600n >> 1n = 1800n.
    expect(result.current.currentBucketSMs).toBe(1800n);
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
