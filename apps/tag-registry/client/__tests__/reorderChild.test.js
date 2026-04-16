import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTemplateGraphStore } from '../src/stores/useTemplateGraphStore.ts';
import { makeStruct, makeEntry } from './fixtures.js';

// ── Mocks (same boilerplate as every other client test file) ──────────────────

vi.mock('../src/api/templates.ts', () => ({
  loadRoot: vi.fn(),
  batchSave: vi.fn(),
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  validateAll: vi.fn(),
}));

vi.mock('../src/stores/useUIStore.ts', () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      selectedTemplateTree: null,
      setSelectedTemplateTree: vi.fn(),
    })),
  },
}));

// ── Shared reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useTemplateGraphStore.setState({
    templateMap: new Map(),
    originalTemplateMap: new Map(),
    dirtySet: new Set(),
    hashes: new Map(),
    pendingDeletions: new Set(),
    rootTemplateName: null,
    isLoading: false,
    error: null,
    validationState: { messages: [], isValid: true },
  });
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeChildRef(templateName, assetName) {
  return { template_name: templateName, asset_name: assetName, fields: {} };
}

/**
 * Load a parent template (and its original snapshot) into the store.
 * Children: [{ template_name, asset_name, fields }]
 */
function preloadParent(name, children, hash = 'aabbcc') {
  const template = makeStruct(name, 'parameter', children);
  const entry = makeEntry(template, hash);
  useTemplateGraphStore.setState({
    templateMap: new Map([[name, entry]]),
    originalTemplateMap: new Map([[name, structuredClone(entry)]]),
    hashes: new Map([[name, hash]]),
  });
}

// ── reorderChild ─────────────────────────────────────────────────────────────

describe('reorderChild — move forward (index 0 → after index 2)', () => {
  it('child_a moves to the last position: [child_b, child_c, child_a]', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    // toIndex = 3 means "after the last element" (bottom of child at index 2)
    useTemplateGraphStore.getState().reorderChild('P', 0, 3);

    const result = useTemplateGraphStore.getState().templateMap.get('P').template.children;
    expect(result.map(c => c.asset_name)).toEqual(['child_b', 'child_c', 'child_a']);
  });

  it('adds parent to dirtySet', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    useTemplateGraphStore.getState().reorderChild('P', 0, 3);

    expect(useTemplateGraphStore.getState().dirtySet.has('P')).toBe(true);
  });
});

describe('reorderChild — move backward (index 2 → before index 0)', () => {
  it('child_c moves to the first position: [child_c, child_a, child_b]', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    // toIndex = 0 means "before the first element" (top of child at index 0)
    useTemplateGraphStore.getState().reorderChild('P', 2, 0);

    const result = useTemplateGraphStore.getState().templateMap.get('P').template.children;
    expect(result.map(c => c.asset_name)).toEqual(['child_c', 'child_a', 'child_b']);
  });
});

describe('reorderChild — no-op when fromIndex === toIndex', () => {
  it('children array is unchanged', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    // Same from and to — dropping a node on top of itself
    useTemplateGraphStore.getState().reorderChild('P', 1, 1);

    const result = useTemplateGraphStore.getState().templateMap.get('P').template.children;
    expect(result.map(c => c.asset_name)).toEqual(['child_a', 'child_b', 'child_c']);
  });

  it('does NOT add parent to dirtySet', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    useTemplateGraphStore.getState().reorderChild('P', 1, 1);

    expect(useTemplateGraphStore.getState().dirtySet.has('P')).toBe(false);
  });
});

// ── insertChild ───────────────────────────────────────────────────────────────

