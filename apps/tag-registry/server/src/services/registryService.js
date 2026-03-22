import { query } from '@caro/db';

/**
 * Returns the latest active (non-retired) registry row for each tag_id.
 * Uses DISTINCT ON to get the highest registry_rev per tag_id.
 *
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, meta}>>}
 */
export async function getActiveRegistry() {
  const result = await query(`
    SELECT DISTINCT ON (tag_id)
      tag_id,
      registry_rev,
      tag_path,
      data_type,
      is_setpoint,
      meta
    FROM tag_registry
    WHERE retired = false
    ORDER BY tag_id, registry_rev DESC
  `);
  return result.rows;
}
