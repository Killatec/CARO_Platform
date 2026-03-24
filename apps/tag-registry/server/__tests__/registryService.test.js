import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@caro/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import { query } from '@caro/db';
import { getActiveRegistry, getRevisions, getRevisionTags } from '../src/services/registryService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getActiveRegistry ─────────────────────────────────────────────────────────

describe('getActiveRegistry', () => {
  it('calls query() once', async () => {
    query.mockResolvedValue({ rows: [] });
    await getActiveRegistry();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('SQL uses DISTINCT ON (tag_id)', async () => {
    query.mockResolvedValue({ rows: [] });
    await getActiveRegistry();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/DISTINCT ON \(tag_id\)/i);
  });

  it('SQL orders by tag_id, registry_rev DESC', async () => {
    query.mockResolvedValue({ rows: [] });
    await getActiveRegistry();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY tag_id, registry_rev DESC/i);
  });

  it('SQL filters WHERE retired = false on the latest row', async () => {
    query.mockResolvedValue({ rows: [] });
    await getActiveRegistry();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/retired = false/i);
  });

  it('returns rows from query result', async () => {
    const rows = [
      { tag_id: 1001, registry_rev: 1, tag_path: 'Plant1.Chan1.setpoint', data_type: 'f32', is_setpoint: true, retired: false, meta: [] },
    ];
    query.mockResolvedValue({ rows });
    const result = await getActiveRegistry();
    expect(result).toEqual(rows);
  });

  it('returns empty array when no active tags', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await getActiveRegistry();
    expect(result).toEqual([]);
  });

  it('throws when query fails', async () => {
    query.mockRejectedValue(new Error('db error'));
    await expect(getActiveRegistry()).rejects.toThrow('db error');
  });
});

// ── getRevisions ──────────────────────────────────────────────────────────────

describe('getRevisions', () => {
  it('calls query() once', async () => {
    query.mockResolvedValue({ rows: [] });
    await getRevisions();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('SQL queries registry_revisions ordered by registry_rev DESC', async () => {
    query.mockResolvedValue({ rows: [] });
    await getRevisions();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/registry_revisions/i);
    expect(sql).toMatch(/registry_rev DESC/i);
  });

  it('returns rows array', async () => {
    const rows = [
      { registry_rev: 2, applied_by: 'dev', applied_at: '2026-03-23T14:07:00Z', comment: 'second apply' },
      { registry_rev: 1, applied_by: 'dev', applied_at: '2026-03-22T10:00:00Z', comment: 'initial apply' },
    ];
    query.mockResolvedValue({ rows });
    const result = await getRevisions();
    expect(result).toEqual(rows);
  });

  it('returns empty array when no revisions exist', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await getRevisions();
    expect(result).toEqual([]);
  });

  it('throws when query fails', async () => {
    query.mockRejectedValue(new Error('db error'));
    await expect(getRevisions()).rejects.toThrow('db error');
  });
});

// ── getRevisionTags ───────────────────────────────────────────────────────────

describe('getRevisionTags', () => {
  it('calls query() with the revision number as parameter', async () => {
    query.mockResolvedValue({ rows: [] });
    await getRevisionTags(3);
    expect(query).toHaveBeenCalledWith(expect.any(String), [3]);
  });

  it('SQL queries tag_registry WHERE registry_rev = $1', async () => {
    query.mockResolvedValue({ rows: [] });
    await getRevisionTags(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/tag_registry/i);
    expect(sql).toMatch(/registry_rev\s*=\s*\$1/i);
  });

  it('SQL orders by tag_path ASC', async () => {
    query.mockResolvedValue({ rows: [] });
    await getRevisionTags(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY tag_path ASC/i);
  });

  it('returns rows when revision has tags', async () => {
    const rows = [
      { tag_id: 1001, registry_rev: 1, tag_path: 'Plant1.Chan1.setpoint', data_type: 'f32', is_setpoint: true, retired: false, meta: [] },
    ];
    query.mockResolvedValue({ rows });
    const result = await getRevisionTags(1);
    expect(result).toEqual(rows);
  });

  it('returns null when no rows found for revision', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await getRevisionTags(999);
    expect(result).toBeNull();
  });

  it('throws when query fails', async () => {
    query.mockRejectedValue(new Error('db error'));
    await expect(getRevisionTags(1)).rejects.toThrow('db error');
  });
});
