import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTemplateGraphStore } from '../src/stores/useTemplateGraphStore.js';
import { makeTag, makeStruct, makeEntry } from './fixtures.js';

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

// Convenience: pre-load one template into both maps
function preload(template, hash = 'aabbcc') {
  const entry = makeEntry(template, hash);
  useTemplateGraphStore.setState({
    templateMap: new Map([[template.template_name, entry]]),
    originalTemplateMap: new Map([[template.template_name, structuredClone(entry)]]),
    hashes: new Map([[template.template_name, hash]]),
  });
}

describe('updateTemplate — basic update', () => {
  it('updates the template field in templateMap', () => {
    const tag = makeTag('T', { eng_min: { field_type: 'Numeric', default: 0 } });
    preload(tag);

    useTemplateGraphStore.getState().updateTemplate('T', {
      fields: { eng_min: { field_type: 'Numeric', default: 99 } },
    });

    const updated = useTemplateGraphStore.getState().templateMap.get('T').template;
    expect(updated.fields.eng_min.default).toBe(99);
  });
});

describe('updateTemplate — dirtySet', () => {
  it('adds to dirtySet when template changes from baseline', () => {
    const tag = makeTag('T', { eng_min: { field_type: 'Numeric', default: 0 } });
    preload(tag);

    useTemplateGraphStore.getState().updateTemplate('T', {
      fields: { eng_min: { field_type: 'Numeric', default: 99 } },
    });

    expect(useTemplateGraphStore.getState().dirtySet.has('T')).toBe(true);
  });

  it('removes from dirtySet when template reverted to baseline', () => {
    const originalFields = { eng_min: { field_type: 'Numeric', default: 0 } };
    const tag = makeTag('T', originalFields);
    preload(tag);

    // First make it dirty
    useTemplateGraphStore.setState({
      dirtySet: new Set(['T']),
    });

    // Revert to exactly the original value
    useTemplateGraphStore.getState().updateTemplate('T', { fields: originalFields });

    expect(useTemplateGraphStore.getState().dirtySet.has('T')).toBe(false);
  });

  it('always dirty when no originalTemplateMap entry (new unsaved template)', () => {
    const tag = makeTag('T');
    // Put in templateMap but NOT in originalTemplateMap
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', makeEntry(tag)]]),
      originalTemplateMap: new Map(), // no baseline
    });

    useTemplateGraphStore.getState().updateTemplate('T', { data_type: 'i32' });

    expect(useTemplateGraphStore.getState().dirtySet.has('T')).toBe(true);
  });
});

describe('updateTemplate — early return', () => {
  it('no state change when template_name not in templateMap', () => {
    useTemplateGraphStore.getState().updateTemplate('nonexistent', { fields: {} });

    const state = useTemplateGraphStore.getState();
    expect(state.templateMap.size).toBe(0);
    expect(state.dirtySet.size).toBe(0);
  });
});

describe('updateTemplate — applyFieldCascade', () => {
  it("removes stale child field override when field is dropped from tag", () => {
    const tag = makeTag('T', { eng_min: { field_type: 'Numeric', default: 0 } });
    const param = makeStruct('P', 'parameter', [
      { template_name: 'T', asset_name: 'ch', fields: { eng_min: 5 } },
    ]);

    // Load both templates with baselines
    useTemplateGraphStore.setState({
      templateMap: new Map([
        ['T', makeEntry(tag)],
        ['P', makeEntry(param, 'hashP')],
      ]),
      originalTemplateMap: new Map([
        ['T', structuredClone(makeEntry(tag))],
        ['P', structuredClone(makeEntry(param, 'hashP'))],
      ]),
      hashes: new Map([['T', 'aabbcc'], ['P', 'hashP']]),
    });

    // Remove eng_min from T
    useTemplateGraphStore.getState().updateTemplate('T', { fields: {} });

    const pEntry = useTemplateGraphStore.getState().templateMap.get('P');
    const tChild = pEntry.template.children.find(c => c.template_name === 'T');
    // eng_min override should have been dropped by cascade
    expect(tChild.fields).toEqual({});
  });
});
