import { apiClient } from './client.js';

/**
 * Fetches runtime validation configuration from the server.
 * @returns {Promise<{ requiredParentTypes: string[], uniqueParentTypes: boolean }>}
 */
export async function fetchConfig() {
  return apiClient.get('/config');
}
