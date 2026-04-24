import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { PoolClient } from 'pg';
import timescalePool from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type MigrationStatus = 'ok' | 'skipped' | 'error';

export interface TimescaleMigrationResult {
  file: string;
  status: MigrationStatus;
}

async function tsQuery(text: string, params?: unknown[]) {
  return timescalePool.query(text, params);
}

async function tsWithTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await timescalePool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs all .sql migration files from db/timescale/migrations/ in
 * filename order, skipping any already recorded in schema_migrations.
 *
 * Uses advisory lock ID 2 (lock ID 1 is reserved for the operational DB).
 */
export async function runTimescaleMigrations(): Promise<TimescaleMigrationResult[]> {
  await tsQuery('SELECT pg_advisory_lock(2)');

  try {
    await tsQuery(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = resolve(__dirname, '../../../../db/timescale/migrations');

    let files: string[];
    try {
      files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch (err) {
      console.error('[db] runTimescaleMigrations: could not read migrations directory:', (err as Error).message);
      return [];
    }

    const results: TimescaleMigrationResult[] = [];

    for (const file of files) {
      const check = await tsQuery(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if (check.rows.length > 0) {
        console.log(`[db] Timescale migration already applied, skipping: ${file}`);
        results.push({ file, status: 'skipped' });
        continue;
      }

      const filePath = resolve(migrationsDir, file);
      console.log(`[db] Running timescale migration: ${file}`);
      try {
        const sql = fs.readFileSync(filePath, 'utf8');
        await tsWithTransaction(async (client) => {
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [file]
          );
        });
        console.log(`[db] Timescale migration OK: ${file}`);
        results.push({ file, status: 'ok' });
      } catch (err) {
        console.error(`[db] Timescale migration FAILED: ${file}:`, (err as Error).message);
        results.push({ file, status: 'error' });
        throw err;
      }
    }

    return results;
  } finally {
    await tsQuery('SELECT pg_advisory_unlock(2)');
  }
}
