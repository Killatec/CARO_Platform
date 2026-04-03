import { query } from './query.js';

/**
 * Returns all registry revisions ordered by registry_rev DESC.
 *
 * @returns {Promise<Array<{registry_rev, applied_by, applied_at, comment}>>}
 */
export async function getRevisions() {
  const result = await query(
    'SELECT registry_rev, applied_by, applied_at, comment FROM registry_revisions ORDER BY registry_rev DESC'
  );
  return result.rows;
}
