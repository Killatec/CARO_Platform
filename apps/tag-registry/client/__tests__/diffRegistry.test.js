import { describe, it, expect } from 'vitest';
import { diffRegistry } from '../src/utils/diffRegistry.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProposed(tag_path, overrides = {}) {
  return {
    tag_path,
    data_type: 'f32',
    is_setpoint: false,
    trends: false,
    module: 'Plant1_System_A',
    module_type: 'HMI',
    meta: [
      { type: 'tag',       name: tag_path.split('.').pop(), fields: { eng_min: 0, eng_max: 100 } },
      { type: 'parameter', name: 'Chan1',                   fields: { description: 'Channel 1' } },
      { type: 'module',    name: 'Plant1_System_A',         fields: {} },
    ],
    ...overrides,
  };
}

function makeDb(tag_path, tag_id, overrides = {}) {
  return { ...makeProposed(tag_path, overrides), tag_id, registry_rev: 1 };
}

const PATH_A = 'Plant1_System_A.Chan1.setpoint';
const PATH_B = 'Plant1_System_A.Chan1.monitor';
const PATH_C = 'Plant1_System_A.Chan2.setpoint';

// ── Empty inputs ──────────────────────────────────────────────────────────────

describe('empty inputs', () => {
  it('empty proposed and empty db → []', () => {
    expect(diffRegistry([], [])).toEqual([]);
  });

  it('empty db, non-empty proposed → all added', () => {
    const result = diffRegistry([makeProposed(PATH_A)], []);
    expect(result).toHaveLength(1);
    expect(result[0].diffStatus).toBe('added');
  });

  it('non-empty db, empty proposed → all retired', () => {
    const result = diffRegistry([], [makeDb(PATH_A, 1001)]);
    expect(result).toHaveLength(1);
    expect(result[0].diffStatus).toBe('retired');
  });
});

// ── Classification ────────────────────────────────────────────────────────────

describe('classification — added', () => {
  it('tag in proposed only → diffStatus added', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], []);
    expect(row.diffStatus).toBe('added');
  });

  it('added row has no tag_id', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], []);
    expect(row.tag_id).toBeUndefined();
  });

  it('added row has no dbMeta', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], []);
    expect(row.dbMeta).toBeUndefined();
  });
});

describe('classification — retired', () => {
  it('tag in db only → diffStatus retired', () => {
    const [row] = diffRegistry([], [makeDb(PATH_A, 1001)]);
    expect(row.diffStatus).toBe('retired');
  });

  it('retired row carries tag_id from db', () => {
    const [row] = diffRegistry([], [makeDb(PATH_A, 1001)]);
    expect(row.tag_id).toBe(1001);
  });
});

describe('classification — unchanged', () => {
  it('identical proposed and db → diffStatus unchanged', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], [makeDb(PATH_A, 1001)]);
    expect(row.diffStatus).toBe('unchanged');
  });

  it('unchanged row carries tag_id from db', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], [makeDb(PATH_A, 1001)]);
    expect(row.tag_id).toBe(1001);
  });

  it('unchanged row has no dbMeta', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], [makeDb(PATH_A, 1001)]);
    expect(row.dbMeta).toBeUndefined();
  });
});

