import { apiClient } from './client.js';

/**
 * Fetches the current active registry from the database.
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, meta}>>}
 */
export async function fetchRegistry() {
  const data = await apiClient.get('/registry');
  return data.tags;
}

/**
 * Fetches all registry revisions ordered by registry_rev DESC.
 * @returns {Promise<Array<{registry_rev, applied_by, applied_at, comment}>>}
 */
export async function fetchRevisions() {
  const data = await apiClient.get('/registry/revisions');
  return data.revisions;
}

/**
 * Fetches all tag_registry rows for a given revision.
 * @param {number} rev
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta}>>}
 */
export async function fetchRevisionTags(rev) {
  const data = await apiClient.get(`/registry/revisions/${rev}`);
  return data.tags;
}

/**
 * Applies the resolved registry for rootName to the database.
 * @param {string} rootName
 * @param {string} comment
 * @returns {Promise<{ok, registry_rev, added, modified, retired, message?}>}
 */
export async function applyRegistry(rootName, comment) {
  const data = await apiClient.post('/registry/apply', { rootName, comment });
  return data;
}
