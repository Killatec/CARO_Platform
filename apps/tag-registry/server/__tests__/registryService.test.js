import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@caro/db', () => ({
  getActiveTags: vi.fn(),
  getRevisions: vi.fn(),
  getRevisionTags: vi.fn(),
  applyRegistryRevision: vi.fn(),
}));

import { getActiveTags, applyRegistryRevision } from '@caro/db';
import { getActiveRegistry, getRevisions, getRevisionTags, applyRegistry } from '../src/services/registryService.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getActiveRegistry ─────────────────────────────────────────────────────────

describe('getActiveRegistry', () => {
  it('calls getActiveTags() once', async () => {
    getActiveTags.mockResolvedValue([]);
    await getActiveRegistry();
    expect(getActiveTags).toHaveBeenCalledTimes(1);
  });

  it('returns the result from getActiveTags', async () => {
    const rows = [
      { tag_id: 1001, registry_rev: 1, tag_path: 'Plant1.Chan1.setpoint', data_type: 'f32', is_setpoint: true, trends: false, retired: false, meta: [] },
    ];
    getActiveTags.mockResolvedValue(rows);
    const result = await getActiveRegistry();
    expect(result).toEqual(rows);
  });

  it('returns empty array when no active tags', async () => {
    getActiveTags.mockResolvedValue([]);
    const result = await getActiveRegistry();
    expect(result).toEqual([]);
  });

  it('throws when getActiveTags fails', async () => {
    getActiveTags.mockRejectedValue(new Error('db error'));
    await expect(getActiveRegistry()).rejects.toThrow('db error');
  });
});

// ── getRevisions ──────────────────────────────────────────────────────────────

describe('getRevisions', () => {
  it('calls getRevisions once', async () => {
    getRevisions.mockResolvedValue([]);
    await getRevisions();
    expect(getRevisions).toHaveBeenCalledTimes(1);
  });

  it('returns rows array', async () => {
    const rows = [
      { registry_rev: 2, applied_by: 'dev', applied_at: '2026-03-23T14:07:00Z', comment: 'second apply' },
      { registry_rev: 1, applied_by: 'dev', applied_at: '2026-03-22T10:00:00Z', comment: 'initial apply' },
    ];
    getRevisions.mockResolvedValue(rows);
    const result = await getRevisions();
    expect(result).toEqual(rows);
  });

  it('returns empty array when no revisions exist', async () => {
    getRevisions.mockResolvedValue([]);
    const result = await getRevisions();
    expect(result).toEqual([]);
  });

  it('throws when getRevisions fails', async () => {
    getRevisions.mockRejectedValue(new Error('db error'));
    await expect(getRevisions()).rejects.toThrow('db error');
  });
});

// ── getRevisionTags ───────────────────────────────────────────────────────────

describe('getRevisionTags', () => {
  it('calls getRevisionTags with the revision number', async () => {
    getRevisionTags.mockResolvedValue([]);
    await getRevisionTags(3);
    expect(getRevisionTags).toHaveBeenCalledWith(3);
  });

  it('returns rows when revision has tags', async () => {
    const rows = [
      { tag_id: 1001, registry_rev: 1, tag_path: 'Plant1.Chan1.setpoint', data_type: 'f32', is_setpoint: true, trends: false, retired: false, meta: [] },
    ];
    getRevisionTags.mockResolvedValue(rows);
    const result = await getRevisionTags(1);
    expect(result).toEqual(rows);
  });

  it('returns null when no rows found for revision', async () => {
    getRevisionTags.mockResolvedValue(null);
    const result = await getRevisionTags(999);
    expect(result).toBeNull();
  });

  it('throws when getRevisionTags fails', async () => {
    getRevisionTags.mockRejectedValue(new Error('db error'));
    await expect(getRevisionTags(1)).rejects.toThrow('db error');
  });
});

// ── applyRegistry — resolved-tag validation gate ──────────────────────────────

