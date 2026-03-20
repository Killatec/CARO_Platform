import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTemplateGraphStore } from '../src/stores/useTemplateGraphStore.js';
import { useUIStore } from '../src/stores/useUIStore.js';
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

const saveSuccess = { requires_confirmation: false, modified_files: [], deleted_files: [] };

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

// ── Guards ────────────────────────────────────────────────────────────────────

describe('save — guards', () => {
  it('does not call batchSave when dirtySet and pendingDeletions are empty', async () => {
    await useTemplateGraphStore.getState().save(vi.fn());
    expect(templatesApi.batchSave).not.toHaveBeenCalled();
  });

  it('does not call batchSave when isValid is false', async () => {
    useTemplateGraphStore.setState({
      validationState: { isValid: false, messages: [] },
      dirtySet: new Set(['T']),
    });
    await useTemplateGraphStore.getState().save(vi.fn());
    expect(templatesApi.batchSave).not.toHaveBeenCalled();
  });
});

// ── Payload construction ──────────────────────────────────────────────────────

describe('save — changes payload', () => {
  it('builds correct changes array and calls batchSave with confirmed:false', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      originalTemplateMap: new Map([['T', structuredClone(entry)]]),
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(['T']),
      rootTemplateName: null,
    });

    templatesApi.batchSave.mockResolvedValue(saveSuccess);
    // _resetToIsolationMode will call templatesApi.loadRoot for the re-fetch
    // useUIStore.getState().selectedTemplateTree is null → isNewTemplate branch → just clears selection
    useUIStore.getState.mockReturnValue({
      selectedTemplateTree: null,
      setSelectedTemplateTree: vi.fn(),
    });

    await useTemplateGraphStore.getState().save(vi.fn());

    const [changes, deletions, confirmed] = templatesApi.batchSave.mock.calls[0];
    expect(changes).toEqual([{ template_name: 'T', original_hash: 'aabbcc', template: tag }]);
    expect(deletions).toEqual([]);
    expect(confirmed).toBe(false);
  });
});

describe('save — deletions payload', () => {
  it('builds correct deletions array from pendingDeletions', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map(), // already removed from templateMap by markForDeletion
      originalTemplateMap: new Map([['T', entry]]), // hash lives here
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(),
      pendingDeletions: new Set(['T']),
      rootTemplateName: null,
    });

    templatesApi.batchSave.mockResolvedValue(saveSuccess);
    useUIStore.getState.mockReturnValue({
      selectedTemplateTree: null,
      setSelectedTemplateTree: vi.fn(),
    });

    await useTemplateGraphStore.getState().save(vi.fn());

    const [changes, deletions] = templatesApi.batchSave.mock.calls[0];
    expect(changes).toEqual([]);
    expect(deletions).toEqual([{ template_name: 'T', original_hash: 'aabbcc' }]);
  });
});

// ── requires_confirmation ─────────────────────────────────────────────────────

describe('save — requires_confirmation', () => {
  it('calls onRequiresConfirmation with result and batch', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      originalTemplateMap: new Map([['T', structuredClone(entry)]]),
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(['T']),
    });

    const confirmationResult = { requires_confirmation: true, diff: {}, affectedParents: [] };
    templatesApi.batchSave.mockResolvedValue(confirmationResult);

    const onConf = vi.fn();
    await useTemplateGraphStore.getState().save(onConf);

    expect(onConf).toHaveBeenCalledOnce();
    const [result, batch] = onConf.mock.calls[0];
    expect(result.requires_confirmation).toBe(true);
    expect(batch).toHaveProperty('changes');
    expect(batch).toHaveProperty('deletions');
  });

  it('sets isLoading to false and does not reload', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      originalTemplateMap: new Map([['T', structuredClone(entry)]]),
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(['T']),
    });

    templatesApi.batchSave.mockResolvedValue({
      requires_confirmation: true, diff: {}, affectedParents: [],
    });

    await useTemplateGraphStore.getState().save(vi.fn());

    expect(useTemplateGraphStore.getState().isLoading).toBe(false);
    // loadRoot should not have been called (no reload after confirmation needed)
    expect(templatesApi.loadRoot).not.toHaveBeenCalled();
  });
});

// ── Success — rooted mode ─────────────────────────────────────────────────────