describe('classification — modified (data_type)', () => {
  it('data_type differs → diffStatus modified', () => {
    const proposed = makeProposed(PATH_A, { data_type: 'bool' });
    const db       = makeDb(PATH_A, 1001, { data_type: 'f32' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });

  it('data_type change → changedFields includes data_type', () => {
    const proposed = makeProposed(PATH_A, { data_type: 'bool' });
    const db       = makeDb(PATH_A, 1001, { data_type: 'f32' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).toContain('data_type');
  });

  it('data_type change only → changedFields does not include meta or is_setpoint', () => {
    const proposed = makeProposed(PATH_A, { data_type: 'bool' });
    const db       = makeDb(PATH_A, 1001, { data_type: 'f32' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).not.toContain('meta');
    expect(row.changedFields).not.toContain('is_setpoint');
  });

  it('modified row carries tag_id from db', () => {
    const proposed = makeProposed(PATH_A, { data_type: 'bool' });
    const db       = makeDb(PATH_A, 1001, { data_type: 'f32' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.tag_id).toBe(1001);
  });

  it('non-meta change → dbMeta is still set (diffRegistry always includes it; RegistryTable filters it)', () => {
    const proposed = makeProposed(PATH_A, { data_type: 'bool' });
    const db       = makeDb(PATH_A, 1001, { data_type: 'f32' });
    const [row] = diffRegistry([proposed], [db]);
    // dbMeta is always present on modified rows; the table only passes it to the
    // modal when changedFields includes 'meta'
    expect(row.dbMeta).toBeDefined();
  });
});

describe('classification — modified (is_setpoint)', () => {
  it('is_setpoint differs → changedFields includes is_setpoint', () => {
    const proposed = makeProposed(PATH_A, { is_setpoint: true });
    const db       = makeDb(PATH_A, 1001, { is_setpoint: false });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
    expect(row.changedFields).toContain('is_setpoint');
  });
});

describe('classification — modified (meta)', () => {
  it('meta differs → changedFields includes meta', () => {
    const proposed = makeProposed(PATH_A, {
      meta: [{ type: 'tag', name: 'setpoint', fields: { eng_min: 0, eng_max: 200 } }],
    });
    const db = makeDb(PATH_A, 1001, {
      meta: [{ type: 'tag', name: 'setpoint', fields: { eng_min: 0, eng_max: 100 } }],
    });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
    expect(row.changedFields).toContain('meta');
  });

  it('meta change → dbMeta is set to db meta', () => {
    const dbMeta = [{ type: 'tag', name: 'setpoint', fields: { eng_min: 0, eng_max: 100 } }];
    const proposed = makeProposed(PATH_A, {
      meta: [{ type: 'tag', name: 'setpoint', fields: { eng_min: 0, eng_max: 200 } }],
    });
    const db = makeDb(PATH_A, 1001, { meta: dbMeta });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.dbMeta).toEqual(dbMeta);
  });
});

describe('classification — modified (trends)', () => {
  it('trends differs → diffStatus modified', () => {
    const proposed = makeProposed(PATH_A, { trends: true });
    const db       = makeDb(PATH_A, 1001, { trends: false });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });

  it('trends change → changedFields includes trends', () => {
    const proposed = makeProposed(PATH_A, { trends: true });
    const db       = makeDb(PATH_A, 1001, { trends: false });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).toContain('trends');
  });

  it('trends change only → changedFields does not include meta or is_setpoint', () => {
    const proposed = makeProposed(PATH_A, { trends: true });
    const db       = makeDb(PATH_A, 1001, { trends: false });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).not.toContain('meta');
    expect(row.changedFields).not.toContain('is_setpoint');
  });

  it('same trends value → not in changedFields', () => {
    const proposed = makeProposed(PATH_A, { trends: true });
    const db       = makeDb(PATH_A, 1001, { trends: true });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
    expect(row.changedFields).toBeUndefined();
  });
});

describe('classification — modified (module)', () => {
  it('module differs → diffStatus modified', () => {
    const proposed = makeProposed(PATH_A, { module: 'Plant2_System_B' });
    const db       = makeDb(PATH_A, 1001, { module: 'Plant1_System_A' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });

  it('module change → changedFields includes module', () => {
    const proposed = makeProposed(PATH_A, { module: 'Plant2_System_B' });
    const db       = makeDb(PATH_A, 1001, { module: 'Plant1_System_A' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).toContain('module');
  });

  it('module change only → changedFields does not include data_type or meta', () => {
    const proposed = makeProposed(PATH_A, { module: 'Plant2_System_B' });
    const db       = makeDb(PATH_A, 1001, { module: 'Plant1_System_A' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).not.toContain('data_type');
    expect(row.changedFields).not.toContain('meta');
  });

  it('same module value → not in changedFields', () => {
    const proposed = makeProposed(PATH_A, { module: 'Plant1_System_A' });
    const db       = makeDb(PATH_A, 1001, { module: 'Plant1_System_A' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
  });

  it('null proposed module vs non-null db module → modified', () => {
    const proposed = makeProposed(PATH_A, { module: null });
    const db       = makeDb(PATH_A, 1001, { module: 'Plant1_System_A' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
    expect(row.changedFields).toContain('module');
  });
});

describe('classification — modified (module_type)', () => {
  it('module_type differs → diffStatus modified', () => {
    const proposed = makeProposed(PATH_A, { module_type: 'MQTT' });
    const db       = makeDb(PATH_A, 1001, { module_type: 'HMI' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });

  it('module_type change → changedFields includes module_type', () => {
    const proposed = makeProposed(PATH_A, { module_type: 'MQTT' });
    const db       = makeDb(PATH_A, 1001, { module_type: 'HMI' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).toContain('module_type');
  });

  it('module_type change only → changedFields does not include module or data_type', () => {
    const proposed = makeProposed(PATH_A, { module_type: 'MQTT' });
    const db       = makeDb(PATH_A, 1001, { module_type: 'HMI' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).not.toContain('module');
    expect(row.changedFields).not.toContain('data_type');
  });

  it('same module_type value → not in changedFields', () => {
    const proposed = makeProposed(PATH_A, { module_type: 'MQTT' });
    const db       = makeDb(PATH_A, 1001, { module_type: 'MQTT' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
  });

  it('null proposed module_type vs non-null db module_type → modified', () => {
    const proposed = makeProposed(PATH_A, { module_type: null });
    const db       = makeDb(PATH_A, 1001, { module_type: 'HMI' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
    expect(row.changedFields).toContain('module_type');
  });
});

describe('classification — multiple fields changed', () => {
  it('all six fields changed → changedFields has data_type, is_setpoint, trends, module, module_type, and meta', () => {
    const proposed = makeProposed(PATH_A, {
      data_type: 'i32',
      is_setpoint: true,
      trends: true,
      module: 'NewModule',
      module_type: 'MQTT',
      meta: [{ type: 'tag', name: 'x', fields: { val: 999 } }],
    });
    const db = makeDb(PATH_A, 1001, {
      data_type: 'f32',
      is_setpoint: false,
      trends: false,
      module: 'Plant1_System_A',
      module_type: 'HMI',
      meta: [{ type: 'tag', name: 'x', fields: { val: 0 } }],
    });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).toContain('data_type');
    expect(row.changedFields).toContain('is_setpoint');
    expect(row.changedFields).toContain('trends');
    expect(row.changedFields).toContain('module');
    expect(row.changedFields).toContain('module_type');
    expect(row.changedFields).toContain('meta');
  });
});

// ── deepEqual — order-insensitive meta comparison ──────────────────────────────

describe('deepEqual — key-order insensitive (via meta comparison)', () => {
  it('meta with same keys in different JS insertion order → unchanged', () => {
    // proposed meta has keys: eng_max, eng_min (reverse order)
    const proposed = makeProposed(PATH_A, {
      meta: [{ type: 'tag', name: 'setpoint', fields: { eng_max: 100, eng_min: 0 } }],
    });
    // db meta has keys: eng_min, eng_max (forward order)
    const db = makeDb(PATH_A, 1001, {
      meta: [{ type: 'tag', name: 'setpoint', fields: { eng_min: 0, eng_max: 100 } }],
    });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
  });

  it('nested object with different key order → unchanged', () => {
    const proposed = makeProposed(PATH_A, {
      meta: [{ type: 'tag', name: 'x', fields: { z: 3, a: 1, m: 2 } }],
    });
    const db = makeDb(PATH_A, 1001, {
      meta: [{ type: 'tag', name: 'x', fields: { a: 1, m: 2, z: 3 } }],
    });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
  });

  it('same array elements, different values → modified', () => {
    const proposed = makeProposed(PATH_A, {
      meta: [{ type: 'tag', name: 'x', fields: { eng_min: 5 } }],
    });
    const db = makeDb(PATH_A, 1001, {
      meta: [{ type: 'tag', name: 'x', fields: { eng_min: 0 } }],
    });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });

  it('different array length → modified', () => {
    const proposed = makeProposed(PATH_A, {
      meta: [
        { type: 'tag',    name: 'setpoint', fields: {} },
        { type: 'module', name: 'M',        fields: {} },
      ],
    });
    const db = makeDb(PATH_A, 1001, {
      meta: [{ type: 'tag', name: 'setpoint', fields: {} }],
    });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });
});

// ── Sort order ────────────────────────────────────────────────────────────────

describe('sort order', () => {
  it('result order is added → modified → unchanged → retired', () => {
    const proposed = [
      makeProposed(PATH_A),                                  // unchanged
      makeProposed(PATH_B, { data_type: 'i32' }),             // modified (db has 'f32')
      makeProposed(PATH_C),                                  // added (not in db)
    ];
    const db = [
      makeDb(PATH_A, 1001),                                  // unchanged
      makeDb(PATH_B, 1002, { data_type: 'f32' }),             // modified
      makeDb('Plant1_System_A.Chan3.monitor', 1003),         // retired (not in proposed)
    ];

    const result = diffRegistry(proposed, db);
    const statuses = result.map(r => r.diffStatus);
    expect(statuses).toEqual(['added', 'modified', 'unchanged', 'retired']);
  });
});

// ── tag_id carry-over ─────────────────────────────────────────────────────────

describe('tag_id carry-over', () => {
  it('unchanged rows carry tag_id from db', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], [makeDb(PATH_A, 5555)]);
    expect(row.tag_id).toBe(5555);
  });

  it('modified rows carry tag_id from db', () => {
    const proposed = makeProposed(PATH_A, { data_type: 'i32' });
    const db       = makeDb(PATH_A, 7777, { data_type: 'f32' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.tag_id).toBe(7777);
  });

  it('retired rows carry tag_id from db', () => {
    const [row] = diffRegistry([], [makeDb(PATH_A, 9999)]);
    expect(row.tag_id).toBe(9999);
  });

  it('added rows have undefined tag_id', () => {
    const [row] = diffRegistry([makeProposed(PATH_A)], []);
    expect(row.tag_id).toBeUndefined();
  });
});

// ── Multiple tags ─────────────────────────────────────────────────────────────

describe('multiple tags', () => {
  it('mixed proposed and db → correct counts', () => {
    const proposed = [makeProposed(PATH_A), makeProposed(PATH_B), makeProposed(PATH_C)];
    const db       = [makeDb(PATH_A, 1001), makeDb(PATH_B, 1002, { data_type: 'i32' })];
    // PATH_A unchanged, PATH_B modified, PATH_C added, no retired

    const result = diffRegistry(proposed, db);
    expect(result.filter(r => r.diffStatus === 'added')).toHaveLength(1);
    expect(result.filter(r => r.diffStatus === 'modified')).toHaveLength(1);
    expect(result.filter(r => r.diffStatus === 'unchanged')).toHaveLength(1);
    expect(result.filter(r => r.diffStatus === 'retired')).toHaveLength(0);
  });
});

// ── tag_name ──────────────────────────────────────────────────────────────────

describe('classification — modified (tag_name)', () => {
  it('tag_name differs → diffStatus modified', () => {
    const proposed = makeProposed(PATH_A, { tag_name: 'new_name' });
    const db       = makeDb(PATH_A, 1001, { tag_name: 'old_name' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
  });

  it('tag_name change → changedFields includes tag_name', () => {
    const proposed = makeProposed(PATH_A, { tag_name: 'new_name' });
    const db       = makeDb(PATH_A, 1001, { tag_name: 'old_name' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).toContain('tag_name');
  });

  it('tag_name change only → changedFields does not include data_type or meta', () => {
    const proposed = makeProposed(PATH_A, { tag_name: 'new_name' });
    const db       = makeDb(PATH_A, 1001, { tag_name: 'old_name' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.changedFields).not.toContain('data_type');
    expect(row.changedFields).not.toContain('meta');
  });

  it('same tag_name → diffStatus unchanged, tag_name not in changedFields', () => {
    const proposed = makeProposed(PATH_A, { tag_name: 'same' });
    const db       = makeDb(PATH_A, 1001, { tag_name: 'same' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
    expect(row.changedFields).toBeUndefined();
  });

  it('null proposed tag_name vs non-null db tag_name → modified', () => {
    const proposed = makeProposed(PATH_A, { tag_name: null });
    const db       = makeDb(PATH_A, 1001, { tag_name: 'old_name' });
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('modified');
    expect(row.changedFields).toContain('tag_name');
  });

  it('both tag_name absent (undefined) → no-op, diffStatus unchanged', () => {
    // Existing makeProposed/makeDb fixtures omit tag_name; null-normalization keeps equal
    const proposed = makeProposed(PATH_A);
    const db       = makeDb(PATH_A, 1001);
    const [row] = diffRegistry([proposed], [db]);
    expect(row.diffStatus).toBe('unchanged');
    expect(row.changedFields).toBeUndefined();
  });
});