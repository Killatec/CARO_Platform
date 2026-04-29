import { describe, it, expect } from 'vitest';
import { defaultYScale } from '../../src/render/yScales.js';
import type { TagDef } from '@caro/hmi-context';

function makeTag(overrides: Partial<TagDef>): TagDef {
  return {
    tag_id: 1, tag_path: 'X.Y', data_type: 'float', is_setpoint: false,
    module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null,
    unit: null, meta: [],
    ...overrides,
  };
}

describe('defaultYScale', () => {
  it('returns [-0.5, 1.5] for boolean tags', () => {
    expect(defaultYScale(makeTag({ data_type: 'bool' }))).toEqual([-0.5, 1.5]);
  });

  it('returns [eng_min, eng_max] when both are set', () => {
    expect(defaultYScale(makeTag({ eng_min: 0, eng_max: 100 }))).toEqual([0, 100]);
  });

  it('returns null when only eng_min is set', () => {
    expect(defaultYScale(makeTag({ eng_min: 0, eng_max: null }))).toBeNull();
  });

  it('returns null when engineering range is absent', () => {
    expect(defaultYScale(makeTag({ eng_min: null, eng_max: null }))).toBeNull();
  });

  it('handles negative engineering range', () => {
    expect(defaultYScale(makeTag({ eng_min: -50, eng_max: 50 }))).toEqual([-50, 50]);
  });
});
