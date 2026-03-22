import { apiClient } from './client.js';

/**
 * Fetches the current active registry from the database.
 * @returns {Promise<Array<{tag_id, registry_rev, tag_path, data_type, is_setpoint, meta}>>}
 */
export async function fetchRegistry() {
  const data = await apiClient.get('/registry');
  return data.tags;
}
