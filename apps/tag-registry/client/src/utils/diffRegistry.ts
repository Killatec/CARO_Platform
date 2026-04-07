export interface ProposedTag {
  tag_path: string;
  data_type: string;
  is_setpoint: boolean;
  trends?: boolean;
  meta: unknown;
}

export interface DbTag extends ProposedTag {
  tag_id: number;
  registry_rev: number;
  retired?: boolean;
}

export type DiffStatus = 'added' | 'modified' | 'unchanged' | 'retired';

export interface DiffRow extends ProposedTag {
  diffStatus: DiffStatus;
  tag_id?: number;
  changedFields?: string[];
  dbMeta?: unknown;
}

/**
 * Compares a proposed registry (from resolveRegistry) against the database registry.
 *
 * Each returned row has an additional `diffStatus` field:
 *   'added'     — tag_path exists in proposed but not in DB
 *   'modified'  — tag_path exists in both but data_type, is_setpoint, or meta differs
 *   'unchanged' — tag_path exists in both and all fields match
 *   'retired'   — tag_path exists in DB but not in proposed
 */
export function diffRegistry(proposed: ProposedTag[], dbTags: DbTag[]): DiffRow[] {
  const dbByPath = new Map(dbTags.map(t => [t.tag_path, t]));
  const proposedByPath = new Map(proposed.map(t => [t.tag_path, t]));

  const rows: DiffRow[] = [];

  for (const tag of proposed) {
    const dbTag = dbByPath.get(tag.tag_path);
    if (!dbTag) {
      rows.push({ ...tag, diffStatus: 'added' });
    } else if (isModified(tag, dbTag)) {
      rows.push({ ...tag, tag_id: dbTag.tag_id, diffStatus: 'modified', changedFields: getChangedFields(tag, dbTag), dbMeta: dbTag.meta });
    } else {
      rows.push({ ...tag, tag_id: dbTag.tag_id, diffStatus: 'unchanged' });
    }
  }

  for (const dbTag of dbTags) {
    if (!proposedByPath.has(dbTag.tag_path)) {
      rows.push({ ...dbTag, diffStatus: 'retired' });
    }
  }

  const order: Record<DiffStatus, number> = { added: 0, modified: 1, unchanged: 2, retired: 3 };
  rows.sort((a, b) => order[a.diffStatus] - order[b.diffStatus]);

  return rows;
}

function isModified(proposed: ProposedTag, dbTag: DbTag): boolean {
  if (proposed.data_type !== dbTag.data_type) return true;
  if (proposed.is_setpoint !== dbTag.is_setpoint) return true;
  if ((proposed.trends ?? false) !== (dbTag.trends ?? false)) return true;
  if (!deepEqual(proposed.meta, dbTag.meta)) return true;
  return false;
}

function getChangedFields(proposed: ProposedTag, dbTag: DbTag): string[] {
  const changed: string[] = [];
  if (proposed.tag_path !== dbTag.tag_path) changed.push('tag_path');
  if (proposed.data_type !== dbTag.data_type) changed.push('data_type');
  if (proposed.is_setpoint !== dbTag.is_setpoint) changed.push('is_setpoint');
  if ((proposed.trends ?? false) !== (dbTag.trends ?? false)) changed.push('trends');
  if (!deepEqual(proposed.meta, dbTag.meta)) changed.push('meta');
  return changed;
}

/**
 * Deep equality check that is key-order insensitive for plain objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }
    return true;
  }
  return false;
}

function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
