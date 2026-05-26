import { describe, it, expect } from 'vitest';
import { loadTagMap } from '../tag-map.js';
import type { ActiveTag } from '@caro/db';

function makeRow(overrides: Partial<ActiveTag> & { tag_id: number; tag_path: string }): ActiveTag {
  return {
    registry_rev: 1,
    module: 'MOD',
    module_type: 'MQTT',
    data_type: 'f32',
    is_setpoint: false,
    trends: false,
    unit: null,
    format: null,
    eng_min: null,
    eng_max: null,
    tag_name: null,
    retired: false,
    meta: [
      { type: 'system', name: 'SYS', fields: {} },
      { type: 'module', name: 'MOD', fields: {} },
    ],
    ...overrides,
  } as ActiveTag;
}

describe('loadTagMap', () => {
  it('maps basic row fields onto TagDef', async () => {
    const row = makeRow({ tag_id: 1, tag_path: 'SYS.MOD.Temp', unit: '°C', eng_min: 0, eng_max: 100 });
    const { tagMap } = await loadTagMap([row]);
    const def = tagMap.get(1)!;
    expect(def.tag_id).toBe(1);
    expect(def.tag_path).toBe('SYS.MOD.Temp');
    expect(def.unit).toBe('°C');
    expect(def.eng_min).toBe(0);
    expect(def.eng_max).toBe(100);
  });

  it('derives module_id from the meta module level', async () => {
    const row = makeRow({
      tag_id: 2, tag_path: 'SYS.RF1.Power',
      meta: [
        { type: 'system', name: 'SYS', fields: {} },
        { type: 'module', name: 'RF1', fields: {} },
      ],
    });
    const { tagMap } = await loadTagMap([row]);
    expect(tagMap.get(2)!.module_id).toBe('RF1');
  });

  it('populates moduleTagIds and trendableTagIds', async () => {
    const rows = [
      makeRow({ tag_id: 10, tag_path: 'S.M.A', trends: true }),
      makeRow({ tag_id: 11, tag_path: 'S.M.B', trends: false }),
    ];
    const { moduleTagIds, trendableTagIds } = await loadTagMap(rows);
    expect(moduleTagIds.get('MOD')).toEqual(expect.arrayContaining([10, 11]));
    expect(trendableTagIds.has(10)).toBe(true);
    expect(trendableTagIds.has(11)).toBe(false);
  });

  // ── Regression: row columns win over meta inheritance ────────────────────────
  //
  // resolveRegistry suppresses unit/eng_min/eng_max for tags that should not
  // carry them (e.g. Booleans). Those resolved values are in row.unit /
  // row.eng_min / row.eng_max. Meta levels may still carry parent-template
  // values — loadTagMap must NOT walk meta for these fields.

  it('regression: boolean tag with row.unit=null yields TagDef.unit=null even when parent meta carries a unit', async () => {
    const row = makeRow({
      tag_id: 20,
      tag_path: 'SYS.MOD.Pulse_Rate.Intk',
      data_type: 'bool',
      unit: null,      // registry resolved: no unit for this boolean
      eng_min: null,
      eng_max: null,
      meta: [
        { type: 'system', name: 'SYS', fields: { unit: 'Hz', eng_min: 0, eng_max: 1000 } },
        { type: 'module', name: 'MOD', fields: {} },
        { type: 'parameter', name: 'Pulse_Rate', fields: { unit: 'Hz', eng_min: 0, eng_max: 1000 } },
        { type: 'tag', name: 'Intk', fields: {} },
      ],
    });
    const { tagMap } = await loadTagMap([row]);
    const def = tagMap.get(20)!;
    expect(def.unit).toBeNull();
    expect(def.eng_min).toBeNull();
    expect(def.eng_max).toBeNull();
  });

  it('regression: row.eng_min/eng_max=null yields null even when meta carries engineering range', async () => {
    const row = makeRow({
      tag_id: 21,
      tag_path: 'SYS.MOD.Status',
      unit: null,
      eng_min: null,
      eng_max: null,
      meta: [
        { type: 'system', name: 'SYS', fields: { eng_min: -100, eng_max: 100 } },
        { type: 'module', name: 'MOD', fields: {} },
      ],
    });
    const { tagMap } = await loadTagMap([row]);
    const def = tagMap.get(21)!;
    expect(def.eng_min).toBeNull();
    expect(def.eng_max).toBeNull();
  });

  it('non-boolean tag with registry unit and range reads them from row columns', async () => {
    const row = makeRow({
      tag_id: 30,
      tag_path: 'SYS.MOD.Flow',
      unit: 'L/min',
      eng_min: 0,
      eng_max: 500,
      meta: [
        { type: 'system', name: 'SYS', fields: { unit: 'mL/s' } }, // meta carries a different unit
        { type: 'module', name: 'MOD', fields: {} },
      ],
    });
    const { tagMap } = await loadTagMap([row]);
    const def = tagMap.get(30)!;
    expect(def.unit).toBe('L/min');   // row wins, not meta
    expect(def.eng_min).toBe(0);
    expect(def.eng_max).toBe(500);
  });
});
