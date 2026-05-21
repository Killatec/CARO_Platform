import { describe, it, expect, vi, beforeEach } from 'vitest';
import type uPlot from 'uplot';
import { isInYAxisHitZone, panYScale, zoomYScale, pruneRemovedTagOverrides, isInXAxisHitZone, panXScale, zoomXScale } from '../src/axisInteractions.js';

// TrendChart.tsx imports uPlot and its CSS — mock both so the module loads in jsdom.
vi.mock('uplot', () => {
  const M = vi.fn();
  (M as unknown as Record<string, unknown>).paths = { stepped: vi.fn(() => vi.fn()) };
  return { default: M };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
// Also mock the React context import so the module resolves without a provider.
vi.mock('@caro/hmi-context', () => ({
  useTagMap: () => new Map(),
  MockHmiProvider: ({ children }: { children: unknown }) => children,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeU(
  overRect: DOMRect,
  scales: Record<string, { min: number; max: number }>,
  overClientHeight = overRect.bottom - overRect.top,
): { u: uPlot; setScale: ReturnType<typeof vi.fn> } {
  const setScale = vi.fn();
  const over = document.createElement('div');
  vi.spyOn(over, 'getBoundingClientRect').mockReturnValue(overRect);
  Object.defineProperty(over, 'clientHeight', { get: () => overClientHeight, configurable: true });

  const u = {
    over,
    scales: Object.fromEntries(
      Object.entries(scales).map(([k, v]) => [k, { min: v.min, max: v.max }]),
    ),
    setScale,
  } as unknown as uPlot;

  return { u, setScale };
}

// ── isInYAxisHitZone ──────────────────────────────────────────────────────────

describe('isInYAxisHitZone', () => {
  // u.over occupies clientX 200–800, clientY 50–450.
  const rect = makeRect(200, 50, 800, 450);
  let u: uPlot;

  beforeEach(() => {
    ({ u } = makeU(rect, {}));
  });

  it('returns true for a point in the left margin (just left of over)', () => {
    expect(isInYAxisHitZone(u, 199, 250)).toBe(true);
  });

  it('returns true at the leftmost boundary of the 100px hit zone', () => {
    expect(isInYAxisHitZone(u, 100, 250)).toBe(true); // 200 - 100 = 100
  });

  it('returns false more than 100px to the left of over', () => {
    expect(isInYAxisHitZone(u, 99, 250)).toBe(false);
  });

  it('returns false at over.left (plot area boundary)', () => {
    expect(isInYAxisHitZone(u, 200, 250)).toBe(false); // must be strictly left
  });

  it('returns false inside the plot area (right of over.left)', () => {
    expect(isInYAxisHitZone(u, 500, 250)).toBe(false);
  });

  it('returns false above over (clientY < r.top)', () => {
    expect(isInYAxisHitZone(u, 150, 49)).toBe(false);
  });

  it('returns false below over (clientY > r.bottom)', () => {
    expect(isInYAxisHitZone(u, 150, 451)).toBe(false);
  });

  it('returns true at the top edge of over (clientY === r.top)', () => {
    expect(isInYAxisHitZone(u, 150, 50)).toBe(true);
  });

  it('returns true at the bottom edge of over (clientY === r.bottom)', () => {
    expect(isInYAxisHitZone(u, 150, 450)).toBe(true);
  });
});

// ── panYScale ─────────────────────────────────────────────────────────────────

describe('panYScale', () => {
  it('pans down (dyPx > 0): min and max increase by (dyPx/overH)*span', () => {
    // scale 0→100, overH=400, drag down 40px → dataDy = (40/400)*100 = 10
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } });
    panYScale(u, 'y_1', 40, 400);
    expect(setScale).toHaveBeenCalledOnce();
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(10);
    expect(opts.max).toBeCloseTo(110);
  });

  it('pans up (dyPx < 0): min and max decrease', () => {
    // scale 0→100, overH=400, drag up 40px → dataDy = -10
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } });
    panYScale(u, 'y_1', -40, 400);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(-10);
    expect(opts.max).toBeCloseTo(90);
  });

  it('does nothing when scale key is not present', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), {});
    panYScale(u, 'y_99', 40, 400);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('does nothing when overHeightPx is zero', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } });
    panYScale(u, 'y_1', 40, 0);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('does nothing when the scale span is zero (min === max)', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 50, max: 50 } });
    panYScale(u, 'y_1', 40, 400);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('preserves the relative pixel position of any data point during the pan', () => {
    // scale 10→110 (span=100), overH=200, drag down 50px.
    // dataDy = (50/200)*100 = 25. The point at data=35 was at frac=(35-10)/100=0.25
    // from bottom. After pan: min=35, max=135. frac=(35-35)/100=0. Point moved to bottom.
    // More importantly: the grab-point (data under cursor) stays at same pixel.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 10, max: 110 } });
    panYScale(u, 'y_1', 50, 200);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(35);
    expect(opts.max).toBeCloseTo(135);
  });
});

