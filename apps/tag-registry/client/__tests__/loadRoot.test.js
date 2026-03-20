import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTemplateGraphStore } from '../src/stores/useTemplateGraphStore.js';
import { makeTag, makeStruct, makeEntry, makeLoadRootResponse } from './fixtures.js';

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

import * as templatesApi from '../src/api/templates.js';

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

describe('loadRoot — resolves successfully', () => {
  it('sets isLoading to false after resolve', async () => {
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ myTag: makeEntry(makeTag('myTag')) })
    );
    await useTemplateGraphStore.getState().loadRoot('myTag');
    expect(useTemplateGraphStore.getState().isLoading).toBe(false);
  });

  it('sets rootTemplateName', async () => {
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ myTag: makeEntry(makeTag('myTag')) })
    );
    await useTemplateGraphStore.getState().loadRoot('myTag');
    expect(useTemplateGraphStore.getState().rootTemplateName).toBe('myTag');
  });

  it('populates templateMap', async () => {
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ myTag: makeEntry(makeTag('myTag')) })
    );
    await useTemplateGraphStore.getState().loadRoot('myTag');
    expect(useTemplateGraphStore.getState().templateMap.has('myTag')).toBe(true);
  });

  it('populates hashes', async () => {
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ myTag: makeEntry(makeTag('myTag'), 'hash001') })
    );
    await useTemplateGraphStore.getState().loadRoot('myTag');
    expect(useTemplateGraphStore.getState().hashes.has('myTag')).toBe(true);
  });
});

describe('loadRoot — populates both maps', () => {
  it('loads multiple templates into templateMap and hashes', async () => {
    const tag = makeTag('T');
    const param = makeStruct('P');
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({
        P: makeEntry(param, 'hash-p'),
        T: makeEntry(tag, 'hash-t'),
      })
    );
    await useTemplateGraphStore.getState().loadRoot('P');
    const state = useTemplateGraphStore.getState();
    expect(state.templateMap.has('P')).toBe(true);
    expect(state.templateMap.has('T')).toBe(true);
    expect(state.hashes.has('P')).toBe(true);
    expect(state.hashes.has('T')).toBe(true);
  });
});

describe('loadRoot — originalTemplateMap is a deep clone', () => {
  it('mutation to templateMap does not affect originalTemplateMap', async () => {
    const tag = makeTag('T');
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ T: makeEntry(tag, 'hash-t') })
    );
    await useTemplateGraphStore.getState().loadRoot('T');

    const state = useTemplateGraphStore.getState();
    // Directly mutate the templateMap entry's template
    state.templateMap.get('T').template.data_type = 'i32';

    // originalTemplateMap should still have the original value
    expect(state.originalTemplateMap.get('T').template.data_type).toBe('f64');
  });
});

describe('loadRoot — clears dirty state', () => {
  it('clears dirtySet and pendingDeletions', async () => {
    // Pre-set dirty state
    useTemplateGraphStore.setState({
      dirtySet: new Set(['old_dirty']),
      pendingDeletions: new Set(['old_pending']),
    });

    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ T: makeEntry(makeTag('T')) })
    );
    await useTemplateGraphStore.getState().loadRoot('T');

    const state = useTemplateGraphStore.getState();
    expect(state.dirtySet.size).toBe(0);
    expect(state.pendingDeletions.size).toBe(0);
  });
});

describe('loadRoot — error handling', () => {
  it('sets error and clears isLoading on rejection', async () => {
    templatesApi.loadRoot.mockRejectedValue(new Error('Network error'));
    await useTemplateGraphStore.getState().loadRoot('T');

    const state = useTemplateGraphStore.getState();
    expect(state.error).toBe('Network error');
    expect(state.isLoading).toBe(false);
  });

  it('templateMap remains empty after error', async () => {
    templatesApi.loadRoot.mockRejectedValue(new Error('fail'));
    await useTemplateGraphStore.getState().loadRoot('T');

    expect(useTemplateGraphStore.getState().templateMap.size).toBe(0);
  });
});

describe('loadRoot — null name', () => {
  it('does not throw, rootTemplateName remains null', async () => {
    // Mock returns undefined for null input (like the real API null guard)
    templatesApi.loadRoot.mockResolvedValue(undefined);
    // The store tries data.templates on undefined → caught internally
    await useTemplateGraphStore.getState().loadRoot(null);
    expect(useTemplateGraphStore.getState().rootTemplateName).toBe(null);
  });
});
