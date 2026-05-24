import { describe, it, expect } from 'vitest';
import { resolveRegistry } from '../resolveRegistry.ts';
import { MAX_TAG_PATH_LENGTH } from '../constants.ts';

function makeTag(name, dataType = 'f32', isSetpoint = false, fields = {}) {
  return {
    template_type: 'tag',
    template_name: name,
    fields: {
      data_type: { field_type: 'TagType', default: dataType },
      is_setpoint: { field_type: 'Boolean', default: isSetpoint },
      ...fields,
    },
    children: [],
  };
}

function makeStruct(name, type, children = [], fields = {}) {
  return { template_type: type, template_name: name, fields, children };
}

function wrap(template) {
  return { template, hash: 'aabbcc' };
}

// ── Null / empty ─────────────────────────────────────────────────────────────

describe('null / empty', () => {
  it('null map → []', () => {
    expect(resolveRegistry(null, 'root')).toEqual([]);
  });

  it('empty map → []', () => {
    expect(resolveRegistry({}, 'root')).toEqual([]);
  });

  it('module with no tags → []', () => {
    const map = { M: wrap(makeStruct('M', 'module', [])) };
    expect(resolveRegistry(map, 'M')).toEqual([]);
  });
});

// ── Single tag path ───────────────────────────────────────────────────────────

describe('single tag path', () => {
  it('module → tag as "myTag" → tag_path "M.myTag"', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'myTag', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].tag_path).toBe('M.myTag');
  });

  it('data_type propagated from tag template', () => {
    const tag = makeTag('T', 'i32');
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].data_type).toBe('i32');
  });

  it('is_setpoint propagated from tag template', () => {
    const tag = makeTag('T', 'f32', true);
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].is_setpoint).toBe(true);
  });
});

// ── Root prefix ───────────────────────────────────────────────────────────────

describe('root prefix', () => {
  it('all returned tag_paths begin with the root template name', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    result.forEach(entry => expect(entry.tag_path.startsWith('M.')).toBe(true));
  });
});

// ── Nested path ───────────────────────────────────────────────────────────────

describe('nested path', () => {
  it('M → P (as "chan") → T (as "setpoint") → "M.chan.setpoint"', () => {
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter', [{ template_name: 'T', asset_name: 'setpoint', fields: {} }]);
    const mod = makeStruct('M', 'module', [{ template_name: 'P', asset_name: 'chan', fields: {} }]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].tag_path).toBe('M.chan.setpoint');
  });
});

// ── Multiple tags ─────────────────────────────────────────────────────────────

describe('multiple tags', () => {
  it('module with two tag children returns 2 entries', () => {
    const tag1 = makeTag('T1');
    const tag2 = makeTag('T2');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T1', asset_name: 'tagA', fields: {} },
      { template_name: 'T2', asset_name: 'tagB', fields: {} },
    ]);
    const map = { M: wrap(mod), T1: wrap(tag1), T2: wrap(tag2) };

    expect(resolveRegistry(map, 'M')).toHaveLength(2);
  });
});

// ── Meta structure ────────────────────────────────────────────────────────────

