import { describe, it, expect } from 'vitest';
import { buildTagPathIndex } from '../tagPathIndex.js';
import type { TagDef } from '../types.js';

function makeTag(id: number, path: string): TagDef {
  return {
    tag_id: id,
    tag_path: path,
    data_type: 'f32',
    is_setpoint: false,
    module_id: 'M',
    module_type: 'MQTT',
    eng_min: null,
    eng_max: null,
    unit: null,
    meta: [],
  };
}

const tagA = makeTag(1, 'Power.PS1.Main_TX.DC_Main');
const tagB = makeTag(2, 'Cooling.PS1.Main_TX.DC_Main');
const tagC = makeTag(3, 'Power.PS2.Aux_TX.DC_Aux');

describe('buildTagPathIndex', () => {
  it('exact full-path match', () => {
    const idx = buildTagPathIndex([tagA]);
    expect(idx.resolve('Power.PS1.Main_TX.DC_Main')).toEqual([tagA]);
  });

  it('leaf-only match (DC_Main)', () => {
    const idx = buildTagPathIndex([tagA]);
    expect(idx.resolve('DC_Main')).toEqual([tagA]);
  });

  it('mid-path contiguous match (Main_TX.DC_Main)', () => {
    const idx = buildTagPathIndex([tagA]);
    expect(idx.resolve('Main_TX.DC_Main')).toEqual([tagA]);
  });

  it('no match returns empty array', () => {
    const idx = buildTagPathIndex([tagA]);
    expect(idx.resolve('NoSuchSegment')).toEqual([]);
  });

  it('multiple matches when same contiguous suffix appears under multiple parents', () => {
    const idx = buildTagPathIndex([tagA, tagB]);
    const results = idx.resolve('Main_TX.DC_Main');
    expect(results).toHaveLength(2);
    const ids = results.map(t => t.tag_id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
  });

  it('non-contiguous segments do NOT match (Power.DC_Main where no tag has those adjacent)', () => {
    // tagA = Power.PS1.Main_TX.DC_Main — Power and DC_Main are not adjacent
    const idx = buildTagPathIndex([tagA]);
    expect(idx.resolve('Power.DC_Main')).toEqual([]);
  });

  it('root-only match returns all tags under that root', () => {
    const idx = buildTagPathIndex([tagA, tagC]);
    const results = idx.resolve('Power');
    expect(results).toHaveLength(2);
    const ids = results.map(t => t.tag_id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 3]);
  });

  it('empty iterable produces an index that always returns []', () => {
    const idx = buildTagPathIndex([]);
    expect(idx.resolve('anything')).toEqual([]);
  });
});
