import { describe, it, expect } from 'vitest';
import { buildTagList } from '../tag-list.js';
import type { TagDef, MetaLevel } from '@caro/hmi-context';

const lvl = (type: string, name: string, inTagName: boolean): MetaLevel => ({
  type,
  name,
  fields: { In_Tag_Name: inTagName },
});

function makeTagDef(tag_id: number, module_id: string, meta: MetaLevel[], is_setpoint = false): TagDef {
  return {
    tag_id,
    tag_path:    meta.map(l => l.name).join('.'),
    tag_name:    null,
    data_type:   'f32',
    is_setpoint,
    trendable:   false,
    module_id,
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta,
  };
}

const SYS = lvl('system', 'Narya1', false);
const RF1 = lvl('module', 'RF1', true);

describe('buildTagList', () => {
  it('builds module-relative names and is_setpoint for the module, ordered by tag_id', () => {
    const tagMap = new Map<number, TagDef>([
      [1024, makeTagDef(1024, 'RF1', [SYS, RF1, lvl('Freq', 'Freq', true), lvl('tag', 'Mon', true)])],
      [1023, makeTagDef(1023, 'RF1', [SYS, RF1, lvl('Freq', 'Freq', true), lvl('tag', 'Set', true)], true)],
      [1017, makeTagDef(1017, 'RF1', [SYS, RF1, lvl('Info', 'Module_Info', false), lvl('tag', 'Firmware', true)])],
    ]);

    expect(buildTagList(tagMap, 'RF1')).toEqual({
      tags: [
        { tag_id: 1017, tag_name: 'Firmware', is_setpoint: false },
        { tag_id: 1023, tag_name: 'Freq.Set', is_setpoint: true },
        { tag_id: 1024, tag_name: 'Freq.Mon', is_setpoint: false },
      ],
      skipped: [],
    });
  });

  it('leaves out tags of other modules', () => {
    const tagMap = new Map<number, TagDef>([
      [1, makeTagDef(1, 'RF1',  [SYS, RF1, lvl('tag', 'A', true)])],
      [2, makeTagDef(2, 'Pole', [SYS, lvl('module', 'Pole', true), lvl('tag', 'B', true)])],
    ]);

    expect(buildTagList(tagMap, 'RF1').tags.map(t => t.tag_id)).toEqual([1]);
  });

  it('reports tags with an empty module-relative name as skipped', () => {
    const tagMap = new Map<number, TagDef>([
      [1, makeTagDef(1, 'RF1', [SYS, RF1, lvl('tag', 'A', true)])],
      [2, makeTagDef(2, 'RF1', [SYS, RF1, lvl('tag', 'B', false)])],
    ]);

    expect(buildTagList(tagMap, 'RF1')).toEqual({
      tags:    [{ tag_id: 1, tag_name: 'A', is_setpoint: false }],
      skipped: [2],
    });
  });

  it('returns empty lists for a module with no tags', () => {
    expect(buildTagList(new Map(), 'RF1')).toEqual({ tags: [], skipped: [] });
  });
});