describe('meta structure', () => {
  it('meta is root-to-tag: meta[0].name is the root, last is the tag asset_name', () => {
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter', [{ template_name: 'T', asset_name: 'setpoint', fields: {} }]);
    const mod = makeStruct('M', 'module', [{ template_name: 'P', asset_name: 'chan', fields: {} }]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    const { meta } = result[0];
    expect(meta[0].name).toBe('M');
    expect(meta[1].name).toBe('chan');
    expect(meta[2].name).toBe('setpoint');
  });
});

// ── Meta field resolution ─────────────────────────────────────────────────────

describe('meta field resolution', () => {
  it('instance override wins over template default; value is scalar, not {field_type,default}', () => {
    const tag = makeTag('T', 2, false, { eng_min: { field_type: 'Numeric', default: 0 } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { eng_min: 5 } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    const { meta } = result[0];
    // meta[last] is the tag level (root-to-tag order)
    expect(meta[meta.length - 1].fields.eng_min).toBe(5);
    // Must be a scalar, not a {field_type, default} object
    expect(typeof meta[meta.length - 1].fields.eng_min).toBe('number');
  });

  it('template default used when no instance override', () => {
    const tag = makeTag('T', 2, false, { eng_min: { field_type: 'Numeric', default: 42 } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    // meta[last] is the tag level (root-to-tag order)
    const meta = result[0].meta;
    expect(meta[meta.length - 1].fields.eng_min).toBe(42);
  });
});

// ── module / module_type extraction ──────────────────────────────────────────

describe('module / module_type extraction', () => {
  it('module name propagated to resolved tag', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'HMI' } });
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result[0].module).toBe('M');
  });

  it('module_type extracted from Module_Type field default', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'MQTT' } });
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result[0].module_type).toBe('MQTT');
  });

  it('module_type from instance override wins over template default', () => {
    const tag = makeTag('T');
    // Template default is HMI, but the system-level child entry overrides to MQTT
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'HMI' } });
    const sys = makeStruct('S', 'system', [
      { template_name: 'M', asset_name: 'M', fields: { Module_Type: 'MQTT' } },
    ]);
    const map = { S: wrap(sys), M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'S');
    expect(result[0].module_type).toBe('MQTT');
  });

  it('module is null when hierarchy has no module level', () => {
    // A tag directly under a system (no module in between)
    const tag = makeTag('T');
    const sys = makeStruct('S', 'system', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ]);
    const map = { S: wrap(sys), T: wrap(tag) };

    const result = resolveRegistry(map, 'S');
    expect(result[0].module).toBeNull();
  });

  it('module_type is null when module has no Module_Type field', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result[0].module_type).toBeNull();
  });

  it('module_type is null when Module_Type default is non-string', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 42 } });
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result[0].module_type).toBeNull();
  });

  it('nested hierarchy: module → parameter → tag — all tags get same module and module_type', () => {
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter', [
      { template_name: 'T', asset_name: 'setpoint', fields: {} },
      { template_name: 'T', asset_name: 'monitor', fields: {} },
    ]);
    const mod = makeStruct('M', 'module', [
      { template_name: 'P', asset_name: 'chan', fields: {} },
    ], { Module_Type: { field_type: 'ModuleType', default: 'MQTT' } });
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(2);
    result.forEach(r => {
      expect(r.module).toBe('M');
      expect(r.module_type).toBe('MQTT');
    });
  });
});

// ── trends ────────────────────────────────────────────────────────────────────

