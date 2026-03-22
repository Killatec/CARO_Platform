import { describe, it, expect } from 'vitest';
import { resolveRegistry } from '../resolveRegistry.js';
import { MAX_TAG_PATH_LENGTH } from '../constants.js';

function makeTag(name, dataType = 'f64', isSetpoint = false, fields = {}) {
  return {
    template_type: 'tag',
    template_name: name,
    data_type: dataType,
    is_setpoint: isSetpoint,
    fields,
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
    const tag = makeTag('T', 'f64', true);
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
  it('meta is leaf-to-root: meta[0].name is the tag asset_name, last is root', () => {
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter', [{ template_name: 'T', asset_name: 'setpoint', fields: {} }]);
    const mod = makeStruct('M', 'module', [{ template_name: 'P', asset_name: 'chan', fields: {} }]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    const { meta } = result[0];
    expect(meta[0].name).toBe('setpoint');
    expect(meta[1].name).toBe('chan');
    expect(meta[2].name).toBe('M');
  });
});

// ── Meta field resolution ─────────────────────────────────────────────────────

describe('meta field resolution', () => {
  it('instance override wins over template default; value is scalar, not {field_type,default}', () => {
    const tag = makeTag('T', 'f64', false, { eng_min: { field_type: 'Numeric', default: 0 } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: { eng_min: 5 } },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    const { meta } = result[0];
    // meta[0] is the tag level
    expect(meta[0].fields.eng_min).toBe(5);
    // Must be a scalar, not a {field_type, default} object
    expect(typeof meta[0].fields.eng_min).toBe('number');
  });

  it('template default used when no instance override', () => {
    const tag = makeTag('T', 'f64', false, { eng_min: { field_type: 'Numeric', default: 42 } });
    const mod = makeStruct('M', 'module', [
      { template_name: 'T', asset_name: 'ch', fields: {} },
    ]);
    const map = { M: wrap(mod), T: wrap(tag) };

    const result = resolveRegistry(map, 'M');
    expect(result[0].meta[0].fields.eng_min).toBe(42);
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
