import { describe, it, expect, vi } from 'vitest';

// Real uPlot (for uPlot.join) calls matchMedia at import; jsdom has none.
vi.hoisted(() => {
  window.matchMedia ??= (() => ({
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

import { buildTrace, buildZone, buildData } from '../SpecAChart.js';

describe('buildTrace', () => {
  it('maps bins to MHz from Spec_Start and Spec_Bin, and dB x 10 to dBFS', () => {
    const t = buildTrace([-900, -230, -455], 912.5, 5000);
    expect(t!.x).toEqual([912.5, 912.505, 912.51]);
    expect(t!.y).toEqual([-90, -23, -45.5]);
  });

  it('treats an empty array as no frame', () => {
    expect(buildTrace([], 0, 0)).toBeNull();
  });

  it('treats a stalled (null) spectrum or axis as no frame', () => {
    expect(buildTrace(null, 912.5, 5000)).toBeNull();
    expect(buildTrace([-900], null, 5000)).toBeNull();
    expect(buildTrace([-900], 912.5, null)).toBeNull();
  });

  it('treats a non-positive Spec_Bin as no frame', () => {
    expect(buildTrace([-900, -800], 912.5, 0)).toBeNull();
  });
});

describe('buildZone', () => {
  it('draws two detection flanks and a guard band centred on Spec_Intk_Freq_Mon', () => {
    // Band 200 kHz -> +/-0.1 MHz around 915.5
    const z = buildZone(-45, 200, 915.5, 912.5, 917.5)!;
    expect(z.level).toBe(-45);
    expect(z.rects).toHaveLength(3);
    expect(z.rects[0]).toMatchObject({ x0: 912.5 });
    expect(z.rects[0].x1).toBeCloseTo(915.4);
    expect(z.rects[1].x0).toBeCloseTo(915.6);
    expect(z.rects[1].x1).toBe(917.5);
    expect(z.rects[2].x0).toBeCloseTo(915.4);
    expect(z.rects[2].x1).toBeCloseTo(915.6);
  });

  it('omits a flank when the guard band runs past that end and clips the guard band', () => {
    const z = buildZone(-45, 2000, 912.6, 912.5, 917.5)!;
    expect(z.rects).toHaveLength(2);
    expect(z.rects[0].x0).toBeCloseTo(913.6);
    expect(z.rects[0].x1).toBe(917.5);
    expect(z.rects[1].x0).toBe(912.5);
    expect(z.rects[1].x1).toBeCloseTo(913.6);
  });

  it('returns null when a zone tag is missing', () => {
    expect(buildZone(null, 200, 915.5, 912.5, 917.5)).toBeNull();
    expect(buildZone(-45, null, 915.5, 912.5, 917.5)).toBeNull();
    expect(buildZone(-45, 200, null, 912.5, 917.5)).toBeNull();
  });
});

describe('buildData', () => {
  const live = { x: [1, 2, 3], y: [-10, -20, -30] };
  const off = { x: [2, 3, 4], y: [-1, -2, -3] };

  it('returns three empty columns with no traces', () => {
    expect(buildData(null, null)).toEqual([[], [], []]);
  });

  it('pads the missing trace with nulls', () => {
    expect(buildData(live, null)).toEqual([[1, 2, 3], [-10, -20, -30], [null, null, null]]);
    expect(buildData(null, off)).toEqual([[2, 3, 4], [null, null, null], [-1, -2, -3]]);
  });

  it('merges two traces on different axes onto one X', () => {
    const [x, l, o] = buildData(live, off);
    expect(x).toEqual([1, 2, 3, 4]);
    expect(l.slice(0, 3)).toEqual([-10, -20, -30]);
    expect(l[3] ?? null).toBeNull();
    expect(o[0] ?? null).toBeNull();
    expect(o.slice(1)).toEqual([-1, -2, -3]);
  });
});