describe('trends', () => {
  it('defaults to false when no level has a trends field', () => {
    const tag = makeTag('T', 2, false, {});
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });

  it('true when tag template has a trends field set to true', () => {
    const tag = makeTag('T', 2, false, { trends: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(true);
  });

  it('true when parent (non-tag) level has a trends field set to true', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ], { trends: { field_type: 'Boolean', default: true } });
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(true);
  });

  it('case-insensitive field key match ("Trends" and "TRENDS")', () => {
    const tag1 = makeTag('T1', 2, false, { Trends: { field_type: 'Boolean', default: true } });
    const tag2 = makeTag('T2', 2, false, { TRENDS: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T1', asset_name: 'a', fields: {} },
      { template_name: 'T2', asset_name: 'b', fields: {} },
    ]);
    const map = { M: wrap(mod), T1: wrap(tag1), T2: wrap(tag2) };

    const result = resolveRegistry(map, 'M');
    expect(result[0].trends).toBe(true);
    expect(result[1].trends).toBe(true);
  });

  it('instance override to true wins over template default of false', () => {
    const tag = makeTag('T', 2, false, { trends: { field_type: 'Boolean', default: false } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { trends: true } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(true);
  });

  it('instance override to false does not trigger trends when template default is true', () => {
    const tag = makeTag('T', 2, false, { trends: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { trends: false } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });
});

// ── trends — additional edge cases ───────────────────────────────────────────

describe('trends — additional edge cases', () => {
  it('true when two separate levels both have trends: true (no error, no double-count)', () => {
    // Both module and parameter levels carry trends: true
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter',
      [{ template_name: 'T', asset_name: 'setpoint', fields: {} }],
      { trends: { field_type: 'Boolean', default: true } }
    );
    const mod = makeStruct('M', 'module',
      [{ template_name: 'P', asset_name: 'chan', fields: {} }],
      { trends: { field_type: 'Boolean', default: true } }
    );
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(true);
  });

  it('false when a level has trends field explicitly set to false and no other level has true', () => {
    const tag = makeTag('T', 2, false, { trends: { field_type: 'Boolean', default: false } });
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });

  it('false when trends field value is string "true" (not boolean true)', () => {
    const tag = makeTag('T', 2, false, { trends: { field_type: 'Boolean', default: 'true' } });
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });

  it('false when trends field value is number 1 (not boolean true)', () => {
    const tag = makeTag('T', 2, false, { trends: { field_type: 'Boolean', default: 1 } });
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });

  it('false when all levels have empty fields', () => {
    // 3-level hierarchy: module → parameter → tag, all fields: {}
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter', [{ template_name: 'T', asset_name: 'setpoint', fields: {} }]);
    const mod = makeStruct('M', 'module', [{ template_name: 'P', asset_name: 'chan', fields: {} }]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });

  it('instance override to true at parameter level wins over parameter template default of false', () => {
    // Module child entry for P carries fields: { trends: true } — that becomes the
    // instance override merged into P's resolvedFields at walk time
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter',
      [{ template_name: 'T', asset_name: 'setpoint', fields: {} }],
      { trends: { field_type: 'Boolean', default: false } }
    );
    const mod = makeStruct('M', 'module', [
      { template_name: 'P', asset_name: 'chan', fields: { trends: true } },
    ]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(true);
  });

  it('instance override to false at parameter level suppresses parameter template default of true', () => {
    // Module child entry for P carries fields: { trends: false } — overrides the
    // parameter template's default of true
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter',
      [{ template_name: 'T', asset_name: 'setpoint', fields: {} }],
      { trends: { field_type: 'Boolean', default: true } }
    );
    const mod = makeStruct('M', 'module', [
      { template_name: 'P', asset_name: 'chan', fields: { trends: false } },
    ]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    expect(resolveRegistry(map, 'M')[0].trends).toBe(false);
  });
});

// ── dotted-field override propagation ────────────────────────────────────────

describe('dotted-field override propagation', () => {
  // Shared helpers: a parameter template with eng_max:100 containing one tag child
  function makeAnalogIn() {
    return makeStruct('Analog_In', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'val', fields: {} },
    ], { eng_max: { field_type: 'Numeric', default: 100 } });
  }
  function makeTagT() {
    return makeTag('Tag_T');
  }

  it('dotted field on parent: display column resolves to dotted value; child meta shows template default', () => {
    const parent = makeStruct('Parent', 'module', [
      { template_name: 'Analog_In', asset_name: 'I', fields: {} },
    ], { 'I.eng_max': { field_type: 'Numeric', default: 50 } });
    const map = { Parent: wrap(parent), Analog_In: wrap(makeAnalogIn()), Tag_T: wrap(makeTagT()) };

    const result = resolveRegistry(map, 'Parent');
    expect(result).toHaveLength(1);
    // Display column resolves the dotted field from the parent level
    expect(result[0].eng_max).toBe(50);
    // I's meta shows only the template default — dotted value does NOT propagate into meta
    const iMeta = result[0].meta.find(m => m.name === 'I');
    expect(iMeta.fields.eng_max).toBe(100);
  });

  it('dotted override wins over direct ChildRef.fields for display column (ancestor root priority)', () => {
    // ChildRef has eng_max: 10, parent dotted default is 50.
    // Display column: parent dotted wins (root priority). Meta at I: ChildRef value (10).
    const parent = makeStruct('Parent', 'module', [
      { template_name: 'Analog_In', asset_name: 'I', fields: { eng_max: 10 } },
    ], { 'I.eng_max': { field_type: 'Numeric', default: 50 } });
    const map = { Parent: wrap(parent), Analog_In: wrap(makeAnalogIn()), Tag_T: wrap(makeTagT()) };

    const result = resolveRegistry(map, 'Parent');
    // Display column: ancestor dotted field wins via root-first resolution
    expect(result[0].eng_max).toBe(50);
    // Meta at I shows the ChildRef override, not the dotted value
    const iMeta = result[0].meta.find(m => m.name === 'I');
    expect(iMeta.fields.eng_max).toBe(10);
  });

  it('grandparent instance override of dotted field: display column resolves correctly; I meta unchanged', () => {
    // GrandParent overrides Parent's I.eng_max to 200 (template default is 50).
    // Display column for the tag should be 200 (resolved from P's meta fields).
    // I's meta should show Analog_In template default (100) — no dotted propagation.
    const parent = makeStruct('Parent', 'module', [
      { template_name: 'Analog_In', asset_name: 'I', fields: {} },
    ], { 'I.eng_max': { field_type: 'Numeric', default: 50 } });
    const gp = makeStruct('GrandParent', 'system', [
      { template_name: 'Parent', asset_name: 'P', fields: { 'I.eng_max': 200 } },
    ]);
    const map = {
      GrandParent: wrap(gp),
      Parent: wrap(parent),
      Analog_In: wrap(makeAnalogIn()),
      Tag_T: wrap(makeTagT()),
    };

    const result = resolveRegistry(map, 'GrandParent');
    // Display column: resolved via P's meta fields (I.eng_max: 200)
    expect(result[0].eng_max).toBe(200);
    // I's meta shows template default — dotted value is NOT propagated into I's meta
    const iMeta = result[0].meta.find(m => m.name === 'I');
    expect(iMeta.fields.eng_max).toBe(100);
  });

  it('dotted field targeting non-existent child is inert — no error, appears only in parent meta', () => {
    // X.eng_max but no child with asset_name X — should resolve normally
    const parent = makeStruct('Parent', 'module', [
      { template_name: 'Analog_In', asset_name: 'I', fields: {} },
    ], { 'X.eng_max': { field_type: 'Numeric', default: 99 } });
    const map = { Parent: wrap(parent), Analog_In: wrap(makeAnalogIn()), Tag_T: wrap(makeTagT()) };

    expect(() => resolveRegistry(map, 'Parent')).not.toThrow();
    const result = resolveRegistry(map, 'Parent');
    expect(result).toHaveLength(1);
    // Field remains in the parent's meta but never propagates
    const parentMeta = result[0].meta.find(m => m.name === 'Parent');
    expect(parentMeta.fields['X.eng_max']).toBe(99);
    // I's meta has no X-prefixed field
    const iMeta = result[0].meta.find(m => m.name === 'I');
    expect(iMeta.fields['X.eng_max']).toBeUndefined();
  });

  it('multiple dotted prefixes — each child receives only its own overrides in display columns', () => {
    const vParam = makeStruct('V_Param', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'val', fields: {} },
    ], { eng_min: { field_type: 'Numeric', default: 0 } });
    const parent = makeStruct('Parent', 'module', [
      { template_name: 'Analog_In', asset_name: 'I', fields: {} },
      { template_name: 'V_Param', asset_name: 'V', fields: {} },
    ], {
      'I.eng_max': { field_type: 'Numeric', default: 50 },
      'I.unit': { field_type: 'String', default: 'A' },
      'V.eng_min': { field_type: 'Numeric', default: 5 },
    });
    const map = {
      Parent: wrap(parent),
      Analog_In: wrap(makeAnalogIn()),
      V_Param: wrap(vParam),
      Tag_T: wrap(makeTagT()),
    };

    const result = resolveRegistry(map, 'Parent');
    expect(result).toHaveLength(2);

    // I subtag: display columns from parent dotted fields; no V bleed-through
    const iResult = result.find(r => r.tag_path === 'Parent.I.val');
    expect(iResult.eng_max).toBe(50);
    expect(iResult.unit).toBe('A');

    // I's meta shows template defaults only (no dotted propagation)
    const iMeta = iResult.meta.find(m => m.name === 'I');
    expect(iMeta.fields.eng_max).toBe(100);    // Analog_In template default
    expect(iMeta.fields.unit).toBeUndefined();  // Analog_In has no unit field
    expect(iMeta.fields.eng_min).toBeUndefined(); // V's override must not bleed into I

    // V subtag: display column from parent V.eng_min dotted field; no I bleed-through
    const vResult = result.find(r => r.tag_path === 'Parent.V.val');
    expect(vResult.eng_min).toBe(5);

    // V's meta shows template default (no dotted propagation)
    const vMeta = vResult.meta.find(m => m.name === 'V');
    expect(vMeta.fields.eng_min).toBe(0);       // V_Param template default
    expect(vMeta.fields.eng_max).toBeUndefined(); // I's override must not bleed into V
  });

  it('regular (non-dotted) fields are unaffected by the new logic', () => {
    const tag = makeTag('T', 'f32', false, { eng_min: { field_type: 'Numeric', default: 0 } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { eng_min: 7 } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].meta[result[0].meta.length - 1].fields.eng_min).toBe(7);
  });
});

