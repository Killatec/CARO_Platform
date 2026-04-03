import { query, withTransaction } from './query.js';

/**
 * Returns the latest active (non-retired) row for each tag_id.
 *
 * Strategy: DISTINCT ON (tag_id) ORDER BY registry_rev DESC selects the
 * highest-revision row per tag unconditionally, then the outer WHERE filters
 * to only those whose latest state is active (retired = false).
 *
 * Applying WHERE before DISTINCT ON is incorrect — it would exclude retired
 * rows from consideration and could surface stale non-retired rows from older
 * revisions as if they were current.
 *
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, trends, retired, meta}>>}
 */
export async function getActiveTags() {
  const result = await query(`
    SELECT * FROM (
      SELECT DISTINCT ON (tag_id)
        tag_id,
        registry_rev,
        tag_path,
        data_type,
        is_setpoint,
        trends,
        retired,
        meta
      FROM tag_registry
      ORDER BY tag_id, registry_rev DESC
    ) latest
    WHERE retired = false
  `);
  return result.rows;
}

/**
 * Returns all tag_registry rows for a given revision, ordered by tag_path ASC.
 * Returns null if no rows exist for that revision.
 *
 * @param {number} rev
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta}>|null>}
 */
export async function getRevisionTags(rev) {
  const result = await query(
    'SELECT tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta FROM tag_registry WHERE registry_rev = $1 ORDER BY tag_path ASC',
    [rev]
  );
  if (result.rows.length === 0) return null;
  return result.rows;
}

/**
 * Writes a pre-computed registry diff to the database inside a SERIALIZABLE transaction.
 *
 * The caller is responsible for computing added/modified/retired from business logic.
 * This function handles only the DB writes — it assigns tag_ids, records the revision,
 * and inserts all rows atomically.
 *
 * @param {Array} added    - New tags (no tag_id yet); each has tag_path, data_type, is_setpoint, trends, meta
 * @param {Array} modified - Changed tags (have tag_id); same shape as added
 * @param {Array} retired  - Tags to retire (from getActiveTags); have tag_id and all current fields
 * @param {string} comment - Revision description
 * @returns {Promise<{registry_rev, added: number, modified: number, retired: number}>}
 */
export async function applyRegistryRevision(added, modified, retired, comment) {
  let result;

  await withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Next registry_rev
    const revRow = await client.query(
      'SELECT COALESCE(MAX(registry_rev), 0) + 1 AS next_rev FROM registry_revisions'
    );
    const next_rev = revRow.rows[0].next_rev;

    // Record this revision
    await client.query(
      'INSERT INTO registry_revisions (registry_rev, applied_by, applied_at, comment) VALUES ($1, $2, NOW(), $3)',
      [next_rev, 'dev', comment]
    );

    // Base tag_id for new tags
    const idRow = await client.query(
      'SELECT COALESCE(MAX(tag_id), 1000) AS max_id FROM tag_registry'
    );
    let nextTagId = Number(idRow.rows[0].max_id);

    // Added tags — assign new tag_ids
    for (const tag of added) {
      nextTagId++;
      await client.query(
        `INSERT INTO tag_registry (tag_id, registry_rev, tag_path, data_type, is_setpoint, trends, retired, meta)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7)`,
        [nextTagId, next_rev, tag.tag_path, tag.data_type, tag.is_setpoint, tag.trends ?? false, JSON.stringify(tag.meta)]
      );
    }

    // Modified tags — insert a new row at this rev (append-only; old rows are superseded
    // by DISTINCT ON ordering in getActiveTags).
    for (const tag of modified) {
      await client.query(
        `INSERT INTO tag_registry (tag_id, registry_rev, tag_path, data_type, is_setpoint, trends, retired, meta)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7)`,
        [tag.tag_id, next_rev, tag.tag_path, tag.data_type, tag.is_setpoint, tag.trends ?? false, JSON.stringify(tag.meta)]
      );
    }

    // Retired tags — insert a new row with retired=true.
    for (const tag of retired) {
      await client.query(
        `INSERT INTO tag_registry (tag_id, registry_rev, tag_path, data_type, is_setpoint, trends, retired, meta)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
        [tag.tag_id, next_rev, tag.tag_path, tag.data_type, tag.is_setpoint, tag.trends ?? false, JSON.stringify(tag.meta)]
      );
    }

    result = {
      registry_rev: next_rev,
      added:        added.length,
      modified:     modified.length,
      retired:      retired.length,
    };
  });

  return result;
}
