import { Pool, PoolClient, QueryResult } from 'pg';

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) {
    return _pool;
  }

  if (!process.env.TIMESCALE_PASSWORD) {
    console.error(
      '[db] WARNING: TIMESCALE_PASSWORD is not set. TimescaleDB connections will fail.'
    );
  }

  _pool = new Pool({
    host:                    process.env.TIMESCALE_HOST     || 'localhost',
    port:                    parseInt(process.env.TIMESCALE_PORT || '5433', 10),
    database:                process.env.TIMESCALE_DATABASE || 'caro_timescale',
    user:                    process.env.TIMESCALE_USER     || 'postgres',
    password:                process.env.TIMESCALE_PASSWORD,
    max:                     10,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 5000,
  });

  return _pool;
}

interface DbPool {
  query(queryText: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on(event: 'connect', listener: (client: PoolClient) => void): void;
}

const timescalePool: DbPool = {
  query:   (queryText, values) => getPool().query(queryText, values as unknown[]),
  connect: () => getPool().connect(),
  end:     () => getPool().end(),
  on:      (event, listener)   => { getPool().on(event, listener); },
};

export default timescalePool;

/**
 * Typed query helper for the TimescaleDB pool.
 *
 * Wraps `timescalePool.query(text, params)` and returns the rows array directly,
 * cast to the caller's row type. Exists so the row-shape cast appears in one
 * place per call site instead of being scattered alongside every `.rows as T[]`.
 * Identical wire behavior to calling `timescalePool.query` directly.
 *
 * Example:
 *   const rows = await timescaleQuery<{ split_ms: string | number }>(
 *     'SELECT extract(epoch from time_bucket(...)) * 1000 AS split_ms',
 *     [bucketSMs, watermarkMs],
 *   );
 *   const splitMs = Number(rows[0].split_ms);
 */
export async function timescaleQuery<T>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await timescalePool.query(text, params);
  return result.rows as T[];
}
