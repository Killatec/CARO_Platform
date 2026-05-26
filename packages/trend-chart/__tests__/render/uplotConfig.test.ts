import { describe, it, expect, vi } from 'vitest';
import { buildUplotConfig } from '../../src/render/uplotConfig.js';
import type { TagDef } from '@caro/hmi-context';

// uPlot uses canvas — mock the constructor so tests don't need a real canvas env.
vi.mock('uplot', () => {
  const UPlot = vi.fn().mockImplementation(() => ({ destroy: vi.fn(), setData: vi.fn() }));
  (UPlot as unknown as Record<string, unknown>).paths = {
    stepped: vi.fn(() => vi.fn()),
  };
  return { default: UPlot };
});

function makeTagMap(defs: Array<Partial<TagDef> & { tag_id: number }>): Map<number, TagDef> {
  return new Map(defs.map(d => [
    d.tag_id,
    {
      tag_path: `CARO.Tag_${d.tag_id}`, tag_name: null, data_type: 'float', is_setpoint: false, trendable: true,
      module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: null, format: null, meta: [],
      ...d,
    } satisfies TagDef,
  ]));
}

describe('buildUplotConfig', () => {
  const tagMap = makeTagMap([
    { tag_id: 1, eng_min: 0, eng_max: 100, unit: '°C' },
    { tag_id: 2, data_type: 'bool' },
    { tag_id: 3, eng_min: null, eng_max: null, unit: 'kW' },
  ]);

  const baseOpts = {
    tagIds: [1, 2, 3],
    selectedTagId: 1,
    tagMap,
    width: 800,
    height: 400,
  };

  it('returns an object with width and height', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.width).toBe(800);
    expect(config.height).toBe(400);
  });

  it('includes one x-axis scale and one named y-scale per tag', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.scales).toHaveProperty('x');
    expect(config.scales).toHaveProperty('y_1');
    expect(config.scales).toHaveProperty('y_2');
    expect(config.scales).toHaveProperty('y_3');
  });

  it('x scale has time: true', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.scales!['x']!.time).toBe(true);
  });

  // ── Always-band shape (2 series per tag regardless of raw/aggregate data) ───

  it('series[0] is x-axis placeholder, then 2 series per tag (min + max)', () => {
    const config = buildUplotConfig(baseOpts);
    // 1 (x placeholder) + 3 tags × 2 = 7
    expect(config.series).toHaveLength(1 + 3 * 2);
  });

  it('bands array is always present — one entry per tag', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.bands).toBeDefined();
    expect(config.bands).toHaveLength(3);
  });

  it('each band references correct min/max series indices', () => {
    const config = buildUplotConfig(baseOpts);
    // Per-tag layout: minSeriesIdx = 1+i*2, maxSeriesIdx = 1+i*2+1
    // uPlot convention: series[0] = upper/from edge (max), series[1] = lower/to edge (min)
    // Tag 0 (tagIds[0]=1): maxIdx=2, minIdx=1
    // Tag 1 (tagIds[1]=2): maxIdx=4, minIdx=3
    // Tag 2 (tagIds[2]=3): maxIdx=6, minIdx=5
    expect(config.bands![0]!.series).toEqual([2, 1]);
    expect(config.bands![1]!.series).toEqual([4, 3]);
    expect(config.bands![2]!.series).toEqual([6, 5]);
  });

  it('band series[0] > series[1] — max (upper) index is always first per uPlot convention', () => {
    const config = buildUplotConfig(baseOpts);
    for (const band of config.bands!) {
      expect(band.series[0]).toBeGreaterThan(band.series[1]);
    }
  });

  it('both min and max series have the same stroke color and width — both band edges are visible', () => {
    const config = buildUplotConfig(baseOpts);
    const minSeries = config.series![1]!; // min for tag 1
    const maxSeries = config.series![2]!; // max for tag 1
    expect(minSeries.stroke).toBe(maxSeries.stroke);
    expect(minSeries.width).toBe(maxSeries.width);
    expect(typeof minSeries.stroke).toBe('string');
    expect((minSeries.stroke as string)).not.toBe('transparent');
  });

  it('selected band fill has higher alpha than non-selected', () => {
    const config = buildUplotConfig({ ...baseOpts, selectedTagId: 1 });
    // tag 1 = selected (band[0]); tag 2 = non-selected (band[1])
    const selectedFill = config.bands![0]!.fill as string;
    const otherFill    = config.bands![1]!.fill as string;
    expect(selectedFill).toContain('0.6');
    expect(otherFill).toContain('0.25');
  });

  it('selected max-series stroke has higher alpha than non-selected max-series stroke', () => {
    const config = buildUplotConfig({ ...baseOpts, selectedTagId: 1 });
    // series[2] = max for tag 1 (selected); series[4] = max for tag 2 (non-selected)
    const selectedStroke = config.series![2]!.stroke as string;
    const otherStroke    = config.series![4]!.stroke as string;
    expect(selectedStroke).toContain('0.8');
    expect(otherStroke).toContain('0.4');
  });

  it('calls onCursorChange when hook fires', () => {
    const onCursorChange = vi.fn();
    const config = buildUplotConfig({ ...baseOpts, onCursorChange });
    expect(config.hooks).toBeDefined();
    expect(config.hooks!.setCursor).toHaveLength(1);
  });

  it('produces empty hooks when onCursorChange is absent', () => {
    const config = buildUplotConfig(baseOpts);
    const hooks = config.hooks ?? {};
    expect((hooks as Record<string, unknown>).setCursor ?? []).toHaveLength(0);
  });

  it('yScaleOverrides: uses override range instead of defaultYScale when present', () => {
    const overrides = new Map([[1, { min: 25, max: 75 }]]);
    const config = buildUplotConfig({ ...baseOpts, yScaleOverrides: overrides });
    expect(config.scales!['y_1']).toEqual({ auto: false, range: [25, 75] });
  });

  it('yScaleOverrides: tags without an override fall back to defaultYScale', () => {
    const overrides = new Map([[1, { min: 25, max: 75 }]]);
    const config = buildUplotConfig({ ...baseOpts, yScaleOverrides: overrides });
    expect(config.scales!['y_2']).toEqual({ auto: false, range: [-0.5, 1.5] });
    expect(config.scales!['y_3']).toEqual({ auto: true });
  });

  it('y-scale names are present for all tags', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.scales).toHaveProperty('y_1');
    expect(config.scales).toHaveProperty('y_2');
    expect(config.scales).toHaveProperty('y_3');
  });

  // ── Band render-correctness guards ───────────────────────────────────────────
  // These catch regressions where band fill silently becomes transparent or series
  // paths are omitted, both of which produce no visible fill in uPlot.

  it('band fill is a non-transparent rgba string (not transparent/null/undefined)', () => {
    const config = buildUplotConfig(baseOpts);
    for (const band of config.bands!) {
      const fill = band.fill;
      expect(fill).toBeTruthy();
      expect(fill).not.toBe('transparent');
      // Must be an rgba() string so uPlot renders a visible fill.
      expect(typeof fill === 'string' && fill.startsWith('rgba(')).toBe(true);
    }
  });

  it('both series referenced by each band have paths functions (not undefined)', () => {
    const config = buildUplotConfig(baseOpts);
    for (const band of config.bands!) {
      const upper = config.series![band.series[0]]!;
      const lower = config.series![band.series[1]]!;
      // uPlot uses _paths.band from the lower series to clip the fill from the upper.
      // If either paths function is missing, uPlot falls back to linearPath which may
      // not generate the expected clip geometry.
      expect(upper.paths).toBeDefined();
      expect(lower.paths).toBeDefined();
    }
  });

  it('both series in each band share the same y-scale key', () => {
    const config = buildUplotConfig(baseOpts);
    for (const band of config.bands!) {
      const upper = config.series![band.series[0]]!;
      const lower = config.series![band.series[1]]!;
      expect(upper.scale).toBe(lower.scale);
    }
  });

  it('lower series (series[1] of band) has a visible stroke matching the upper series', () => {
    const config = buildUplotConfig(baseOpts);
    for (const band of config.bands!) {
      const upper = config.series![band.series[0]]!;
      const lower = config.series![band.series[1]]!;
      expect(lower.stroke).toBe(upper.stroke);
      expect(lower.stroke).not.toBe('transparent');
    }
  });

  it('Y-axis has fixed size to prevent plot-left-edge jitter', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.axes![1]!.size).toBe(60);
  });

  it('Y-axis reserves label space for unitless traces (label=" ", labelSize=16)', () => {
    // tag 2 has no unit — label must be a single space, not undefined, so uPlot
    // always reserves the label area and the plot left edge stays fixed.
    const config = buildUplotConfig({ ...baseOpts, selectedTagId: 2 });
    expect(config.axes![1]!.label).toBe(' ');
    expect(config.axes![1]!.labelSize).toBe(16);
  });

  it('Y-axis renders unit label when present (label="°C", labelSize=16)', () => {
    // tag 1 has unit: '°C' — label should be the unit string, labelSize still fixed.
    const config = buildUplotConfig({ ...baseOpts, selectedTagId: 1 });
    expect(config.axes![1]!.label).toBe('°C');
    expect(config.axes![1]!.labelSize).toBe(16);
  });

  it('lower (min) series does NOT have width: 0 — uPlot skips _paths for zero-width series, breaking band fill', () => {
    // Regression guard: setting width: 0 on the min series causes uPlot to skip
    // _paths computation entirely, so _paths.band is never built and the band fill
    // polygon is never rendered. The stroke stays invisible via stroke: 'transparent';
    // width must stay at the default (1) so uPlot computes the path.
    const config = buildUplotConfig(baseOpts);
    for (const band of config.bands!) {
      const lower = config.series![band.series[1]]!;
      expect(lower.width).not.toBe(0);
    }
  });
});
