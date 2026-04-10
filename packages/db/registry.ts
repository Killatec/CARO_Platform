import { query, withTransaction } from './query.js';

export interface TagType {
  id: number;
  type_name: string;
  display_name: string;
}

export async function getTagTypes(): Promise<TagType[]> {
  const result = await query('SELECT id, type_name, display_name FROM tag_types ORDER BY id');
  return result.rows as TagType[];
}

/** Shape of a row returned by getActiveTags(). tag_id is coerced to number. */
export interface ActiveTag {
  tag_id: number;
  registry_rev: number;
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  trends: boolean;
  retired: boolean;
  meta: unknown;
}

/** Shape of a row returned by getRevisionTags(). */
export interface RevisionTag {
  tag_id: number;
  registry_rev: number;
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  retired: boolean;
  meta: unknown;
}

/** Input shape for a new tag (no tag_id — assigned by applyRegistryRevision). */
export interface NewTagInput {
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  trends?: boolean;
  meta: unknown;
}

/** Input shape for a tag that already has a tag_id (modified or retired). */
export interface ExistingTagInput extends NewTagInput {
  tag_id: number;
}

export interface ApplyResult {
  registry_rev: number;
  added: number;
  modified: number;
  retired: number;
}

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
 * node-postgres returns INTEGER columns as strings; tag_id is coerced to
 * Number before returning so all consumers receive a numeric tag_id.
 */
export async function getActiveTags(): Promise<ActiveTag[]> {
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
  return result.rows.map(row => ({ ...row, tag_id: Number(row.tag_id) })) as ActiveTag[];
}

/**
 * Returns all tag_registry rows for a given revision, ordered by tag_path ASC.
 * Returns null if no rows exist for that revision.
 */
export async function getRevisionTags(rev: number): Promise<RevisionTag[] | null> {
  const result = await query(
    'SELECT tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta FROM tag_registry WHERE registry_rev = $1 ORDER BY tag_path ASC',
    [rev]
  );
  if (result.rows.length === 0) return null;
  return result.rows as RevisionTag[];
}

/**
 * Writes a pre-computed registry diff to the database inside a SERIALIZABLE transaction.
 *
 * The caller is responsible for computing added/modified/retired from business logic.
 * This function handles only the DB writes — it assigns tag_ids, records the revision,
 * and inserts all rows atomically.
 */
export async function applyRegistryRevision(
  added: NewTagInput[],
  modified: ExistingTagInput[],
  retired: ExistingTagInput[],
  comment: string
): Promise<ApplyResult> {
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Next registry_rev
    const revRow = await client.query(
      'SELECT COALESCE(MAX(registry_rev), 0) + 1 AS next_rev FROM registry_revisions'
    );
    const next_rev: number = revRow.rows[0].next_rev;

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

    return {
      registry_rev: next_rev,
      added:        added.length,
      modified:     modified.length,
      retired:      retired.length,
    };
  });
}
