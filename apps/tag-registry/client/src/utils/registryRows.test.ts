import { describe, it, expect } from 'vitest';
import { resolveDisplayRows, sortRegistryRows } from './registryRows.js';
import type { DiffRow } from './diffRegistry.js';
import type { NewTagInput } from '@caro/db';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTag(overrides: Partial<NewTagInput> = {}): NewTagInput {
  return {
    tag_path: 'Root.A',
    data_type: 'f32',
    is_setpoint: false,
    meta: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<DiffRow> = {}): DiffRow {
  return {
    tag_path: 'Root.A',
    module: null,
    module_type: null,
    data_type: 'f32',
    is_setpoint: false,
    meta: null,
    diffStatus: 'unchanged',
    ...overrides,
  };
}

// ── resolveDisplayRows ────────────────────────────────────────────────────────

describe('resolveDisplayRows', () => {
  it('returns the diff rows as-is when provided', () => {
    const rows = [makeRow({ tag_path: 'Root.A', diffStatus: 'added' })];
    expect(resolveDisplayRows(rows, [])).toBe(rows);
  });

  it('returns null-diff rows unchanged even when tags are also provided', () => {
    const rows = [makeRow({ diffStatus: 'retired' })];
    const tags = [makeTag({ tag_path: 'Root.B' })];
    expect(resolveDisplayRows(rows, tags)).toBe(rows);
  });

  it('builds synthetic unchanged rows from tags when rows is null', () => {
    const tags = [makeTag({ tag_path: 'Root.A', module: undefined, module_type: undefined })];
    const result = resolveDisplayRows(null, tags);
    expect(result).toEqual([
      { tag_path: 'Root.A', data_type: 'f32', is_setpoint: false, meta: null, module: null, module_type: null, diffStatus: 'unchanged' },
    ]);
  });

  it('builds synthetic unchanged rows from tags when rows is undefined', () => {
    const tags = [makeTag({ tag_path: 'Root.A' })];
    const result = resolveDisplayRows(undefined, tags);
    expect(result).toHaveLength(1);
    expect(result[0].diffStatus).toBe('unchanged');
  });

  it('preserves an explicit module/module_type instead of nulling it', () => {
    const tags = [makeTag({ tag_path: 'Root.A', module: 'Sys1', module_type: 'HMI' })];
    const result = resolveDisplayRows(null, tags);
    expect(result[0].module).toBe('Sys1');
    expect(result[0].module_type).toBe('HMI');
  });
});

// ── sortRegistryRows ──────────────────────────────────────────────────────────

describe('sortRegistryRows', () => {
  it('sorts by tag_path ascending', () => {
    const rows = [makeRow({ tag_path: 'B' }), makeRow({ tag_path: 'A' }), makeRow({ tag_path: 'C' })];
    const result = sortRegistryRows(rows, 'tag_path', 'asc');
    expect(result.map(r => r.tag_path)).toEqual(['A', 'B', 'C']);
  });

  it('sorts by tag_path descending', () => {
    const rows = [makeRow({ tag_path: 'B' }), makeRow({ tag_path: 'A' }), makeRow({ tag_path: 'C' })];
    const result = sortRegistryRows(rows, 'tag_path', 'desc');
    expect(result.map(r => r.tag_path)).toEqual(['C', 'B', 'A']);
  });

  it('sorts tag_id numerically, not lexicographically', () => {
    const rows = [
      makeRow({ tag_path: 'A', tag_id: 2 }),
      makeRow({ tag_path: 'B', tag_id: 10 }),
      makeRow({ tag_path: 'C', tag_id: 1 }),
    ];
    const result = sortRegistryRows(rows, 'tag_id', 'asc');
    expect(result.map(r => r.tag_id)).toEqual([1, 2, 10]);
  });

  it('treats a missing tag_id (added rows) as the largest value — last in ascending order', () => {
    const rows = [
      makeRow({ tag_path: 'A', tag_id: 5 }),
      makeRow({ tag_path: 'B', diffStatus: 'added' }), // no tag_id
      makeRow({ tag_path: 'C', tag_id: 1 }),
    ];
    const asc = sortRegistryRows(rows, 'tag_id', 'asc');
    expect(asc.map(r => r.tag_path)).toEqual(['C', 'A', 'B']);
  });

  it('does not mutate the input array', () => {
    const rows = [makeRow({ tag_path: 'B' }), makeRow({ tag_path: 'A' })];
    const original = [...rows];
    sortRegistryRows(rows, 'tag_path', 'asc');
    expect(rows).toEqual(original);
  });
});