describe('save — success in rooted mode', () => {
  it('calls templatesApi.loadRoot with rootTemplateName after save', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      originalTemplateMap: new Map([['T', structuredClone(entry)]]),
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(['T']),
      rootTemplateName: 'myRoot',
    });

    templatesApi.batchSave.mockResolvedValue(saveSuccess);
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ myRoot: makeEntry(makeStruct('myRoot', 'module')) })
    );

    await useTemplateGraphStore.getState().save(vi.fn());

    expect(templatesApi.loadRoot).toHaveBeenCalledWith('myRoot');
  });
});

// ── Success — isolation mode ──────────────────────────────────────────────────

describe('save — success in isolation mode', () => {
  it('wipes store and calls templatesApi.loadRoot with selectedTemplateTree', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      originalTemplateMap: new Map([['T', structuredClone(entry)]]), // T exists → isNewTemplate=false
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(['T']),
      rootTemplateName: null,
    });

    templatesApi.batchSave.mockResolvedValue(saveSuccess);
    // Re-fetch returns empty templates so templateMap stays empty after inject
    templatesApi.loadRoot.mockResolvedValue({ root_template_name: 'T', templates: {} });

    useUIStore.getState.mockReturnValue({
      selectedTemplateTree: 'T',
      setSelectedTemplateTree: vi.fn(),
    });

    await useTemplateGraphStore.getState().save(vi.fn());

    expect(templatesApi.loadRoot).toHaveBeenCalledWith('T');
    expect(useTemplateGraphStore.getState().templateMap.size).toBe(0);
  });
});

// ── confirmSave ───────────────────────────────────────────────────────────────

describe('confirmSave', () => {
  it('calls batchSave with confirmed:true', async () => {
    useTemplateGraphStore.setState({ rootTemplateName: 'root' });

    templatesApi.batchSave.mockResolvedValue(saveSuccess);
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ root: makeEntry(makeStruct('root', 'module')) })
    );

    const changes = [{ template_name: 'T', original_hash: 'aabbcc', template: makeTag('T') }];
    await useTemplateGraphStore.getState().confirmSave({ changes, deletions: [] });

    const [, , confirmed] = templatesApi.batchSave.mock.calls[0];
    expect(confirmed).toBe(true);
  });
});

// ── discard ───────────────────────────────────────────────────────────────────

describe('discard — rooted mode', () => {
  it('calls templatesApi.loadRoot with rootTemplateName', async () => {
    useTemplateGraphStore.setState({ rootTemplateName: 'root' });
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ root: makeEntry(makeStruct('root', 'module')) })
    );

    await useTemplateGraphStore.getState().discard();

    expect(templatesApi.loadRoot).toHaveBeenCalledWith('root');
  });
});

describe('discard — isolation mode', () => {
  it('wipes templateMap, dirtySet, pendingDeletions', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag);
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      dirtySet: new Set(['T']),
      pendingDeletions: new Set(),
      rootTemplateName: null,
    });

    useUIStore.getState.mockReturnValue({
      selectedTemplateTree: null,
      setSelectedTemplateTree: vi.fn(),
    });

    await useTemplateGraphStore.getState().discard();

    const state = useTemplateGraphStore.getState();
    expect(state.templateMap.size).toBe(0);
    expect(state.dirtySet.size).toBe(0);
    expect(state.pendingDeletions.size).toBe(0);
  });
});

// ── STALE_TEMPLATE ────────────────────────────────────────────────────────────

describe('save — STALE_TEMPLATE error', () => {
  it('reloads from server and sets stale error message', async () => {
    const tag = makeTag('T');
    const entry = makeEntry(tag, 'aabbcc');
    useTemplateGraphStore.setState({
      templateMap: new Map([['T', entry]]),
      originalTemplateMap: new Map([['T', structuredClone(entry)]]),
      hashes: new Map([['T', 'aabbcc']]),
      dirtySet: new Set(['T']),
      rootTemplateName: 'root',
    });

    const staleErr = new Error('stale');
    staleErr.code = 'STALE_TEMPLATE';
    templatesApi.batchSave.mockRejectedValue(staleErr);
    templatesApi.loadRoot.mockResolvedValue(
      makeLoadRootResponse({ root: makeEntry(makeStruct('root', 'module')) })
    );

    await useTemplateGraphStore.getState().save(vi.fn());

    expect(templatesApi.loadRoot).toHaveBeenCalledWith('root');
    expect(useTemplateGraphStore.getState().error).toContain('modified by another user');
  });
});