// ── zoomYScale ────────────────────────────────────────────────────────────────

describe('zoomYScale', () => {
  // scale 0→100 (span=100), overH=400.

  it('zoom out (deltaY > 0): span increases by factor 1.2', () => {
    // cursor at mid (cursorYPx=200): cursorFrac=0.5, cursorY=50.
    // newSpan = 100*1.2 = 120. min=50-0.5*120=−10, max=50+0.5*120=110.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', 1, 200, 400);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(-10);
    expect(opts.max).toBeCloseTo(110);
  });

  it('zoom in (deltaY < 0): span decreases by factor 1/1.2', () => {
    // cursor at mid: cursorY=50, newSpan=100/1.2≈83.33. min=50-41.67=8.33, max=91.67.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', -1, 200, 400);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(100 / 2 - (100 / 1.2) / 2, 5);
    expect(opts.max).toBeCloseTo(100 / 2 + (100 / 1.2) / 2, 5);
  });

  it('zoom anchored at top (cursorYPx=0): top boundary stays fixed on zoom out', () => {
    // cursorFrac=1, cursorY=100 (top). newSpan=120. min=100-120=−20, max=100.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', 1, 0, 400);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.max).toBeCloseTo(100); // top fixed
    expect(opts.min).toBeCloseTo(-20);
  });

  it('zoom anchored at bottom (cursorYPx=overH): bottom boundary stays fixed on zoom out', () => {
    // cursorFrac=0, cursorY=0 (bottom). newSpan=120. min=0, max=0+120=120.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', 1, 400, 400);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(0); // bottom fixed
    expect(opts.max).toBeCloseTo(120);
  });

  it('cursor data-Y is preserved across the zoom (invariant)', () => {
    // cursorYPx=100 → cursorFrac = 1 - 100/400 = 0.75 → cursorY = 0 + 0.75*100 = 75.
    // After zoom: the pixel at cursorYPx=100 should still correspond to cursorY=75.
    // Verification: frac = (75 - new_min) / new_span === 0.75.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', 1, 100, 400); // zoom out at cursorYPx=100
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    const newSpan = opts.max - opts.min;
    const fracAfter = (75 - opts.min) / newSpan;
    expect(fracAfter).toBeCloseTo(0.75, 5);
  });

  it('does nothing when scale key is not present', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), {}, 400);
    zoomYScale(u, 'y_99', 1, 200, 400);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('does nothing when overHeightPx is zero', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', 1, 200, 0);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('does nothing when the scale span is zero', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 50, max: 50 } }, 400);
    zoomYScale(u, 'y_1', 1, 200, 400);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('respects a custom factor parameter', () => {
    // factor=2: zoom out doubles the span. cursor at mid → newSpan=200, min=−50, max=150.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_1': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_1', 1, 200, 400, 2);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(-50);
    expect(opts.max).toBeCloseTo(150);
  });
});

// ── pruneRemovedTagOverrides ──────────────────────────────────────────────────

