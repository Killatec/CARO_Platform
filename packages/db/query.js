import pool from './pool.js';

/**
 * Thin wrapper around pool.query().
 *
 * Returns the pg QueryResult directly. Callers are responsible for error
 * handling.
 *
 * @param {string} text   SQL statement
 * @param {Array}  params Query parameters (optional)
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Executes fn(client) inside a database transaction.
 *
 * Acquires a client from the pool, sends BEGIN, calls fn(client), and
 * commits on success. Rolls back and re-throws on any error. The client
 * is always released back to the pool in the finally block.
 *
 * @param {function} fn  Async function that receives a pg.PoolClient
 * @returns {Promise<*>} The value returned by fn(client)
 */
export async function withTransaction(fn) {
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