// A minimal template map that resolves to an illegal tag:
// parent overrides data_type → f32[], while the tag template defaults Trends → true.
function makeIllegalTrendsMap() {
  const tagTemplate = {
    template_name: 'TheTag',
    template_type: 'tag',
    fields: {
      data_type:   { field_type: 'TagType',  default: 'f32' },
      Trends:      { field_type: 'Boolean',  default: true  },
      is_setpoint: { field_type: 'Boolean',  default: false },
    },
    children: [],
  };
  const sysTemplate = {
    template_name: 'SYS',
    template_type: 'system',
    fields: {},
    children: [{ template_name: 'TheTag', asset_name: 'Tag1', fields: { data_type: 'f32[]' } }],
  };
  return new Map([['SYS', sysTemplate], ['TheTag', tagTemplate]]);
}

function makeIllegalSetpointMap() {
  const tagTemplate = {
    template_name: 'SPTag',
    template_type: 'tag',
    fields: {
      data_type:   { field_type: 'TagType',  default: 'f32' },
      Trends:      { field_type: 'Boolean',  default: false },
      is_setpoint: { field_type: 'Boolean',  default: true  },
    },
    children: [],
  };
  const sysTemplate = {
    template_name: 'SYS2',
    template_type: 'system',
    fields: {},
    children: [{ template_name: 'SPTag', asset_name: 'SP1', fields: { data_type: 'i16[]' } }],
  };
  return new Map([['SYS2', sysTemplate], ['SPTag', tagTemplate]]);
}

function makeValidMap() {
  const tagTemplate = {
    template_name: 'GoodTag',
    template_type: 'tag',
    fields: {
      data_type:   { field_type: 'TagType',  default: 'f32' },
      Trends:      { field_type: 'Boolean',  default: true  },
      is_setpoint: { field_type: 'Boolean',  default: false },
    },
    children: [],
  };
  const sysTemplate = {
    template_name: 'GOOD_SYS',
    template_type: 'system',
    fields: {},
    children: [{ template_name: 'GoodTag', asset_name: 'T1', fields: {} }],
  };
  return new Map([['GOOD_SYS', sysTemplate], ['GoodTag', tagTemplate]]);
}

describe('applyRegistry — resolved-tag validation gate', () => {
  it('throws before any DB write when a resolved tag has trends:true on f32[]', async () => {
    const templateMap = makeIllegalTrendsMap();
    await expect(applyRegistry(templateMap, 'SYS', 'test')).rejects.toThrow();
    expect(applyRegistryRevision).not.toHaveBeenCalled();
  });

  it('throws before any DB write when a resolved tag has is_setpoint:true on i16[]', async () => {
    const templateMap = makeIllegalSetpointMap();
    await expect(applyRegistry(templateMap, 'SYS2', 'test')).rejects.toThrow();
    expect(applyRegistryRevision).not.toHaveBeenCalled();
  });

  it('error code is SCHEMA_VALIDATION_ERROR', async () => {
    const templateMap = makeIllegalTrendsMap();
    let caught;
    try { await applyRegistry(templateMap, 'SYS', 'test'); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('SCHEMA_VALIDATION_ERROR');
  });

  it('error details includes the offending tag_path', async () => {
    const templateMap = makeIllegalTrendsMap();
    let caught;
    try { await applyRegistry(templateMap, 'SYS', 'test'); } catch (e) { caught = e; }
    expect(caught.details).toBeDefined();
    expect(Array.isArray(caught.details)).toBe(true);
    expect(caught.details.some(e => e.ref?.tag_path === 'SYS.Tag1')).toBe(true);
  });

  it('getActiveTags is never called when resolved-tag validation fails', async () => {
    const templateMap = makeIllegalTrendsMap();
    try { await applyRegistry(templateMap, 'SYS', 'test'); } catch (_) { /* expected */ }
    expect(getActiveTags).not.toHaveBeenCalled();
  });

  it('valid template map proceeds to DB write', async () => {
    getActiveTags.mockResolvedValue([]);
    applyRegistryRevision.mockResolvedValue({ registry_rev: 1, added: 1, modified: 0, retired: 0 });
    const templateMap = makeValidMap();
    const result = await applyRegistry(templateMap, 'GOOD_SYS', 'valid commit');
    expect(applyRegistryRevision).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});
