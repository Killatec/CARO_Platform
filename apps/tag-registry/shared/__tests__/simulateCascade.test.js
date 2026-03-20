import { describe, it, expect } from 'vitest';
import { simulateCascade } from '../simulateCascade.js';

function makeTemplate(name, type, fields = {}, children = []) {
  return { template_type: type, template_name: name, fields, children };
}

function wrap(template) {
  return { template, hash: 'aabbcc' };
}

const EMPTY_DIFF = {
  fields_added: [],
  fields_removed: [],
  fields_changed: [],
  instance_fields_changed: [],
};

// ── Null / empty ─────────────────────────────────────────────────────────────

describe('null / empty inputs', () => {
  it('null map → requiresConfirmation: false, all diff arrays empty', () => {
    const r = simulateCascade(null, []);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.diff).toEqual(EMPTY_DIFF);
    expect(r.affectedParents).toHaveLength(0);
  });

  it('empty map → requiresConfirmation: false', () => {
    expect(simulateCascade({}, []).requiresConfirmation).toBe(false);
  });
});

// ── Field added ───────────────────────────────────────────────────────────────

describe('field added', () => {
  it('adds entry to diff.fields_added, no requiresConfirmation (no parent)', () => {
    const tplA = makeTemplate('A', 'tag', {});
    const map = { A: wrap(tplA) };
    const proposed = [{ template_name: 'A', template: makeTemplate('A', 'tag', {
      eng_min: { field_type: 'Numeric', default: 0 },
    }) }];

    const r = simulateCascade(map, proposed);
    expect(r.diff.fields_added).toContainEqual({ template_name: 'A', field: 'eng_min' });
    expect(r.requiresConfirmation).toBe(false);
  });
});

// ── Field removed ─────────────────────────────────────────────────────────────

describe('field removed', () => {
  it('adds entry to diff.fields_removed', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const map = { A: wrap(tplA) };
    const proposed = [{ template_name: 'A', template: makeTemplate('A', 'tag', {}) }];

    const r = simulateCascade(map, proposed);
    expect(r.diff.fields_removed).toContainEqual({ template_name: 'A', field: 'eng_min' });
  });
});

// ── Field default changed ─────────────────────────────────────────────────────

describe('field default changed', () => {
  it('adds entry to diff.fields_changed with old and new values', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const map = { A: wrap(tplA) };
    const proposed = [{ template_name: 'A', template: makeTemplate('A', 'tag', {
      eng_min: { field_type: 'Numeric', default: 99 },
    }) }];

    const r = simulateCascade(map, proposed);
    expect(r.diff.fields_changed).toContainEqual({
      template_name: 'A', field: 'eng_min', old_value: 0, new_value: 99,
    });
  });
});

// ── Affected parents — requiresConfirmation ───────────────────────────────────

describe('affectedParents', () => {
  it('parent B referencing A gains affectedParents entry when A field is removed', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch1', fields: {} },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };
    const proposed = [{ template_name: 'A', template: makeTemplate('A', 'tag', {}) }];

    const r = simulateCascade(map, proposed);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.affectedParents).toContainEqual(expect.objectContaining({
      parent_template_name: 'B',
      asset_name: 'ch1',
    }));
  });

  it('two children of B both referencing A → two affectedParents entries', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch1', fields: {} },
      { template_name: 'A', asset_name: 'ch2', fields: {} },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };
    const proposed = [{ template_name: 'A', template: makeTemplate('A', 'tag', {}) }];

    const r = simulateCascade(map, proposed);
    expect(r.affectedParents).toHaveLength(2);
    expect(r.affectedParents.map(p => p.asset_name)).toEqual(expect.arrayContaining(['ch1', 'ch2']));
  });

  it('dropped_instance_values contains overrides for removed fields', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch1', fields: { eng_min: 5 } },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };
    const proposed = [{ template_name: 'A', template: makeTemplate('A', 'tag', {}) }];

    const r = simulateCascade(map, proposed);
    const parent = r.affectedParents.find(p => p.asset_name === 'ch1');
    expect(parent).toBeDefined();
    expect(parent.dropped_instance_values).toContainEqual(
      expect.objectContaining({ field: 'eng_min', value: 5 })
    );
  });
});

// ── Instance override change (no upstream effect) ─────────────────────────────

describe('instance override change', () => {
  it('changing only an instance override on B does not set requiresConfirmation', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const tplB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch1', fields: { eng_min: 5 } },
    ]);
    const map = { A: wrap(tplA), B: wrap(tplB) };

    // Only B changes — instance override eng_min 5 → 99
    const proposedB = makeTemplate('B', 'module', {}, [
      { template_name: 'A', asset_name: 'ch1', fields: { eng_min: 99 } },
    ]);
    const r = simulateCascade(map, [{ template_name: 'B', template: proposedB }]);

    expect(r.requiresConfirmation).toBe(false);
    expect(r.diff.instance_fields_changed).toContainEqual(expect.objectContaining({
      asset_name: 'ch1',
      field: 'eng_min',
      old_value: 5,
      new_value: 99,
    }));
  });
});

// ── No change ────────────────────────────────────────────────────────────────

describe('no change', () => {
  it('proposed identical to current → all diff arrays empty', () => {
    const tplA = makeTemplate('A', 'tag', { eng_min: { field_type: 'Numeric', default: 0 } });
    const map = { A: wrap(tplA) };
    const r = simulateCascade(map, [{ template_name: 'A', template: { ...tplA } }]);
    expect(r.diff).toEqual(EMPTY_DIFF);
    expect(r.requiresConfirmation).toBe(false);
  });
});