describe('pruneRemovedTagOverrides', () => {
  it('removes all entries when currentTagIds is empty', () => {
    const m = new Map([[1, { min: 0, max: 100 }], [2, { min: -1, max: 1 }]]);
    pruneRemovedTagOverrides(m, []);
    expect(m.size).toBe(0);
  });

  it('is a no-op when the overrides map is empty', () => {
    const m = new Map<number, { min: number; max: number }>();
    pruneRemovedTagOverrides(m, [1, 2, 3]);
    expect(m.size).toBe(0);
  });

  it('makes no removals when all overridden tags are still current', () => {
    const m = new Map([[1, { min: 0, max: 100 }], [2, { min: -1, max: 1 }]]);
    pruneRemovedTagOverrides(m, [1, 2, 3]);
    expect(m.size).toBe(2);
    expect(m.has(1)).toBe(true);
    expect(m.has(2)).toBe(true);
  });

  it('removes only the entries whose tagIds are no longer current', () => {
    const m = new Map([[1, { min: 0, max: 100 }], [2, { min: -1, max: 1 }], [3, { min: 5, max: 50 }]]);
    pruneRemovedTagOverrides(m, [1, 3]); // tag 2 removed
    expect(m.has(1)).toBe(true);
    expect(m.has(2)).toBe(false);
    expect(m.has(3)).toBe(true);
  });

  it('preserves the value of retained entries intact', () => {
    const entry = { min: 25, max: 75 };
    const m = new Map([[7, entry], [8, { min: 0, max: 1 }]]);
    pruneRemovedTagOverrides(m, [7]);
    expect(m.get(7)).toEqual({ min: 25, max: 75 });
  });
});

// ── isInXAxisHitZone ──────────────────────────────────────────────────────────

describe('isInXAxisHitZone', () => {
  // u.over occupies clientX 200–800, clientY 50–450.
  const rect = makeRect(200, 50, 800, 450);
  let u: uPlot;

  beforeEach(() => {
    ({ u } = makeU(rect, {}));
  });

  it('returns true for a point just below over (clientY = r.bottom + 1)', () => {
    expect(isInXAxisHitZone(u, 500, 451)).toBe(true);
  });

  it('returns false at r.bottom exactly (must be strictly below)', () => {
    expect(isInXAxisHitZone(u, 500, 450)).toBe(false);
  });

  it('returns true at exactly r.bottom + 100', () => {
    expect(isInXAxisHitZone(u, 500, 550)).toBe(true);
  });

  it('returns false more than 100px below over', () => {
    expect(isInXAxisHitZone(u, 500, 551)).toBe(false);
  });

  it('returns false when clientX < r.left', () => {
    expect(isInXAxisHitZone(u, 199, 480)).toBe(false);
  });

  it('returns true at the left edge (clientX === r.left)', () => {
    expect(isInXAxisHitZone(u, 200, 480)).toBe(true);
  });

  it('returns false when clientX > r.right', () => {
    expect(isInXAxisHitZone(u, 801, 480)).toBe(false);
  });

  it('returns true at the right edge (clientX === r.right)', () => {
    expect(isInXAxisHitZone(u, 800, 480)).toBe(true);
  });
});

// ── panXScale ─────────────────────────────────────────────────────────────────

describe('panXScale', () => {
  it('drag right (dxPx > 0): min and max decrease — window shifts left to older data', () => {
    // scale 0→3600, overW=800, drag right 80px → dataDx=(80/800)*3600=360
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    panXScale(u, 80, 800);
    expect(setScale).toHaveBeenCalledOnce();
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(-360);
    expect(opts.max).toBeCloseTo(3240);
  });

  it('drag left (dxPx < 0): min and max increase — window shifts right to newer data', () => {
    // scale 0→3600, overW=800, drag left 80px → dataDx=-360 → new min=360, max=3960
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    panXScale(u, -80, 800);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(360);
    expect(opts.max).toBeCloseTo(3960);
  });

  it('does nothing when x scale is absent', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), {});
    panXScale(u, 80, 800);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('does nothing when overWidthPx is zero', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    panXScale(u, 80, 0);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('does nothing when the scale span is zero (min === max)', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 100, max: 100 } });
    panXScale(u, 80, 800);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('span and endpoints are preserved correctly across a known pan', () => {
    // scale 1000→5000 (span=4000), overW=500, drag right 100px → dataDx=(100/500)*4000=800
    // new min = 1000-800 = 200, new max = 5000-800 = 4200 (span unchanged at 4000)
    const { u, setScale } = makeU(makeRect(0, 0, 500, 400), { 'x': { min: 1000, max: 5000 } });
    panXScale(u, 100, 500);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(200);
    expect(opts.max).toBeCloseTo(4200);
    expect(opts.max - opts.min).toBeCloseTo(4000);
  });
});

