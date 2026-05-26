import { describe, it, expect } from 'vitest';
import type { TagDef } from '@caro/hmi-context';
import { buildTagForest } from '../src/buildTagForest.js';

function makeTag(id: number, path: string, trendable = true): TagDef {
  return {
    tag_id:      id,
    tag_path:    path,
    tag_name:    null,
    data_type:   'f32',
    is_setpoint: false,
    trendable,
    module_id:   path.split('.')[1] ?? 'M',
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta:        [],
  };
}

describe('buildTagForest', () => {
  it('empty map returns []', () => {
    expect(buildTagForest(new Map())).toEqual([]);
  });

  it('single tag produces one root with one leaf', () => {
    const tag = makeTag(1, 'Plant.Mod.Temp');
    const forest = buildTagForest(new Map([[1, tag]]));
    expect(forest).toHaveLength(1);
    const root = forest[0]!;
    expect(root.name).toBe('Plant');
    expect(root.tag).toBeNull();
    expect(root.children).toHaveLength(1);
    const modNode = root.children[0]!;
    expect(modNode.name).toBe('Mod');
    expect(modNode.children).toHaveLength(1);
    const leaf = modNode.children[0]!;
    expect(leaf.name).toBe('Temp');
    expect(leaf.tag).toBe(tag);
    expect(leaf.children).toHaveLength(0);
  });

  it('multi-module multi-tag tree shape is correct', () => {
    const t1 = makeTag(1, 'Sys.Mod1.A');
    const t2 = makeTag(2, 'Sys.Mod1.B');
    const t3 = makeTag(3, 'Sys.Mod2.C');
    const map = new Map([[1, t1], [2, t2], [3, t3]]);
    const forest = buildTagForest(map);
    expect(forest).toHaveLength(1);
    const sys = forest[0]!;
    expect(sys.name).toBe('Sys');
    expect(sys.children).toHaveLength(2);
    const [mod1, mod2] = sys.children;
    expect(mod1!.name).toBe('Mod1');
    expect(mod2!.name).toBe('Mod2');
    expect(mod1!.children.map(c => c.name)).toEqual(['A', 'B']);
    expect(mod2!.children.map(c => c.name)).toEqual(['C']);
  });

  it('hasTrendableDescendant is true when any leaf is trendable', () => {
    const t1 = makeTag(1, 'R.M.T1', true);
    const t2 = makeTag(2, 'R.M.T2', false);
    const forest = buildTagForest(new Map([[1, t1], [2, t2]]));
    expect(forest[0]!.hasTrendableDescendant).toBe(true);
    expect(forest[0]!.children[0]!.hasTrendableDescendant).toBe(true);
  });

  it('hasTrendableDescendant is false when all leaves are non-trendable', () => {
    const t1 = makeTag(1, 'R.M.T1', false);
    const t2 = makeTag(2, 'R.M.T2', false);
    const forest = buildTagForest(new Map([[1, t1], [2, t2]]));
    expect(forest[0]!.hasTrendableDescendant).toBe(false);
    expect(forest[0]!.children[0]!.hasTrendableDescendant).toBe(false);
  });

  it('hasTrendableDescendant is true on mixed branch', () => {
    const trendable = makeTag(1, 'R.M.Yes', true);
    const nonTrendable = makeTag(2, 'R.M.No', false);
    const forest = buildTagForest(new Map([[1, trendable], [2, nonTrendable]]));
    const modNode = forest[0]!.children[0]!;
    expect(modNode.hasTrendableDescendant).toBe(true);
    const yesLeaf = modNode.children.find(c => c.name === 'Yes')!;
    const noLeaf  = modNode.children.find(c => c.name === 'No')!;
    expect(yesLeaf.hasTrendableDescendant).toBe(true);
    expect(noLeaf.hasTrendableDescendant).toBe(false);
  });

  it('children are sorted alphabetically at every level', () => {
    const tags = [
      makeTag(1, 'Root.Zeta.Tag'),
      makeTag(2, 'Root.Alpha.Tag'),
      makeTag(3, 'Root.Mu.Tag'),
    ];
    const map = new Map(tags.map(t => [t.tag_id, t]));
    const forest = buildTagForest(map);
    const names = forest[0]!.children.map(c => c.name);
    expect(names).toEqual(['Alpha', 'Mu', 'Zeta']);
  });

  it('pathKey encodes the dot-path from the root', () => {
    const tag = makeTag(1, 'A.B.C');
    const forest = buildTagForest(new Map([[1, tag]]));
    expect(forest[0]!.pathKey).toBe('A');
    expect(forest[0]!.children[0]!.pathKey).toBe('A.B');
    expect(forest[0]!.children[0]!.children[0]!.pathKey).toBe('A.B.C');
  });
});
