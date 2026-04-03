import { getActiveTags, getRevisions, getRevisionTags, applyRegistryRevision } from '@caro/db';
import { resolveRegistry } from '../../../shared/index.js';

/**
 * Returns the latest active (non-retired) registry row for each tag_id.
 *
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, trends, meta}>>}
 */
export async function getActiveRegistry() {
  return getActiveTags();
}

export { getRevisions, getRevisionTags };

/**
 * Applies the resolved registry to the database inside a SERIALIZABLE transaction.
 *
 * @param {Map} templateMap - Map of template_name -> template object
 * @param {string} rootName - Name of the root template
 * @param {string} comment  - Description of this registry update
 * @returns {Promise<{ok, registry_rev, added, modified, retired, message?}>}
 */
export async function applyRegistry(templateMap, rootName, comment) {
  // 1. Resolve proposed registry server-side — do not trust client-supplied data
  const proposed = resolveRegistry(templateMap, rootName);

  // 2. Get current DB tags
  const dbTags = await getActiveTags();

  // 3. Classify tags into added / modified / retired
  const dbByPath       = new Map(dbTags.map(t => [t.tag_path, t]));
  const proposedByPath = new Map(proposed.map(t => [t.tag_path, t]));

  const added    = [];
  const modified = [];
  const retired  = [];

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

  // 5. Write to DB
  const result = await applyRegistryRevision(added, modified, retired, comment);
  return { ok: true, ...result };
}

// ---------------------------------------------------------------------------
// Server-side diff helpers (mirrors client diffRegistry.js logic)
// ---------------------------------------------------------------------------

function isModified(proposed, dbTag) {
  if (proposed.data_type   !== dbTag.data_type)              return true;
  if (proposed.is_setpoint !== dbTag.is_setpoint)            return true;
  if ((proposed.trends ?? false) !== (dbTag.trends ?? false)) return true;
  if (!deepEqual(proposed.meta, dbTag.meta))                 return true;
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
