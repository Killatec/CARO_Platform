import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@caro/db', () => ({
  getActiveTags: vi.fn(),
  getRevisions: vi.fn(),
  getRevisionTags: vi.fn(),
  applyRegistryRevision: vi.fn(),
}));

import { getActiveTags } from '@caro/db';
import { getActiveRegistry, getRevisions, getRevisionTags } from '../src/services/registryService.ts';

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
