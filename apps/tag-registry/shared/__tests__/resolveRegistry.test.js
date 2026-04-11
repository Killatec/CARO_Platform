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