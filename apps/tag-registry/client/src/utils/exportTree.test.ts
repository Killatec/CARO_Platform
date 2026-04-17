import { describe, it, expect } from 'vitest';
import { exportTree } from './exportTree.js';
import type { TemplateEntry } from '@caro/tag-registry-shared';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(
  template_name: string,
  template_type: string,
  children: Array<{ template_name: string; asset_name: string }> = []
): TemplateEntry {
  return {
    template: {
      template_name,
      template_type,
      fields: {},
      children: children.map(c => ({ ...c, fields: {} })),
    },
    hash: null,
  };
}

/**
 * Tree shape:
 *   root (system)
 *     ChildA (module)   asset_name: "A"
 *       Grandchild (parameter)  asset_name: "G"
 *     ChildB (module)   asset_name: "B"
 */
function makeFixture(): Map<string, TemplateEntry> {
  const map = new Map<string, TemplateEntry>();
  map.set('Root', makeEntry('Root', 'system', [
    { template_name: 'ChildA', asset_name: 'A' },
    { template_name: 'ChildB', asset_name: 'B' },
  ]));
  map.set('ChildA', makeEntry('ChildA', 'module', [
    { template_name: 'Grandchild', asset_name: 'G' },
  ]));
  map.set('ChildB', makeEntry('ChildB', 'module', []));
  map.set('Grandchild', makeEntry('Grandchild', 'parameter', []));
  return map;
}

// ── Shape assertions ──────────────────────────────────────────────────────────

describe('exportTree', () => {
  it('returns null for missing root', () => {
    const map = makeFixture();
    expect(exportTree(map, 'NonExistent')).toBeNull();
  });

  it('returns null when templateMap is empty', () => {
    expect(exportTree(new Map(), 'Root')).toBeNull();
  });

  it('root node has correct asset_name, template_type, and children count', () => {
    const result = exportTree(makeFixture(), 'Root');
    expect(result).not.toBeNull();
    expect(result!.asset_name).toBe('Root');
    expect(result!.template_type).toBe('system');
    expect(result!.children).toHaveLength(2);
  });

  it('first child has correct shape', () => {
    const result = exportTree(makeFixture(), 'Root');
    const childA = result!.children[0];
    expect(childA.asset_name).toBe('A');
    expect(childA.template_type).toBe('module');
    expect(childA.children).toHaveLength(1);
  });

  it('second child has correct shape', () => {
    const result = exportTree(makeFixture(), 'Root');
    const childB = result!.children[1];
    expect(childB.asset_name).toBe('B');
    expect(childB.template_type).toBe('module');
    expect(childB.children).toHaveLength(0);
  });

  it('grandchild has correct shape', () => {
    const result = exportTree(makeFixture(), 'Root');
    const grandchild = result!.children[0].children[0];
    expect(grandchild.asset_name).toBe('G');
    expect(grandchild.template_type).toBe('parameter');
    expect(grandchild.children).toHaveLength(0);
  });

  it('no extra keys at root level', () => {
    const result = exportTree(makeFixture(), 'Root');
    expect(Object.keys(result!).sort()).toEqual(['asset_name', 'children', 'template_type']);
  });

  it('no extra keys at child level', () => {
    const result = exportTree(makeFixture(), 'Root');
    const childA = result!.children[0];
    expect(Object.keys(childA).sort()).toEqual(['asset_name', 'children', 'template_type']);
  });

  it('no extra keys at grandchild level', () => {
    const result = exportTree(makeFixture(), 'Root');
    const grandchild = result!.children[0].children[0];
    expect(Object.keys(grandchild).sort()).toEqual(['asset_name', 'children', 'template_type']);
  });

  it('is JSON-serializable (round-trip)', () => {
    const result = exportTree(makeFixture(), 'Root');
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual(result);
  });

  it('skips children whose template_name is missing from the map', () => {
    const map = makeFixture();
    // Add a child ref that points to a non-existent template
    const rootEntry = map.get('Root')!;
    rootEntry.template.children.push({ template_name: 'Missing', asset_name: 'X', fields: {} });
    const result = exportTree(map, 'Root');
    // Still only 2 resolved children (Missing is skipped)
    expect(result!.children).toHaveLength(2);
  });
});
