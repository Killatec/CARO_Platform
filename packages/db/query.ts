import { PoolClient, QueryResult } from 'pg';
import pool from './pool.js';

/**
 * Thin wrapper around pool.query().
 *
 * Returns the pg QueryResult directly. Callers are responsible for error
 * handling.
 */
export function query(text: string, params?: unknown[]): Promise<QueryResult> {
  return pool.query(text, params);
}

/**
 * Executes fn(client) inside a database transaction.
 *
 * Acquires a client from the pool, sends BEGIN, calls fn(client), and
 * commits on success. Rolls back and re-throws on any error. The client
 * is always released back to the pool in the finally block.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
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
