import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../query.ts', () => ({
  query: vi.fn(),
}));

import { query } from '../query.ts';
import { upsertCommandedSetpoints, getCommandedSetpointsByTagIds } from '../setpoints.ts';

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rows: [] });
});

describe('upsertCommandedSetpoints', () => {
  it('no-ops on an empty array without querying', async () => {
    await upsertCommandedSetpoints([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('upserts value and ack_status with three params per entry', async () => {
    await upsertCommandedSetpoints([
      { tag_id: 1001, value: 42.5, ack_status: 'accepted' },
      { tag_id: 1002, value: true, ack_status: 'timeout' },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO commanded_setpoints \(tag_id, value, ack_status\)/);
    expect(sql).toMatch(/\(\$1::int, \$2::jsonb, \$3::varchar\), \(\$4::int, \$5::jsonb, \$6::varchar\)/);
    expect(sql).toMatch(/ON CONFLICT \(tag_id\) DO UPDATE/);
    expect(sql).toMatch(/ack_status = EXCLUDED\.ack_status/);
    expect(sql).toMatch(/set_at\s+= now\(\)/);
    expect(params).toEqual([1001, '42.5', 'accepted', 1002, 'true', 'timeout']);
  });

  it('stores an unpopulated Set as SQL NULL, not JSON null', async () => {
    await upsertCommandedSetpoints([{ tag_id: 1001, value: null, ack_status: 'accepted' }]);

    const [, params] = query.mock.calls[0];
    expect(params).toEqual([1001, null, 'accepted']);
  });

  it('keeps only the last entry for a repeated tag_id', async () => {
    await upsertCommandedSetpoints([
      { tag_id: 1001, value: 1, ack_status: 'timeout' },
      { tag_id: 1002, value: 2, ack_status: 'accepted' },
      { tag_id: 1001, value: 3, ack_status: 'accepted' },
    ]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/\$7/);
    expect(params).toEqual([1001, '3', 'accepted', 1002, '2', 'accepted']);
  });

  it('propagates a query failure to the caller', async () => {
    query.mockRejectedValueOnce(new Error('relation "commanded_setpoints" does not exist'));
    await expect(
      upsertCommandedSetpoints([{ tag_id: 1001, value: 1, ack_status: 'accepted' }]),
    ).rejects.toThrow('commanded_setpoints');
  });
});

describe('getCommandedSetpointsByTagIds', () => {
  it('returns [] for an empty list without querying', async () => {
    await expect(getCommandedSetpointsByTagIds([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('selects by tag_id array and returns the rows as given', async () => {
    const setAt = new Date('2026-10-18T10:00:00Z');
    const rows = [
      { tag_id: 1001, value: 42.5, ack_status: 'accepted', set_at: setAt },
      { tag_id: 1002, value: null, ack_status: 'timeout',  set_at: setAt },
    ];
    query.mockResolvedValueOnce({ rows });

    const result = await getCommandedSetpointsByTagIds([1001, 1002, 1003]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SELECT tag_id, value, ack_status, set_at\s+FROM commanded_setpoints/);
    expect(sql).toMatch(/WHERE tag_id = ANY\(\$1::int\[\]\)/);
    expect(params).toEqual([[1001, 1002, 1003]]);
    expect(result).toEqual(rows);
  });
});
