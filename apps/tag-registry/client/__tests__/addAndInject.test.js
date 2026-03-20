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

// ── addTemplate ───────────────────────────────────────────────────────────────

describe('addTemplate — null existingHash', () => {
  it('adds entry to templateMap', () => {
    useTemplateGraphStore.getState().addTemplate(makeTag('newTag'), null);
    expect(useTemplateGraphStore.getState().templateMap.has('newTag')).toBe(true);
  });

  it('hashes entry is null (not set when existingHash is falsy)', () => {
    useTemplateGraphStore.getState().addTemplate(makeTag('newTag'), null);
    // existingHash is null → newHashes.set is skipped
    expect(useTemplateGraphStore.getState().hashes.get('newTag')).toBeUndefined();
  });

  it('adds to dirtySet unconditionally', () => {
    useTemplateGraphStore.getState().addTemplate(makeTag('newTag'), null);
    expect(useTemplateGraphStore.getState().dirtySet.has('newTag')).toBe(true);
  });
});

describe('addTemplate — with existingHash', () => {
  it('stores existingHash in hashes map', () => {
    useTemplateGraphStore.getState().addTemplate(makeTag('savedTag'), 'ff1234');
    expect(useTemplateGraphStore.getState().hashes.get('savedTag')).toBe('ff1234');
  });

  it('still adds to dirtySet regardless of hash', () => {
    useTemplateGraphStore.getState().addTemplate(makeTag('savedTag'), 'ff1234');
    expect(useTemplateGraphStore.getState().dirtySet.has('savedTag')).toBe(true);
  });
});

// ── injectTemplateGraph ───────────────────────────────────────────────────────

describe('injectTemplateGraph — adds new entries', () => {
  it('adds to templateMap', () => {
    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: makeTag('T'), hash: 'aabbcc' },
    });
    expect(useTemplateGraphStore.getState().templateMap.has('T')).toBe(true);
  });

  it('adds to originalTemplateMap', () => {
    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: makeTag('T'), hash: 'aabbcc' },
    });
    expect(useTemplateGraphStore.getState().originalTemplateMap.has('T')).toBe(true);
  });

  it('adds to hashes', () => {
    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: makeTag('T'), hash: 'aabbcc' },
    });
    expect(useTemplateGraphStore.getState().hashes.has('T')).toBe(true);
  });
});

describe('injectTemplateGraph — never overwrites existing templateMap entry', () => {
  it('existing templateMap entry preserved when same name injected', () => {
    const originalTag = makeTag('T');
    originalTag.data_type = 'i32'; // distinctive value
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', { template: originalTag, hash: 'aabbcc' }]]),
    });

    const differentTag = makeTag('T');
    differentTag.data_type = 'bool';
    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: differentTag, hash: 'ddeeff' },
    });

    const entry = useTemplateGraphStore.getState().templateMap.get('T');
    expect(entry.hash).toBe('aabbcc');
    expect(entry.template.data_type).toBe('i32');
  });
});

describe('injectTemplateGraph — never overwrites existing originalTemplateMap entry', () => {
  it('existing originalTemplateMap entry preserved when same name injected', () => {
    const originalTag = makeTag('T');
    originalTag.data_type = 'i32';
    useTemplateGraphStore.setState({
      originalTemplateMap: new Map([['T', { template: originalTag, hash: 'aabbcc' }]]),
    });

    const differentTag = makeTag('T');
    differentTag.data_type = 'bool';
    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: differentTag, hash: 'ddeeff' },
    });

    const origEntry = useTemplateGraphStore.getState().originalTemplateMap.get('T');
    expect(origEntry.template.data_type).toBe('i32');
  });
});

describe('injectTemplateGraph — does not touch dirtySet', () => {
  it('preserves pre-existing dirtySet entries', () => {
    useTemplateGraphStore.setState({
      dirtySet: new Set(['pre_existing_dirty']),
    });

    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: makeTag('T'), hash: 'aabbcc' },
    });

    expect(useTemplateGraphStore.getState().dirtySet.has('pre_existing_dirty')).toBe(true);
    expect(useTemplateGraphStore.getState().dirtySet.has('T')).toBe(false);
  });
});

describe('injectTemplateGraph — structuredClone in originalTemplateMap', () => {
  it('mutation of the injected object does not affect originalTemplateMap entry', () => {
    const tag = makeTag('T');
    useTemplateGraphStore.getState().injectTemplateGraph({
      T: { template: tag, hash: 'xx' },
    });

    // Mutate the original reference after injection
    tag.data_type = 'MUTATED';

    const stored = useTemplateGraphStore.getState().originalTemplateMap.get('T');
    expect(stored.template.data_type).toBe('f64');
  });
});
