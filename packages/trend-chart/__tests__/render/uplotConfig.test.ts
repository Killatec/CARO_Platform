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

  it('produces series[0] as x-axis placeholder, then one per tagId', () => {
    const config = buildUplotConfig(baseOpts);
    // series[0] is the X axis placeholder
    expect(config.series).toHaveLength(1 + 3);
  });

  it('selected series has higher width/alpha than others', () => {
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
    // Tag 1 has eng_min=0, eng_max=100 — defaultYScale would produce [0, 100].
    // Passing an override for tag 1 should use [25, 75] instead.
    const overrides = new Map([[1, { min: 25, max: 75 }]]);
    const config = buildUplotConfig({ ...baseOpts, yScaleOverrides: overrides });
    expect(config.scales!['y_1']).toEqual({ auto: false, range: [25, 75] });
  });

  it('yScaleOverrides: tags without an override fall back to defaultYScale', () => {
    // Only tag 1 overridden; tag 2 (bool) and tag 3 (autoscale) use defaults.
    const overrides = new Map([[1, { min: 25, max: 75 }]]);
    const config = buildUplotConfig({ ...baseOpts, yScaleOverrides: overrides });
    // Tag 2 is bool → defaultYScale returns [-0.5, 1.5].
    expect(config.scales!['y_2']).toEqual({ auto: false, range: [-0.5, 1.5] });
    // Tag 3 has no eng range → autoscale.
    expect(config.scales!['y_3']).toEqual({ auto: true });
  });
});
