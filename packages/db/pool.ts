import { Pool, PoolClient, QueryResult } from 'pg';

/**
 * Lazy singleton pg.Pool.
 *
 * The Pool is constructed on first use rather than at import time so that
 * environment variables loaded by dotenv.config() in the app entry point are
 * available before the Pool reads them.
 *
 * Only one Pool instance is ever created per process.
 */

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) {
    return _pool;
  }

  if (!process.env.PGPASSWORD) {
    console.error(
      '[db] WARNING: PGPASSWORD is not set. Database connections will fail.'
    );
  }

  _pool = new Pool({
    host:                    process.env.PGHOST     || 'localhost',
    port:                    parseInt(process.env.PGPORT || '5432', 10),
    database:                process.env.PGDATABASE || 'caro_dev',
    user:                    process.env.PGUSER     || 'postgres',
    password:                process.env.PGPASSWORD,
    max:                     10,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 5000,
  });

  return _pool;
}

/**
 * Minimal pool interface — covers the three methods used by this package.
 */
interface DbPool {
  query(queryText: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

/**
 * Thin proxy so callers can write `pool.query(...)` and `pool.connect()`
 * without knowing about the lazy initialisation.
 *
 * Delegates every call to the real pg.Pool instance returned by getPool(),
 * which is created only on first invocation (after dotenv has loaded).
 */
const pool: DbPool = {
  query:   (queryText, values) => getPool().query(queryText, values as unknown[]),
  connect: () => getPool().connect(),
  end:     () => getPool().end(),
};

export default pool;
