import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import timescalePool from '../timescalePool.ts';
import { pingTimescale, writeTagSamples } from '../samples.ts';

// Spy on pool methods so unit tests can control responses without a top-level
// vi.mock that would also clobber the integration describe block.
beforeEach(() => {
  vi.spyOn(timescalePool, 'query');
  vi.spyOn(timescalePool, 'connect');
  vi.spyOn(timescalePool, 'end');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Unit tests: pingTimescale with a mocked pool ──────────────────────────────

describe('pingTimescale — unit (mocked pool)', () => {
  it('resolves when SELECT 1 succeeds', async () => {
    timescalePool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    await expect(pingTimescale()).resolves.toBeUndefined();
    expect(timescalePool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('throws when the pool rejects', async () => {
    timescalePool.query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(pingTimescale()).rejects.toThrow('connection refused');
  });
});

describe('writeTagSamples — unit (mocked pool)', () => {
  it('no-ops on empty array without calling the pool', async () => {
    await writeTagSamples([]);
    expect(timescalePool.query).not.toHaveBeenCalled();
  });

  it('calls INSERT with three unnest arrays', async () => {
    timescalePool.query.mockResolvedValueOnce({ rows: [] });

    const rows = [
      { ts: 1_700_000_000_000, tagId: 1, value: 42.5 },
      { ts: 1_700_000_001_000, tagId: 2, value: null },
    ];
    await writeTagSamples(rows);

    expect(timescalePool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = timescalePool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tag_samples/);
    expect(sql).toMatch(/unnest\(\$1::bigint\[\]/);
    expect(params[0]).toEqual([BigInt(1_700_000_000_000), BigInt(1_700_000_001_000)]);
    expect(params[1]).toEqual([1, 2]);
    expect(params[2]).toEqual([42.5, null]);
  });
});

// ── Integration tests: require a live TimescaleDB ────────────────────────────
//
// Skipped entirely when TIMESCALE_HOST is not set so CI stays green.

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

describe.skipIf(!HAVE_TIMESCALE)('samples — integration (live TimescaleDB)', () => {
  afterAll(async () => {
    await timescalePool.end();
  });

  it('pingTimescale resolves against live DB', async () => {
    await expect(pingTimescale()).resolves.toBeUndefined();
  });

  it('writeTagSamples inserts 10 rows and they are readable', async () => {
    const baseTs = Date.now();
    const rows = Array.from({ length: 10 }, (_, i) => ({
      ts:    baseTs + i * 1000,
      tagId: 9999,
      value: i * 1.5,
    }));

    await writeTagSamples(rows);

    const result = await timescalePool.query(
      `SELECT count(*)::int AS cnt
       FROM tag_samples
       WHERE tag_id = 9999
         AND ts >= to_timestamp($1 / 1000.0)
         AND ts <= to_timestamp($2 / 1000.0)`,
      [baseTs, baseTs + 9000]
    );

    expect(result.rows[0].cnt).toBe(10);

    await timescalePool.query(
      `DELETE FROM tag_samples
       WHERE tag_id = 9999
         AND ts >= to_timestamp($1 / 1000.0)`,
      [baseTs]
    );
  });
});
