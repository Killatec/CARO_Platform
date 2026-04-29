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

/**
 * Splits a SQL file into individual statements, correctly consuming
 * dollar-quoted blocks (DO $$ ... $$) as atomic units so that semicolons
 * inside those blocks are not treated as statement boundaries.
 *
 * Used by the -- NO TRANSACTION path so each statement runs in its own
 * autocommit context — required for CALL refresh_continuous_aggregate(),
 * which cannot run inside any transaction block (even an implicit one).
 */
function splitSqlStatements(sql: string): string[] {
  const results: string[] = [];
  let current = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    // Single-line comment: consume to end of line so semicolons inside comments
    // are never treated as statement terminators.
    if (sql[i] === '-' && i + 1 < n && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i);
      if (eol === -1) {
        current += sql.slice(i);
        i = n;
      } else {
        current += sql.slice(i, eol + 1);
        i = eol + 1;
      }
      continue;
    }

    // Dollar-quoted string: consume from $tag$ to the matching closing $tag$.
    // This covers DO $$ ... $$; blocks where inner semicolons must be ignored.
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^(\$[A-Za-z_0-9]*\$)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
          continue;
        }
      }
    }

    if (sql[i] === ';') {
      const stmt = current.trim();
      if (stmt) results.push(stmt);
      current = '';
    } else {
      current += sql[i];
    }
    i++;
  }

  const remaining = current.trim();
  if (remaining) results.push(remaining);

  // Drop entries that are pure comments (every non-empty line starts with --)
  return results.filter(stmt =>
    stmt.split('\n').some(l => l.trim().length > 0 && !l.trim().startsWith('--'))
  );
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
export async function runTimescaleMigrations(
  migrationsDir?: string,
): Promise<TimescaleMigrationResult[]> {
  await tsQuery('SELECT pg_advisory_lock(2)');

  try {
    await tsQuery(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Default path is relative to the compiled dist output (dist/timescale/).
    // Callers running from source (e.g. tsx scripts) should pass an explicit path.
    const resolvedMigrationsDir = migrationsDir ?? resolve(__dirname, '../../../../db/timescale/migrations');

    let files: string[];
    try {
      files = fs.readdirSync(resolvedMigrationsDir)
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

      const filePath = resolve(resolvedMigrationsDir, file);
      console.log(`[db] Running timescale migration: ${file}`);
      try {
        const sql = fs.readFileSync(filePath, 'utf8');

        // Files starting with "-- NO TRANSACTION" (e.g. CAG migrations that
        // include CALL statements) cannot run inside an explicit transaction
        // block on some TimescaleDB versions.  Run the SQL in autocommit mode
        // then record the migration in a separate statement.
        const noTransaction = sql.trimStart().startsWith('-- NO TRANSACTION');

        if (noTransaction) {
          // Execute each statement individually so every statement runs in its
          // own autocommit context.  Sending the whole file as one client.query()
          // wraps all statements in a single implicit transaction, which causes
          // CALL refresh_continuous_aggregate() to fail with "cannot run inside
          // a transaction block".
          const client = await timescalePool.connect();
          try {
            for (const stmt of splitSqlStatements(sql)) {
              await client.query(stmt);
            }
          } finally {
            client.release();
          }
          // Record separately.  If this INSERT fails after a successful SQL run,
          // re-running the migration is safe because the SQL uses IF [NOT] EXISTS
          // guards throughout.
          await tsQuery('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        } else {
          await tsWithTransaction(async (client) => {
            await client.query(sql);
            await client.query(
              'INSERT INTO schema_migrations (filename) VALUES ($1)',
              [file]
            );
          });
        }

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
