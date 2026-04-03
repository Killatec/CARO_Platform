import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// Mock query and withTransaction before importing migrations
vi.mock('../query.js', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import { query, withTransaction } from '../query.js';
import { runMigrations } from '../migrations.js';

// Helper: build a withTransaction mock that executes the callback with a
// mock client whose query() always resolves successfully.
function makeSuccessfulTransaction() {
  const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
  withTransaction.mockImplementation(async (fn) => {
    await fn({ query: clientQuery });
  });
  return clientQuery;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runMigrations — schema_migrations guard', () => {
  it('creates schema_migrations table then applies pending migrations', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['001_init.sql', '002_add_table.sql']);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('SELECT 1;');

    // query call order: CREATE TABLE, SELECT for 001, SELECT for 002
    query
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce({ rows: [] }) // SELECT check: 001 not applied
      .mockResolvedValueOnce({ rows: [] }); // SELECT check: 002 not applied
    makeSuccessfulTransaction();

    const results = await runMigrations();

    expect(results).toEqual([
      { file: '001_init.sql', status: 'ok' },
      { file: '002_add_table.sql', status: 'ok' },
    ]);
    // CREATE TABLE was the first query call
    expect(query.mock.calls[0][0]).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/);
    // withTransaction called once per migration
    expect(withTransaction).toHaveBeenCalledTimes(2);
  });

  it('skips migrations already recorded in schema_migrations', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['001_init.sql', '002_add_table.sql']);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('SELECT 1;');

    query
      .mockResolvedValueOnce({ rows: [] })        // CREATE TABLE
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // 001 already applied
      .mockResolvedValueOnce({ rows: [] });          // 002 not applied
    makeSuccessfulTransaction();

    const results = await runMigrations();

    expect(results).toEqual([
      { file: '001_init.sql', status: 'skipped' },
      { file: '002_add_table.sql', status: 'ok' },
    ]);
    // withTransaction only called for the one pending migration
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not record a failed migration in schema_migrations', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['001_broken.sql']);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('SELEKT 1;');

    const migrationError = new Error('syntax error at or near "SELEKT"');
    query
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }); // SELECT check: not applied

    // Simulate the migration SQL failing inside the transaction — withTransaction
    // re-throws so the INSERT into schema_migrations is never committed.
    const clientQuery = vi.fn().mockRejectedValueOnce(migrationError);
    withTransaction.mockImplementation(async (fn) => {
      await fn({ query: clientQuery });
    });

    await expect(runMigrations()).rejects.toThrow('syntax error at or near "SELEKT"');
    // withTransaction was attempted
    expect(withTransaction).toHaveBeenCalledTimes(1);
    // The INSERT call was never reached because clientQuery threw on the first call
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });
});

describe('runMigrations — Delta 004 fail-fast preserved', () => {
  it('throws and does not continue when a migration fails', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['001_init.sql', '002_broken.sql']);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('SELECT 1;');

    const migrationError = new Error('syntax error at or near "SELEKT"');
    query
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }) // SELECT check: 001 not applied
      .mockResolvedValueOnce({ rows: [] }); // SELECT check: 002 not applied

    withTransaction
      .mockResolvedValueOnce(undefined)    // 001 succeeds
      .mockRejectedValueOnce(migrationError); // 002 fails

    await expect(runMigrations()).rejects.toThrow('syntax error at or near "SELEKT"');
    // Loop did not continue — only 2 withTransaction calls (both migrations were
    // reached but the second threw; no third migration would have been attempted)
    expect(withTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('runMigrations — filesystem edge cases', () => {
  it('returns empty array when migrations directory cannot be read', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // CREATE TABLE still runs
    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const results = await runMigrations();

    expect(results).toEqual([]);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('ignores non-.sql files in the migrations directory', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['001_init.sql', 'README.md', '.gitkeep']);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('SELECT 1;');

    query
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] }); // SELECT check: 001 not applied
    makeSuccessfulTransaction();

    const results = await runMigrations();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ file: '001_init.sql', status: 'ok' });
  });
});