// ── zoomXScale ────────────────────────────────────────────────────────────────
//
// scale x: 0→3600 (span=3600s), overW=800px unless noted.

describe('zoomXScale', () => {
  it('zoom in (deltaY < 0) at mid-cursor → span shrinks by factor 1.2, anchored at center', () => {
    // cursorFrac=0.5, cursorX=1800. newSpan=3600/1.2=3000. min=1800−0.5*3000=300, max=3300.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    zoomXScale(u, -1, 400, 800);
    expect(setScale).toHaveBeenCalledOnce();
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(300);
    expect(opts.max).toBeCloseTo(3300);
  });

  it('zoom out (deltaY > 0) at mid-cursor → span grows by factor 1.2, anchored at center', () => {
    // cursorFrac=0.5, cursorX=1800. newSpan=3600*1.2=4320. min=1800−0.5*4320=−360, max=3960.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    zoomXScale(u, 1, 400, 800);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(-360);
    expect(opts.max).toBeCloseTo(3960);
  });

  it('zoom anchored at left edge (cursorXPx=0) → xMin is preserved across zoom', () => {
    // cursorFrac=0, cursorX=0 (=xMin). newSpan=4320. min=0−0*4320=0, max=0+1*4320=4320.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    zoomXScale(u, 1, 0, 800);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(0);  // xMin preserved
    expect(opts.max).toBeCloseTo(4320);
  });

  it('zoom anchored at right edge (cursorXPx=overWidthPx) → xMax is preserved across zoom', () => {
    // cursorFrac=1, cursorX=3600 (=xMax). newSpan=4320. min=3600−1*4320=−720, max=3600+0*4320=3600.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    zoomXScale(u, 1, 800, 800);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.max).toBeCloseTo(3600);  // xMax preserved
    expect(opts.min).toBeCloseTo(-720);
  });

  it('missing x scale → no-op', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), {});
    zoomXScale(u, -1, 400, 800);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('zero overWidthPx → no-op', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    zoomXScale(u, -1, 400, 0);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('zero span (xMin === xMax) → no-op', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 1800, max: 1800 } });
    zoomXScale(u, -1, 400, 800);
    expect(setScale).not.toHaveBeenCalled();
  });

  it('custom factor 2.0: zoom out doubles the span, anchored at center', () => {
    // cursorFrac=0.5, cursorX=1800. newSpan=3600*2=7200. min=1800−0.5*7200=−1800, max=5400.
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'x': { min: 0, max: 3600 } });
    zoomXScale(u, 1, 400, 800, 2.0);
    const [, opts] = setScale.mock.calls[0] as [string, { min: number; max: number }];
    expect(opts.min).toBeCloseTo(-1800);
    expect(opts.max).toBeCloseTo(5400);
  });
});

// ── Y-axis helpers never mutate the X scale ───────────────────────────────────
//
// Invariant guarded here: under the Step 11 dispatchModeAction semantics, any call
// to onXRangeChange or onXPan from a Y-axis event path would exit tailing mode,
// drain the live buffer, and freeze the chart. These tests confirm that panYScale
// and zoomYScale always call setScale with the supplied Y key and never with 'x'.

describe('Y-axis helpers never mutate the X scale', () => {
  it('panYScale calls setScale with the provided Y key, never "x"', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_42': { min: 0, max: 100 } });
    panYScale(u, 'y_42', 40, 400);
    expect(setScale).toHaveBeenCalledOnce();
    const [key] = setScale.mock.calls[0] as [string, unknown];
    expect(key).toBe('y_42');
    expect(key).not.toBe('x');
  });

  it('zoomYScale calls setScale with the provided Y key, never "x"', () => {
    const { u, setScale } = makeU(makeRect(0, 0, 800, 400), { 'y_42': { min: 0, max: 100 } }, 400);
    zoomYScale(u, 'y_42', 1, 200, 400);
    expect(setScale).toHaveBeenCalledOnce();
    const [key] = setScale.mock.calls[0] as [string, unknown];
    expect(key).toBe('y_42');
    expect(key).not.toBe('x');
  });
});
