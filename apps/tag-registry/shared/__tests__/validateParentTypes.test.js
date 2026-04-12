import { describe, it, expect } from 'vitest';
import { validateParentTypes } from '../validateParentTypes.ts';
import { ERROR_CODES } from '../constants.ts';

function makeTag(name) {
  return { template_type: 'tag', template_name: name, fields: {}, children: [] };
}

function makeStruct(name, type, children = []) {
  return { template_type: type, template_name: name, fields: {}, children };
}

function wrap(template) {
  return { template, hash: 'aabbcc' };
}

// ── No-op when unconfigured ───────────────────────────────────────────────────

describe('no-op when unconfigured', () => {
  it('empty options → { errors: [], warnings: [] }', () => {
    const map = { M: wrap(makeStruct('M', 'module')) };
    expect(validateParentTypes(map, 'M', {})).toEqual({ errors: [], warnings: [] });
  });

  it('explicit empty rules → { errors: [], warnings: [] }', () => {
    const map = { M: wrap(makeStruct('M', 'module')) };
    expect(validateParentTypes(map, 'M', { requiredParentTypes: [], uniqueParentTypes: false }))
      .toEqual({ errors: [], warnings: [] });
  });

  it('null map → { errors: [], warnings: [] }', () => {
    expect(validateParentTypes(null, 'root')).toEqual({ errors: [], warnings: [] });
  });
});

// ── REQUIRED PARENT TYPE — satisfied ─────────────────────────────────────────

describe('required parent type — satisfied', () => {
  it('S → M (module) → T: "module" required → no errors', () => {
    const tag = makeTag('T');
    const mod = makeStruct('M', 'module', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const sys = makeStruct('S', 'system', [{ template_name: 'M', asset_name: 'mod', fields: {} }]);
    const map = { S: wrap(sys), M: wrap(mod), T: wrap(tag) };

    const r = validateParentTypes(map, 'S', { requiredParentTypes: ['module'] });
    expect(r.errors).toHaveLength(0);
  });
});

// ── REQUIRED PARENT TYPE — missing ────────────────────────────────────────────

describe('required parent type — missing', () => {
  it('S → T (no module in chain): "module" required → PARENT_TYPE_MISSING', () => {
    const tag = makeTag('T');
    const sys = makeStruct('S', 'system', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const map = { S: wrap(sys), T: wrap(tag) };

    const r = validateParentTypes(map, 'S', { requiredParentTypes: ['module'] });
    expect(r.errors.some(e => e.code === ERROR_CODES.PARENT_TYPE_MISSING)).toBe(true);
  });
});

// ── UNIQUE PARENT TYPE — satisfied ────────────────────────────────────────────

describe('unique parent type — satisfied', () => {
  it('M → P → T (one parameter): uniqueParentTypes → no errors', () => {
    const tag = makeTag('T');
    const param = makeStruct('P', 'parameter', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const mod = makeStruct('M', 'module', [{ template_name: 'P', asset_name: 'p', fields: {} }]);
    const map = { M: wrap(mod), P: wrap(param), T: wrap(tag) };

    const r = validateParentTypes(map, 'M', { uniqueParentTypes: true });
    expect(r.errors).toHaveLength(0);
  });
});

// ── UNIQUE PARENT TYPE — violated ─────────────────────────────────────────────

describe('unique parent type — violated', () => {
  it('M → P1 (parameter) → P2 (parameter) → T: two parameters → DUPLICATE_PARENT_TYPE', () => {
    const tag = makeTag('T');
    const p2 = makeStruct('P2', 'parameter', [{ template_name: 'T', asset_name: 'ch', fields: {} }]);
    const p1 = makeStruct('P1', 'parameter', [{ template_name: 'P2', asset_name: 'p2', fields: {} }]);
    const mod = makeStruct('M', 'module', [{ template_name: 'P1', asset_name: 'p1', fields: {} }]);
    const map = { M: wrap(mod), P1: wrap(p1), P2: wrap(p2), T: wrap(tag) };

    const r = validateParentTypes(map, 'M', { uniqueParentTypes: true });
    expect(r.errors.some(e => e.code === ERROR_CODES.DUPLICATE_PARENT_TYPE)).toBe(true);
  });
});
