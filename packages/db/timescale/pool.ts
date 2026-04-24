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
}

const timescalePool: DbPool = {
  query:   (queryText, values) => getPool().query(queryText, values as unknown[]),
  connect: () => getPool().connect(),
  end:     () => getPool().end(),
};

export default timescalePool;
