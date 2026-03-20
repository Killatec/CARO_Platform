import { describe, it, expect } from 'vitest';
import { applyFieldCascade } from '../applyFieldCascade.js';

function makeTemplate(name, type, fields = {}, children = []) {
  return { template_type: type, template_name: name, fields, children };
}

function wrap(template) {
  return { template, hash: 'aabbcc' };
}

// ── Pure — does not mutate input ──────────────────────────────────────────────

describe('immutability', () => {
  it('does not mutate the input templateMap', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch', fields: { eng_min: 5 } },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };
    const snapshot = JSON.stringify(map);

    // A loses eng_min
    applyFieldCascade(map, makeTemplate('A', 'tag', {}));
    expect(JSON.stringify(map)).toBe(snapshot);
  });
});

// ── Return type mirrors input type ────────────────────────────────────────────

describe('return type', () => {
  it('plain object in → plain object out', () => {
    const map = { A: wrap(makeTemplate('A', 'tag', {})) };
    const result = applyFieldCascade(map, makeTemplate('A', 'tag', {}));
    expect(result).not.toBeInstanceOf(Map);
    expect(typeof result).toBe('object');
  });

  it('Map in → Map out', () => {
    const map = new Map([['A', wrap(makeTemplate('A', 'tag', {}))]]);
    const result = applyFieldCascade(map, makeTemplate('A', 'tag', {}));
    expect(result).toBeInstanceOf(Map);
  });
});

// ── Field added to A — B's existing overrides unaffected ─────────────────────

describe('field added', () => {
  it("adding a field to A does not modify B's child override object", () => {
    const tplA = makeTemplate('A', 'tag', {});
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch', fields: {} },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };

    const changedA = makeTemplate('A', 'tag', { new_field: { field_type: 'Numeric', default: 0 } });
    const result = applyFieldCascade(map, changedA);

    const bChildren = result.B.template.children;
    // The child for A still exists; fields is still {} (new_field has no override yet)
    expect(bChildren[0].fields).toEqual({});
  });
});

// ── Field removed from A — stale override on B is dropped ────────────────────

describe('field removed', () => {
  it("removing A's eng_min drops the override on B's child", () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch', fields: { eng_min: 5 } },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };

    const changedA = makeTemplate('A', 'tag', {}); // eng_min removed
    const result = applyFieldCascade(map, changedA);

    const bChildren = result.B.template.children;
    expect(bChildren[0].fields).not.toHaveProperty('eng_min');
  });
});

// ── Only one level propagated (no transitive cascade) ────────────────────────

describe('one level only', () => {
  it('A → B → C: changing A only updates B; C is untouched', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'parameter', {}, [
      { template_name: 'A', asset_name: 'a_inst', fields: { eng_min: 7 } },
    ]);
    const tplC = makeTemplate('C', 'module', {}, [
      { template_name: 'B', asset_name: 'b_inst', fields: {} },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB), C: wrap(tplC) };

    const originalCSnapshot = JSON.stringify(map.C);
    const changedA = makeTemplate('A', 'tag', {}); // removes eng_min
    const result = applyFieldCascade(map, changedA);

    // B's child override for eng_min should be dropped
    expect(result.B.template.children[0].fields).not.toHaveProperty('eng_min');
    // C is unchanged
    expect(JSON.stringify(result.C)).toBe(originalCSnapshot);
  });
});

// ── Unrelated templates are unchanged ─────────────────────────────────────────

describe('unrelated templates', () => {
  it('template X not referencing A is identical in result', () => {
    const tplA = makeTemplate('A', 'tag', { f: { field_type: 'Numeric', default: 0 } });
    const tplX = makeTemplate('X', 'parameter', { g: { field_type: 'String', default: 'hi' } }, []);
    const map = { A: wrap(tplA), X: wrap(tplX) };

    const changedA = makeTemplate('A', 'tag', {});
    const result = applyFieldCascade(map, changedA);

    expect(JSON.stringify(result.X)).toBe(JSON.stringify(map.X));
  });
});
