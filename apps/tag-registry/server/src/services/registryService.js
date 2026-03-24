import { query, withTransaction } from '@caro/db';
import { resolveRegistry } from '../../../shared/index.js';

/**
 * Returns the latest active (non-retired) registry row for each tag_id.
 * Uses DISTINCT ON to get the highest registry_rev per tag_id.
 *
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, meta}>>}
 */
export async function getActiveRegistry() {
  const result = await query(`
    SELECT * FROM (
      SELECT DISTINCT ON (tag_id)
        tag_id,
        registry_rev,
        tag_path,
        data_type,
        is_setpoint,
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
 * Returns all registry revisions ordered by registry_rev DESC.
 * @returns {Promise<Array<{registry_rev, applied_by, applied_at, comment}>>}
 */
export async function getRevisions() {
  const result = await query(
    'SELECT registry_rev, applied_by, applied_at, comment FROM registry_revisions ORDER BY registry_rev DESC'
  );
  return result.rows;
}

/**
 * Returns all tag_registry rows for a given revision, ordered by tag_path ASC.
 * Returns null if no rows exist for that revision.
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
 * Applies the resolved registry to the database inside a SERIALIZABLE transaction.
 *
 * @param {Map} templateMap - Map of template_name -> template object
 * @param {string} rootName - Name of the root template
 * @param {string} comment - Description of this registry update
 * @returns {Promise<{ok, registry_rev, added, modified, retired, message?}>}
 */
export async function applyRegistry(templateMap, rootName, comment) {
  // 1. Resolve proposed registry server-side — do not trust client-supplied data
  const proposed = resolveRegistry(templateMap, rootName);

  // 2. Get current DB tags
  const dbTags = await getActiveRegistry();

  // 3. Classify tags
  const dbByPath = new Map(dbTags.map(t => [t.tag_path, t]));
  const proposedByPath = new Map(proposed.map(t => [t.tag_path, t]));

  const added = [];
  const modified = [];
  const retired = [];

  for (const tag of proposed) {
    const dbTag = dbByPath.get(tag.tag_path);
    if (!dbTag) {
      added.push(tag);
    } else if (isModified(tag, dbTag)) {
      modified.push({ ...tag, tag_id: dbTag.tag_id });
    }
    // unchanged — no action
  }

  for (const dbTag of dbTags) {
    if (!proposedByPath.has(dbTag.tag_path)) {
      retired.push(dbTag);
    }
  }

  // 4. Early return if nothing changed
  if (added.length === 0 && modified.length === 0 && retired.length === 0) {
    return { ok: true, registry_rev: null, message: 'No changes to apply' };
  }

  // 5. Apply in a SERIALIZABLE transaction
  let applyResult;
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
        `INSERT INTO tag_registry (tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta)
         VALUES ($1, $2, $3, $4, $5, false, $6)`,
        [nextTagId, next_rev, tag.tag_path, tag.data_type, tag.is_setpoint, JSON.stringify(tag.meta)]
      );
    }

    // Modified tags — insert one new row with updated fields, retired=false.
    // Old rows at earlier registry_revs are left as-is (append-only).
    // getActiveRegistry uses DISTINCT ON (tag_id) ORDER BY registry_rev DESC
    // so only the latest row per tag_id is returned, making old rows harmless.
    for (const tag of modified) {
      await client.query(
        `INSERT INTO tag_registry (tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta)
         VALUES ($1, $2, $3, $4, $5, false, $6)`,
        [tag.tag_id, next_rev, tag.tag_path, tag.data_type, tag.is_setpoint, JSON.stringify(tag.meta)]
      );
    }

    // Retired tags — insert one new row with same fields, retired=true.
    for (const dbTag of retired) {
      await client.query(
        `INSERT INTO tag_registry (tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [dbTag.tag_id, next_rev, dbTag.tag_path, dbTag.data_type, dbTag.is_setpoint, JSON.stringify(dbTag.meta)]
      );
    }

    applyResult = {
      ok: true,
      registry_rev: next_rev,
      added: added.length,
      modified: modified.length,
      retired: retired.length,
    };
  });

  return applyResult;
}

// ---------------------------------------------------------------------------
// Server-side diff helpers (mirrors client diffRegistry.js logic)
// ---------------------------------------------------------------------------

function isModified(proposed, dbTag) {
  if (proposed.data_type !== dbTag.data_type) return true;
  if (proposed.is_setpoint !== dbTag.is_setpoint) return true;
  if (!deepEqual(proposed.meta, dbTag.meta)) return true;
  return false;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
