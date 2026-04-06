import { query } from './query.js';

export interface RevisionRow {
  registry_rev: number;
  applied_by: string;
  applied_at: Date;
  comment: string;
}

/**
 * Returns all registry revisions ordered by registry_rev DESC.
 */
export async function getRevisions(): Promise<RevisionRow[]> {
  const result = await query(
    'SELECT registry_rev, applied_by, applied_at, comment FROM registry_revisions ORDER BY registry_rev DESC'
  );
  return result.rows as RevisionRow[];
}
