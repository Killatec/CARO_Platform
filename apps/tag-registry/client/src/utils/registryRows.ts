import type { NewTagInput } from '@caro/db';
import type { DiffRow } from './diffRegistry.js';

/**
 * Resolves the effective row set for display: the diffed rows when a diff
 * is available, or a synthetic "unchanged" row per tag otherwise (no DB
 * diff yet computed).
 */
export function resolveDisplayRows(
  rows: DiffRow[] | null | undefined,
  tags: NewTagInput[]
): DiffRow[] {
  return rows ?? tags.map(t => ({
    ...t,
    module: t.module ?? null,
    module_type: t.module_type ?? null,
    diffStatus: 'unchanged' as const,
  }));
}

/**
 * Sorts rows by the given field, matching RegistryTable's column-header
 * sort behaviour: numeric comparison for tag_id, string comparison
 * otherwise, with missing tag_id sorting last regardless of direction.
 */
export function sortRegistryRows(
  rows: DiffRow[],
  sortField: string,
  sortDirection: 'asc' | 'desc'
): DiffRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const aRaw = (a as unknown as Record<string, unknown>)[sortField];
    const bRaw = (b as unknown as Record<string, unknown>)[sortField];

    if (sortField === 'tag_id') {
      const aNum = typeof aRaw === 'number' ? aRaw : Infinity;
      const bNum = typeof bRaw === 'number' ? bRaw : Infinity;
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    }

    const aVal = String(aRaw ?? '');
    const bVal = String(bRaw ?? '');
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}
