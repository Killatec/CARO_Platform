import fs from 'fs';
import path from 'path';
import { query } from './query.js';

/**
 * Runs all .sql migration files from db/postgres/migrations/ in filename
 * order (001 before 002, etc.).
 *
 * The migrations folder is resolved relative to process.cwd() (the monorepo
 * root) so this works regardless of which app imports @caro/db.
 *
 * Does not throw — logs errors and continues so all files are attempted.
 *
 * @returns {Promise<Array<{file: string, status: 'ok'|'error'}>>}
 */
export async function runMigrations() {
  const migrationsDir = path.join(process.cwd(), 'db', 'postgres', 'migrations');

  let files;
  try {
    files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    console.error('[db] runMigrations: could not read migrations directory:', err.message);
    return [];
  }

  const results = [];

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    console.log(`[db] Running migration: ${file}`);
    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      await query(sql);
      console.log(`[db] Migration OK: ${file}`);
      results.push({ file, status: 'ok' });
    } catch (err) {
      console.error(`[db] Migration FAILED: ${file}:`, err.message);
      results.push({ file, status: 'error' });
    }
  }

  return results;
}