// ── numeric gate for display fields ──────────────────────────────────────────

describe('numeric gate for display fields', () => {
  it('boolean tag does not inherit ancestor eng_min/eng_max/unit/format', () => {
    // Parent has eng_min in its fields; child is a boolean tag
    const boolTag = makeTag('BoolTag', 'bool', false);
    const mod = makeStruct('M', 'module', [
      { template_name: 'BoolTag', asset_name: 'Enable', fields: {} },
    ], { eng_min: { field_type: 'Numeric', default: 0 }, eng_max: { field_type: 'Numeric', default: 100 }, unit: { field_type: 'String', default: 'mA' } });
    const map = { M: wrap(mod), BoolTag: wrap(boolTag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].data_type).toBe('bool');
    expect(result[0].eng_min).toBeNull();
    expect(result[0].eng_max).toBeNull();
    expect(result[0].unit).toBeNull();
    expect(result[0].format).toBeNull();
  });

  it('numeric sibling still inherits display fields when boolean sibling gets nulls', () => {
    // Same parent with eng_min/unit — one boolean child, one f32 child
    const boolTag = makeTag('BoolTag', 'bool', false);
    const numTag  = makeTag('NumTag',  'f32',  false, { eng_min: { field_type: 'Numeric', default: 0 } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'BoolTag', asset_name: 'Enable', fields: {} },
      { template_name: 'NumTag',  asset_name: 'Value',  fields: { eng_min: 5 } },
    ], { unit: { field_type: 'String', default: 'mA' } });
    const map = { M: wrap(mod), BoolTag: wrap(boolTag), NumTag: wrap(numTag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(2);

    const boolResult = result.find(r => r.tag_path === 'M.Enable');
    expect(boolResult.eng_min).toBeNull();
    expect(boolResult.eng_max).toBeNull();
    expect(boolResult.unit).toBeNull();

    const numResult = result.find(r => r.tag_path === 'M.Value');
    expect(numResult.eng_min).toBe(5);
    expect(numResult.unit).toBe('mA');
  });

  it('i16 tag inherits display fields normally', () => {
    const tag = makeTag('T', 'i16', false, {
      eng_min: { field_type: 'Numeric', default: -100 },
      eng_max: { field_type: 'Numeric', default: 100 },
      unit:   { field_type: 'String',  default: 'rpm' },
    });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'Speed', fields: {} },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].data_type).toBe('i16');
    expect(result[0].eng_min).toBe(-100);
    expect(result[0].eng_max).toBe(100);
    expect(result[0].unit).toBe('rpm');
  });
});

