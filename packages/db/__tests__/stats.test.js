import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import timescalePool from '../timescalePool.ts';
import { getTimescaleDatabaseSizeBytes } from '../stats.ts';

beforeEach(() => {
  vi.spyOn(timescalePool, 'query');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Unit tests: getTimescaleDatabaseSizeBytes with a mocked pool ──────────────

describe('getTimescaleDatabaseSizeBytes — unit (mocked pool)', () => {
  it('returns a bigint parsed from the TEXT column', async () => {
    timescalePool.query.mockResolvedValueOnce({ rows: [{ size: '5000000000' }] });
    const result = await getTimescaleDatabaseSizeBytes();
    expect(result).toBe(5_000_000_000n);
  });

  it('calls pg_database_size(current_database()) cast to TEXT', async () => {
    timescalePool.query.mockResolvedValueOnce({ rows: [{ size: '1' }] });
    await getTimescaleDatabaseSizeBytes();
    const [sql] = timescalePool.query.mock.calls[0];
    expect(sql).toMatch(/pg_database_size\(current_database\(\)\)/);
    expect(sql).toMatch(/::TEXT/);
  });

  it('throws when the pool rejects', async () => {
    timescalePool.query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(getTimescaleDatabaseSizeBytes()).rejects.toThrow('connection refused');
  });
});

// ── Integration tests: require a live TimescaleDB ────────────────────────────
//
// Skipped entirely when TIMESCALE_HOST is not set so CI stays green.

const HAVE_TIMESCALE = !!process.env.TIMESCALE_HOST;

describe.skipIf(!HAVE_TIMESCALE)('getTimescaleDatabaseSizeBytes — integration (live TimescaleDB)', () => {
  afterAll(async () => {
    await timescalePool.end();
  });

  it('returns a positive bigint from a live database', async () => {
    const size = await getTimescaleDatabaseSizeBytes();
    expect(typeof size).toBe('bigint');
    expect(size).toBeGreaterThan(0n);
  });
});
