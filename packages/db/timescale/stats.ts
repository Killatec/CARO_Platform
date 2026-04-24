import timescalePool from './pool.js';

/**
 * Returns the current Timescale database size in bytes.
 * Uses pg_database_size(current_database()), which is a stat-call sum over
 * the DB's file tree — cheap for small DBs, 10–50ms for large ones.
 * Safe to call at minute cadence; do NOT call on a hot path.
 */
export async function getTimescaleDatabaseSizeBytes(): Promise<bigint> {
  const result = await timescalePool.query(
    'SELECT pg_database_size(current_database())::TEXT AS size'
  );
  return BigInt((result.rows[0] as { size: string }).size);
}
