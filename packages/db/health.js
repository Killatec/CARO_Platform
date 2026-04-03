import { query } from './query.js';

/**
 * Verifies the database connection is reachable.
 * Throws if the connection cannot be established.
 */
export async function ping() {
  await query('SELECT 1');
}
