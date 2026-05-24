import { deepEqual } from '@caro/tag-registry-shared';

export interface ProposedTag {
  tag_path: string;
  module: string | null;
  module_type: string | null;
  data_type: string;
  is_setpoint: boolean;
  trends?: boolean;
  unit?: string | null;
  format?: string | null;
  eng_min?: number | null;
  eng_max?: number | null;
  tag_name?: string | null;
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
  if ((proposed.module ?? null) !== (dbTag.module ?? null)) return true;
  if ((proposed.module_type ?? null) !== (dbTag.module_type ?? null)) return true;
  if ((proposed.unit    ?? null) !== (dbTag.unit    ?? null)) return true;
  if ((proposed.format  ?? null) !== (dbTag.format  ?? null)) return true;
  if ((proposed.eng_min ?? null) !== (dbTag.eng_min ?? null)) return true;
  if ((proposed.eng_max ?? null) !== (dbTag.eng_max ?? null)) return true;
  if ((proposed.tag_name ?? null) !== (dbTag.tag_name ?? null)) return true;
  if (!deepEqual(proposed.meta, dbTag.meta)) return true;
  return false;
}

function getChangedFields(proposed: ProposedTag, dbTag: DbTag): string[] {
  const changed: string[] = [];
  if (proposed.tag_path !== dbTag.tag_path) changed.push('tag_path');
  if (proposed.data_type !== dbTag.data_type) changed.push('data_type');
  if (proposed.is_setpoint !== dbTag.is_setpoint) changed.push('is_setpoint');
  if ((proposed.trends ?? false) !== (dbTag.trends ?? false)) changed.push('trends');
  if ((proposed.module ?? null) !== (dbTag.module ?? null)) changed.push('module');
  if ((proposed.module_type ?? null) !== (dbTag.module_type ?? null)) changed.push('module_type');
  if ((proposed.unit    ?? null) !== (dbTag.unit    ?? null)) changed.push('unit');
  if ((proposed.format  ?? null) !== (dbTag.format  ?? null)) changed.push('format');
  if ((proposed.eng_min ?? null) !== (dbTag.eng_min ?? null)) changed.push('eng_min');
  if ((proposed.eng_max ?? null) !== (dbTag.eng_max ?? null)) changed.push('eng_max');
  if ((proposed.tag_name ?? null) !== (dbTag.tag_name ?? null)) changed.push('tag_name');
  if (!deepEqual(proposed.meta, dbTag.meta)) changed.push('meta');
  return changed;
}