describe('insertChild — at index 1 in a 3-child parent', () => {
  it('new child lands at position 1: [child_a, NEW, child_b, child_c]', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    useTemplateGraphStore.getState().insertChild('P', makeChildRef('TN', 'NEW'), 1);

    const result = useTemplateGraphStore.getState().templateMap.get('P').template.children;
    expect(result.map(c => c.asset_name)).toEqual(['child_a', 'NEW', 'child_b', 'child_c']);
  });

  it('parent is marked dirty', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    useTemplateGraphStore.getState().insertChild('P', makeChildRef('TN', 'NEW'), 1);

    expect(useTemplateGraphStore.getState().dirtySet.has('P')).toBe(true);
  });
});

describe('insertChild — at index 0 (beginning)', () => {
  it('new child lands at position 0: [NEW, child_a, child_b, child_c]', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    useTemplateGraphStore.getState().insertChild('P', makeChildRef('TN', 'NEW'), 0);

    const result = useTemplateGraphStore.getState().templateMap.get('P').template.children;
    expect(result.map(c => c.asset_name)).toEqual(['NEW', 'child_a', 'child_b', 'child_c']);
  });
});

describe('insertChild — at children.length (end, same as append)', () => {
  it('new child lands at the last position: [child_a, child_b, child_c, NEW]', () => {
    const children = [
      makeChildRef('T1', 'child_a'),
      makeChildRef('T2', 'child_b'),
      makeChildRef('T3', 'child_c'),
    ];
    preloadParent('P', children);

    useTemplateGraphStore.getState().insertChild('P', makeChildRef('TN', 'NEW'), 3);

    const result = useTemplateGraphStore.getState().templateMap.get('P').template.children;
    expect(result.map(c => c.asset_name)).toEqual(['child_a', 'child_b', 'child_c', 'NEW']);
  });
});

// ── Reorder detection logic ───────────────────────────────────────────────────
//
// The detection lives in AppShell._buildDiffEnrichment (a private component
// function, not directly importable). Tests here verify the same algorithm as
// a pure function, establishing the expected behaviour contract and guarding
// regressions in the logic.

function detectReorder(originalChildren, currentChildren) {
  const currentSet  = new Set(currentChildren.map(c => c.asset_name));
  const originalSet = new Set(originalChildren.map(o => o.asset_name));

  const originalShared = originalChildren
    .filter(o => currentSet.has(o.asset_name))
    .map(o => o.asset_name);
  const currentShared = currentChildren
    .filter(c => originalSet.has(c.asset_name))
    .map(c => c.asset_name);

  return (
    originalShared.length > 1 &&
    originalShared.some((name, i) => name !== currentShared[i])
  );
}

describe('detectReorder — pure reorder (same children, different order)', () => {
  it('returns true when children are in a different order', () => {
    const original = [
      makeChildRef('T1', 'A'),
      makeChildRef('T2', 'B'),
      makeChildRef('T3', 'C'),
    ];
    const current = [
      makeChildRef('T3', 'C'),
      makeChildRef('T1', 'A'),
      makeChildRef('T2', 'B'),
    ];
    expect(detectReorder(original, current)).toBe(true);
  });
});

describe('detectReorder — pure add (child added, no positional change)', () => {
  it('returns false when children are in the same relative order', () => {
    const original = [
      makeChildRef('T1', 'A'),
      makeChildRef('T2', 'B'),
      makeChildRef('T3', 'C'),
    ];
    const current = [
      makeChildRef('T1', 'A'),
      makeChildRef('T2', 'B'),
      makeChildRef('T3', 'C'),
      makeChildRef('T4', 'D'),
    ];
    expect(detectReorder(original, current)).toBe(false);
  });
});

describe('detectReorder — single shared child guard (no false positive)', () => {
  it('returns false when only one child is shared after an add/remove', () => {
    // Original had A and B; B was removed and D was added.
    // Only A is shared. The guard (originalShared.length > 1) prevents a
    // false-positive reorder detection with a single element.
    const original = [
      makeChildRef('T1', 'A'),
      makeChildRef('T2', 'B'),
    ];
    const current = [
      makeChildRef('T1', 'A'),
      makeChildRef('T4', 'D'),
    ];
    expect(detectReorder(original, current)).toBe(false);
  });
});
