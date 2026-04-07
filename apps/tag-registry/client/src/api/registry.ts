import { apiClient } from '@caro/ui/api/client';
import type { ActiveTag, RevisionRow } from '@caro/db';

export interface ApplyRegistryResult {
  ok: boolean;
  registry_rev: number | null;
  added?: number;
  modified?: number;
  retired?: number;
  message?: string;
}

/**
 * Fetches the current active registry from the database.
 */
export async function fetchRegistry(): Promise<ActiveTag[]> {
  const data = await apiClient.get<{ tags: ActiveTag[] }>('/registry');
  return data.tags;
}

/**
 * Fetches all registry revisions ordered by registry_rev DESC.
 */
export async function fetchRevisions(): Promise<RevisionRow[]> {
  const data = await apiClient.get<{ revisions: RevisionRow[] }>('/registry/revisions');
  return data.revisions;
}

/**
 * Fetches all tag_registry rows for a given revision.
 */
export async function fetchRevisionTags(rev: number): Promise<ActiveTag[]> {
  const data = await apiClient.get<{ tags: ActiveTag[] }>(`/registry/revisions/${rev}`);
  return data.tags;
}

/**
 * Applies the resolved registry for rootName to the database.
 */
export async function applyRegistry(rootName: string, comment: string): Promise<ApplyRegistryResult> {
  const data = await apiClient.post<ApplyRegistryResult>('/registry/apply', { rootName, comment });
  return data;
}
