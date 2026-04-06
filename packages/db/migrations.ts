import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { query, withTransaction } from './query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type MigrationStatus = 'ok' | 'skipped' | 'error';

export interface MigrationResult {
  file: string;
  status: MigrationStatus;
}

/**
 * Runs all .sql migration files from db/postgres/migrations/ in filename
 * order (001 before 002, etc.), skipping any that have already been recorded
 * in the schema_migrations table.
 *
 * The migrations folder is resolved relative to this file's location
 * (packages/db/), so the path is correct regardless of the process working
 * directory of the app that imports @caro/db.
 *
 * Each migration runs inside a transaction that also inserts the filename into
 * schema_migrations, so a failed migration is never recorded as applied.
 *
 * Re-throws on migration failure so callers can halt startup (Delta 004).
 */
export async function runMigrations(): Promise<MigrationResult[]> {
  // Ensure the applied-migrations tracking table exists
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = resolve(__dirname, '../../../db/postgres/migrations');

  let files: string[];
  try {
    files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    console.error('[db] runMigrations: could not read migrations directory:', (err as Error).message);
    return [];
  }

  const results: MigrationResult[] = [];

  for (const file of files) {
    // Skip migrations that have already been applied
    const check = await query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (check.rows.length > 0) {
      console.log(`[db] Migration already applied, skipping: ${file}`);
      results.push({ file, status: 'skipped' });
      continue;
    }

    const filePath = resolve(migrationsDir, file);
    console.log(`[db] Running migration: ${file}`);
    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
      });
      console.log(`[db] Migration OK: ${file}`);
      results.push({ file, status: 'ok' });
    } catch (err) {
      console.error(`[db] Migration FAILED: ${file}:`, (err as Error).message);
      results.push({ file, status: 'error' });
      throw err;
    }
  }

  return results;
}
