import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTemplateGraphStore } from '../src/stores/useTemplateGraphStore.js';
import { makeTag, makeEntry } from './fixtures.js';

vi.mock('../src/api/templates.js', () => ({
  loadRoot: vi.fn(),
  batchSave: vi.fn(),
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  validateAll: vi.fn(),
}));

vi.mock('../src/stores/useUIStore.js', () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      selectedTemplateTree: null,
      setSelectedTemplateTree: vi.fn(),
    })),
  },
}));

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

function preloadAll(name, hash = 'aabbcc') {
  const tag = makeTag(name);
  const entry = makeEntry(tag, hash);
  useTemplateGraphStore.setState({
    templateMap: new Map([[name, entry]]),
    originalTemplateMap: new Map([[name, structuredClone(entry)]]),
    hashes: new Map([[name, hash]]),
    dirtySet: new Set([name]),
    pendingDeletions: new Set(),
  });
}

// ── markForDeletion ───────────────────────────────────────────────────────────

describe('markForDeletion — removes from templateMap', () => {
  it('entry is gone from templateMap after mark', () => {
    preloadAll('T');
    useTemplateGraphStore.getState().markForDeletion('T');
    expect(useTemplateGraphStore.getState().templateMap.has('T')).toBe(false);
  });
});

describe('markForDeletion — removes from dirtySet', () => {
  it('T removed from dirtySet', () => {
    preloadAll('T');
    useTemplateGraphStore.getState().markForDeletion('T');
    expect(useTemplateGraphStore.getState().dirtySet.has('T')).toBe(false);
  });
});

describe('markForDeletion — adds to pendingDeletions', () => {
  it('T added to pendingDeletions', () => {
    preloadAll('T');
    useTemplateGraphStore.getState().markForDeletion('T');
    expect(useTemplateGraphStore.getState().pendingDeletions.has('T')).toBe(true);
  });
});

describe('markForDeletion — preserves originalTemplateMap and hashes', () => {
  it('originalTemplateMap retains T (needed for original_hash in save payload)', () => {
    preloadAll('T');
    useTemplateGraphStore.getState().markForDeletion('T');
    expect(useTemplateGraphStore.getState().originalTemplateMap.has('T')).toBe(true);
  });

  it('hashes retains T (needed for batch save payload)', () => {
    preloadAll('T');
    useTemplateGraphStore.getState().markForDeletion('T');
    expect(useTemplateGraphStore.getState().hashes.has('T')).toBe(true);
  });
});

// ── removeTemplate ────────────────────────────────────────────────────────────

describe('removeTemplate — removes from all five maps', () => {
  it('T is gone from all five maps after remove', () => {
    preloadAll('T');
    // Also put in pendingDeletions to cover that path
    useTemplateGraphStore.setState({
      pendingDeletions: new Set(['T']),
    });

    useTemplateGraphStore.getState().removeTemplate('T');
    const state = useTemplateGraphStore.getState();

    expect(state.templateMap.has('T')).toBe(false);
    expect(state.originalTemplateMap.has('T')).toBe(false);
    expect(state.hashes.has('T')).toBe(false);
    expect(state.dirtySet.has('T')).toBe(false);
    expect(state.pendingDeletions.has('T')).toBe(false);
  });
});

describe('removeTemplate — safe on nonexistent name', () => {
  it('does not throw and state is unchanged', () => {
    expect(() => {
      useTemplateGraphStore.getState().removeTemplate('does_not_exist');
    }).not.toThrow();

    const state = useTemplateGraphStore.getState();
    expect(state.templateMap.size).toBe(0);
    expect(state.dirtySet.size).toBe(0);
  });
});
