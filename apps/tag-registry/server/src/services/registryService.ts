import {
  getActiveTags,
  getRevisions,
  getRevisionTags,
  applyRegistryRevision,
} from '@caro/db';
import type { ActiveTag, RevisionRow, RevisionTag, NewTagInput, ExistingTagInput, ApplyResult } from '@caro/db';
import { resolveRegistry } from '@caro/tag-registry-shared';
import type { Template } from '@caro/tag-registry-shared';

// ── Return types ──────────────────────────────────────────────────────────────

type ApplyRegistryResult =
  | { ok: true; registry_rev: null; message: string }
  | ({ ok: true } & ApplyResult);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the latest active (non-retired) registry row for each tag_id.
 */
export async function getActiveRegistry(): Promise<ActiveTag[]> {
  return getActiveTags();
}

export { getRevisions, getRevisionTags };
export type { RevisionRow, RevisionTag };

/**
 * Applies the resolved registry to the database inside a SERIALIZABLE transaction.
 */
export async function applyRegistry(
  templateMap: Map<string, Template>,
  rootName: string,
  comment: string
): Promise<ApplyRegistryResult> {
  // 1. Resolve proposed registry server-side — do not trust client-supplied data
  const proposed: NewTagInput[] = resolveRegistry(templateMap, rootName) as NewTagInput[];

  // 2. Get current DB tags
  const dbTags = await getActiveTags();

  // 3. Classify tags into added / modified / retired
  const dbByPath       = new Map(dbTags.map(t => [t.tag_path, t]));
  const proposedByPath = new Map(proposed.map(t => [t.tag_path, t]));

  const added:    NewTagInput[]      = [];
  const modified: ExistingTagInput[] = [];
  const retired:  ExistingTagInput[] = [];

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

// ── Private helpers ───────────────────────────────────────────────────────────

function isModified(proposed: NewTagInput, dbTag: ActiveTag): boolean {
  if (proposed.data_type !== dbTag.data_type)                  return true;
  if (proposed.is_setpoint !== dbTag.is_setpoint)            return true;
  if ((proposed.trends ?? false) !== (dbTag.trends ?? false)) return true;
  if (!deepEqual(proposed.meta, dbTag.meta))                 return true;
  return false;
}

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
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keysA = Object.keys(ao);
    const keysB = Object.keys(bo);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
      if (!deepEqual(ao[key], bo[key])) return false;
    }
    return true;
  }
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
