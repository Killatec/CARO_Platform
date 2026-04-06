import { query } from './query.js';

/**
 * Verifies the database connection is reachable.
 * Throws if the connection cannot be established.
 */
export async function ping(): Promise<void> {
  await query('SELECT 1');
}