// ── resolveDisplayField — path-aware resolution ──────────────────────────────

describe('resolveDisplayField — path-aware resolution', () => {
  it('meta at parameter level shows ChildRef override, not ancestor dotted value', () => {
    // GP has I.unit: kA (dotted field). ChildRef for I has { unit: 'mA' }.
    // I's meta should show unit: mA (ChildRef), NOT kA (no dotted propagation into meta).
    const iParam = makeStruct('I_Param', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'val', fields: {} },
    ], { unit: { field_type: 'String', default: 'default' } });
    const tagT = makeTag('Tag_T');
    const gp = makeStruct('GP', 'module', [
      { template_name: 'I_Param', asset_name: 'I', fields: { unit: 'mA' } },
    ], { 'I.unit': { field_type: 'String', default: 'kA' } });
    const map = { GP: wrap(gp), I_Param: wrap(iParam), Tag_T: wrap(tagT) };

    const result = resolveRegistry(map, 'GP');
    expect(result).toHaveLength(1);
    const iMeta = result[0].meta.find(m => m.name === 'I');
    expect(iMeta.fields.unit).toBe('mA');   // ChildRef wins in meta
    expect(iMeta.fields.unit).not.toBe('kA'); // dotted NOT propagated into meta
  });

  it('dotted field appears only at the defining level in meta, not at the target level', () => {
    // GP has I.RSS.unit: kA/s. I's meta should NOT contain RSS.unit.
    // GP's meta SHOULD contain I.RSS.unit: kA/s.
    const rssTag = makeTag('RSS_Tag');
    const iParam = makeStruct('I_Param', 'parameter', [
      { template_name: 'RSS_Tag', asset_name: 'RSS', fields: {} },
    ]);
    const gp = makeStruct('GP', 'module', [
      { template_name: 'I_Param', asset_name: 'I', fields: {} },
    ], { 'I.RSS.unit': { field_type: 'String', default: 'kA/s' } });
    const map = { GP: wrap(gp), I_Param: wrap(iParam), RSS_Tag: wrap(rssTag) };

    const result = resolveRegistry(map, 'GP');
    expect(result).toHaveLength(1);
    // GP's meta contains the dotted field as-is
    const gpMeta = result[0].meta.find(m => m.name === 'GP');
    expect(gpMeta.fields['I.RSS.unit']).toBe('kA/s');
    // I's meta does NOT contain RSS.unit (no propagation)
    const iMeta = result[0].meta.find(m => m.name === 'I');
    expect(iMeta.fields['RSS.unit']).toBeUndefined();
  });

  it('display column: ancestor dotted field beats descendant direct field (root wins)', () => {
    // GP has I.unit: kA. ChildRef for I has { unit: 'mA' }.
    // Tag Set (child of I) display column unit should be kA (GP is root, wins).
    const iParam = makeStruct('I_Param', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'Set', fields: {} },
    ]);
    const tagT = makeTag('Tag_T');
    const gp = makeStruct('GP', 'module', [
      { template_name: 'I_Param', asset_name: 'I', fields: { unit: 'mA' } },
    ], { 'I.unit': { field_type: 'String', default: 'kA' } });
    const map = { GP: wrap(gp), I_Param: wrap(iParam), Tag_T: wrap(tagT) };

    const result = resolveRegistry(map, 'GP');
    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe('kA'); // GP's dotted field wins (root priority)
  });

  it('display column: more specific dotted field wins over less specific at same level', () => {
    // GP has both I.unit: kA and I.RSS.unit: kA/s.
    // Tag RSS display column: kA/s (specificity 2 wins).
    // Tag Set display column: kA (only specificity 1 matches).
    const rssTpl = makeTag('RSS_Tpl');
    const setTpl = makeTag('Set_Tpl');
    const iParam = makeStruct('I_Param', 'parameter', [
      { template_name: 'RSS_Tpl', asset_name: 'RSS', fields: {} },
      { template_name: 'Set_Tpl', asset_name: 'Set', fields: {} },
    ]);
    const gp = makeStruct('GP', 'module', [
      { template_name: 'I_Param', asset_name: 'I', fields: {} },
    ], {
      'I.unit':     { field_type: 'String', default: 'kA' },
      'I.RSS.unit': { field_type: 'String', default: 'kA/s' },
    });
    const map = { GP: wrap(gp), I_Param: wrap(iParam), RSS_Tpl: wrap(rssTpl), Set_Tpl: wrap(setTpl) };

    const result = resolveRegistry(map, 'GP');
    expect(result).toHaveLength(2);
    const rssResult = result.find(r => r.tag_path === 'GP.I.RSS');
    const setResult = result.find(r => r.tag_path === 'GP.I.Set');
    expect(rssResult.unit).toBe('kA/s'); // more specific wins
    expect(setResult.unit).toBe('kA');   // only less-specific match applies
  });

  it('display column falls through to parameter level when no ancestor dotted match exists', () => {
    // M has no dotted unit fields. I has unit: mA from ChildRef (template default is V).
    // Tag Set display column should be mA (inherited from I's meta via direct field).
    const iParam = makeStruct('I_Param', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'Set', fields: {} },
    ], { unit: { field_type: 'String', default: 'V' } });
    const tagT = makeTag('Tag_T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'I_Param', asset_name: 'I', fields: { unit: 'mA' } },
    ]);
    const map = { M: wrap(mod), I_Param: wrap(iParam), Tag_T: wrap(tagT) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe('mA'); // inherited from I's meta (ChildRef override)
  });

  it('display column: multi-level dotted key (A.B.unit) resolves without meta propagation', () => {
    // GGP has A.B.unit: kA/s. No intermediate levels define unit.
    // Tag under B should get kA/s from GGP's dotted field.
    // Intermediate meta levels (A, B) should have no unit field.
    const tagT = makeTag('Tag_T');
    const bParam = makeStruct('B_Param', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'val', fields: {} },
    ]);
    const aMod = makeStruct('A_Mod', 'module', [
      { template_name: 'B_Param', asset_name: 'B', fields: {} },
    ]);
    const ggp = makeStruct('GGP', 'system', [
      { template_name: 'A_Mod', asset_name: 'A', fields: {} },
    ], { 'A.B.unit': { field_type: 'String', default: 'kA/s' } });
    const map = { GGP: wrap(ggp), A_Mod: wrap(aMod), B_Param: wrap(bParam), Tag_T: wrap(tagT) };

    const result = resolveRegistry(map, 'GGP');
    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe('kA/s');
    // Intermediate meta levels have no unit (no propagation)
    const aMeta = result[0].meta.find(m => m.name === 'A');
    expect(aMeta.fields.unit).toBeUndefined();
    const bMeta = result[0].meta.find(m => m.name === 'B');
    expect(bMeta.fields.unit).toBeUndefined();
  });

  it('boolean tag still gets null for all display columns even with dotted fields in meta chain', () => {
    // Module has I.eng_min and I.unit dotted fields. I is a boolean tag.
    // All display columns should be null (isNumeric gate applies).
    const boolTag = makeTag('Bool_Tag', 'bool');
    const mod = makeStruct('M', 'module', [
      { template_name: 'Bool_Tag', asset_name: 'I', fields: {} },
    ], {
      'I.eng_min': { field_type: 'Numeric', default: 0 },
      'I.unit':    { field_type: 'String',  default: 'A' },
    });
    const map = { M: wrap(mod), Bool_Tag: wrap(boolTag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].data_type).toBe('bool');
    expect(result[0].eng_min).toBeNull();
    expect(result[0].eng_max).toBeNull();
    expect(result[0].unit).toBeNull();
    expect(result[0].format).toBeNull();
  });

  it('ChildRef override at parameter level: tag children inherit resolved display value', () => {
    // Analog_In has default unit: V. ChildRef for I overrides to unit: mA.
    // Tag val's display column for unit should be mA (from parameter meta level).
    const tagT = makeTag('Tag_T');
    const analogIn = makeStruct('Analog_In', 'parameter', [
      { template_name: 'Tag_T', asset_name: 'val', fields: {} },
    ], { unit: { field_type: 'String', default: 'V' } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'Analog_In', asset_name: 'I', fields: { unit: 'mA' } },
    ]);
    const map = { M: wrap(mod), Analog_In: wrap(analogIn), Tag_T: wrap(tagT) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe('mA'); // inherited from I's meta (ChildRef override)
  });
});

