/**
 * Compares a proposed registry (from resolveRegistry) against the database registry.
 *
 * Each returned row has an additional `diffStatus` field:
 *   'added'     — tag_path exists in proposed but not in DB
 *   'modified'  — tag_path exists in both but data_type, is_setpoint, or meta differs
 *   'unchanged' — tag_path exists in both and all fields match
 *   'retired'   — tag_path exists in DB but not in proposed
 *
 * Comparison fields: tag_path, data_type, is_setpoint, meta only.
 * tag_id and registry_rev are DB-only fields and are excluded from comparison.
 *
 * Sort order: added → modified → unchanged → retired
 *
 * @param {Array<{tag_path, data_type, is_setpoint, meta}>} proposed
 * @param {Array<{tag_path, data_type, is_setpoint, meta}>} dbTags
 * @returns {Array<{tag_path, data_type, is_setpoint, meta, diffStatus}>}
 */
export function diffRegistry(proposed, dbTags) {
  const dbByPath = new Map(dbTags.map(t => [t.tag_path, t]));
  const proposedByPath = new Map(proposed.map(t => [t.tag_path, t]));

  const rows = [];

  for (const tag of proposed) {
    const dbTag = dbByPath.get(tag.tag_path);
    if (!dbTag) {
      rows.push({ ...tag, diffStatus: 'added' });
    } else if (isModified(tag, dbTag)) {
      rows.push({ ...tag, tag_id: dbTag.tag_id, diffStatus: 'modified', changedFields: getChangedFields(tag, dbTag) });
    } else {
      rows.push({ ...tag, tag_id: dbTag.tag_id, diffStatus: 'unchanged' });
    }
  }

  for (const dbTag of dbTags) {
    if (!proposedByPath.has(dbTag.tag_path)) {
      rows.push({ ...dbTag, diffStatus: 'retired' });
    }
  }

  const order = { added: 0, modified: 1, unchanged: 2, retired: 3 };
  rows.sort((a, b) => order[a.diffStatus] - order[b.diffStatus]);

  return rows;
}

function isModified(proposed, dbTag) {
  if (proposed.data_type !== dbTag.data_type) return true;
  if (proposed.is_setpoint !== dbTag.is_setpoint) return true;
  if (!deepEqual(proposed.meta, dbTag.meta)) return true;
  return false;
}

function getChangedFields(proposed, dbTag) {
  const changed = [];
  if (proposed.tag_path !== dbTag.tag_path) changed.push('tag_path');
  if (proposed.data_type !== dbTag.data_type) changed.push('data_type');
  if (proposed.is_setpoint !== dbTag.is_setpoint) changed.push('is_setpoint');
  if (!deepEqual(proposed.meta, dbTag.meta)) changed.push('meta');
  return changed;
}

/**
 * Deep equality check that is key-order insensitive for plain objects.
 */
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
