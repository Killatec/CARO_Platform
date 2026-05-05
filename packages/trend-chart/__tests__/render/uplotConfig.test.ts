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
      tag_path: `CARO.Tag_${d.tag_id}`, data_type: 'float', is_setpoint: false,
      module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: null, meta: [],
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

  it('raw mode (default): series[0] as x-axis placeholder, then one value series per tagId', () => {
    const config = buildUplotConfig(baseOpts);
    // 1 (x placeholder) + 3 value series
    expect(config.series).toHaveLength(1 + 3);
  });

  it('raw mode: no bands config', () => {
    const config = buildUplotConfig(baseOpts);
    expect(config.bands).toBeUndefined();
  });

  it('raw mode: selected series has higher width/alpha than others', () => {
    const config = buildUplotConfig(baseOpts);
    const selected = config.series![1]!; // tag_id=1 is selectedTagId
    const other = config.series![2]!;
    expect(selected.width).toBeGreaterThan(other.width as number);
    expect(selected.alpha).toBeGreaterThan(other.alpha as number);
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

  // ── Aggregate (isAggregate: true) ──────────────────────────────────────────

  it('aggregate mode: series count is 1 + 2 per tag (min + max band series)', () => {
    const config = buildUplotConfig({ ...baseOpts, isAggregate: true });
    // 1 (x placeholder) + 3 tags × 2 (min + max) = 7
    expect(config.series).toHaveLength(1 + 3 * 2);
  });

  it('aggregate mode: bands array has one entry per tag', () => {
    const config = buildUplotConfig({ ...baseOpts, isAggregate: true });
    expect(config.bands).toBeDefined();
    expect(config.bands).toHaveLength(3);
  });

  it('aggregate mode: each band series entry references correct min/max indices', () => {
    const config = buildUplotConfig({ ...baseOpts, isAggregate: true });
    // Tag 0 (tagIds[0]=1): minIdx=1, maxIdx=2
    // Tag 1 (tagIds[1]=2): minIdx=3, maxIdx=4
    // Tag 2 (tagIds[2]=3): minIdx=5, maxIdx=6
    expect(config.bands![0]!.series).toEqual([1, 2]);
    expect(config.bands![1]!.series).toEqual([3, 4]);
    expect(config.bands![2]!.series).toEqual([5, 6]);
  });

  it('aggregate mode: selected band fill string contains higher alpha than non-selected', () => {
    const config = buildUplotConfig({ ...baseOpts, selectedTagId: 1, isAggregate: true });
    // Tag 1 is selected (band index 0), tag 2 is not (band index 1).
    const selectedFill = config.bands![0]!.fill as string;
    const otherFill    = config.bands![1]!.fill as string;
    // Selected: alpha 0.5; non-selected: alpha 0.15 — both encoded in rgba string.
    expect(selectedFill).toContain('0.5');
    expect(otherFill).toContain('0.15');
  });

  it('aggregate mode: min series has no visible stroke; max series has a stroke', () => {
    const config = buildUplotConfig({ ...baseOpts, isAggregate: true });
    // series[1] = min for tag 1, series[2] = max for tag 1
    const minSeries = config.series![1]!;
    const maxSeries = config.series![2]!;
    expect(minSeries.stroke).toBe('transparent');
    expect(maxSeries.stroke).not.toBe('transparent');
    expect(typeof maxSeries.stroke).toBe('string');
  });

  it('aggregate mode: y-scale names are still present', () => {
    const config = buildUplotConfig({ ...baseOpts, isAggregate: true });
    expect(config.scales).toHaveProperty('y_1');
    expect(config.scales).toHaveProperty('y_2');
    expect(config.scales).toHaveProperty('y_3');
  });
});