// ── TAG_PATH_TOO_LONG ─────────────────────────────────────────────────────────

describe('tag path too long', () => {
  it('tag whose resolved path exceeds MAX_TAG_PATH_LENGTH is excluded', () => {
    // 'M.' (2) + 99 'a' chars = 101 > 100
    const longAssetName = 'a'.repeat(MAX_TAG_PATH_LENGTH - 1); // 99 chars → 'M.' + 99 = 101
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: longAssetName, fields: {} },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result).toHaveLength(0);
  });
});

// ── tag_name resolution ───────────────────────────────────────────────────────

describe('tag_name resolution', () => {
  it('no level has In_Tag_Name → tag_name is empty string', () => {
    // makeTag/makeStruct do not set In_Tag_Name; all levels have it absent/false
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('');
  });

  it('only the tag level is flagged → tag_name equals the tag asset name', () => {
    const tag = makeTag('T', 'f32', false, { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'myTag', fields: {} }]);
    const map = { M: wrap(mod), T: wrap(tag) };
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('myTag');
  });

  it('root + tag both flagged → dot-joined in root→leaf order', () => {
    const tag = makeTag('T', 'f32', false, { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ], { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const map = { M: wrap(mod), T: wrap(tag) };
    // meta[0].name = 'M' (root, flagged), meta[1].name = 'ch' (tag, flagged)
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('M.ch');
  });

  it('parameter ancestor + tag flagged → dotted root→leaf, module level excluded', () => {
    const tag = makeTag('T', 'f32', false, { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const param = makeStruct('P', 'parameter', [
      { template_name: 'T', asset_name: 'setpoint', fields: {} },
    ], { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [{ template_name: 'P', asset_name: 'chan', fields: {} }]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };
    // module level 'M': no In_Tag_Name → excluded
    // parameter meta name = 'chan' (asset), flagged → included
    // tag meta name = 'setpoint' (asset), flagged → included
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('chan.setpoint');
  });

  it('ChildRef override true→false: instance suppresses tag-level flag', () => {
    const tag = makeTag('T', 'f32', false, { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { In_Tag_Name: false } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('');
  });

  it('ChildRef override false→true: instance enables tag-level flag', () => {
    const tag = makeTag('T', 'f32', false, { In_Tag_Name: { field_type: 'Boolean', default: false } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { In_Tag_Name: true } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('ch');
  });

  it('non-flagged middle level is excluded from tag_name', () => {
    // root (module) flagged, parameter NOT flagged, tag flagged → skip parameter name
    const tag = makeTag('T', 'f32', false, { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const param = makeStruct('P', 'parameter', [
      { template_name: 'T', asset_name: 'setpoint', fields: {} },
    ]); // no In_Tag_Name → excluded
    const mod = makeStruct('M', 'module', [
      { template_name: 'P', asset_name: 'chan', fields: {} },
    ], { In_Tag_Name: { field_type: 'Boolean', default: true } });
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };
    // 'M' flagged, 'chan' (parameter) not flagged, 'setpoint' (tag) flagged
    expect(resolveRegistry(map, 'M')[0].tag_name).toBe('M.setpoint');
  });
});