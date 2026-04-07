import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pool.ts', () => ({
  default: {
    connect: vi.fn(),
    query:   vi.fn(),
    end:     vi.fn(),
  },
}));

import pool from '../pool.ts';
import { withTransaction } from '../query.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. Happy path ─────────────────────────────────────────────────────────────

describe('withTransaction — happy path', () => {
  it('calls BEGIN, fn, COMMIT in order and resolves with fn return value', async () => {
    const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
    pool.connect.mockResolvedValue(client);

    const fnResult = { data: 42 };
    const fn = vi.fn().mockResolvedValue(fnResult);

    const result = await withTransaction(fn);

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(fn).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(result).toBe(fnResult);
  });
});

// ── 2. fn throws — rollback succeeds ─────────────────────────────────────────

describe('withTransaction — fn throws, ROLLBACK succeeds', () => {
  it('calls ROLLBACK, releases client, and rejects with the original error', async () => {
    const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
    pool.connect.mockResolvedValue(client);

    const fnError = new Error('fn failed');
    const fn = vi.fn().mockRejectedValue(fnError);

    await expect(withTransaction(fn)).rejects.toThrow('fn failed');

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ── 3. fn throws — rollback also throws ──────────────────────────────────────

describe('withTransaction — fn throws, ROLLBACK also throws', () => {
  it('releases client and rejects with the ROLLBACK error', async () => {
    const fnError       = new Error('fn failed');
    const rollbackError = new Error('rollback failed');

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})             // BEGIN
        .mockRejectedValueOnce(rollbackError), // ROLLBACK
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const fn = vi.fn().mockRejectedValue(fnError);

    await expect(withTransaction(fn)).rejects.toThrow('rollback failed');

    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ── 4. COMMIT fails — rollback succeeds ──────────────────────────────────────

describe('withTransaction — COMMIT throws, ROLLBACK succeeds', () => {
  it('calls ROLLBACK, releases client, and rejects with the commit error', async () => {
    const commitError = new Error('commit failed');

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})           // BEGIN
        .mockRejectedValueOnce(commitError)  // COMMIT
        .mockResolvedValueOnce({}),          // ROLLBACK
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const fn = vi.fn().mockResolvedValue({ data: 1 });

    await expect(withTransaction(fn)).rejects.toThrow('commit failed');

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(fn).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(client.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ── 5. COMMIT fails — rollback also throws ───────────────────────────────────

describe('withTransaction — COMMIT throws, ROLLBACK also throws', () => {
  it('releases client and rejects', async () => {
    const commitError   = new Error('commit failed');
    const rollbackError = new Error('rollback failed');

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})             // BEGIN
        .mockRejectedValueOnce(commitError)    // COMMIT
        .mockRejectedValueOnce(rollbackError), // ROLLBACK
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const fn = vi.fn().mockResolvedValue({ data: 1 });

    await expect(withTransaction(fn)).rejects.toThrow();

    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
