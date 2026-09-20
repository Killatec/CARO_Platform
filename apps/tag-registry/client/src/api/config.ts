import { apiClient } from '@caro/ui/api/client';

export interface ValidationConfig {
  requiredParentTypes: string[];
  uniqueParentTypes: boolean;
  databaseName: string;
  projectRoot: string | null;
}

/**
 * Fetches runtime validation configuration from the server.
 */
export async function fetchConfig(): Promise<ValidationConfig> {
  return apiClient.get<ValidationConfig>('/config');
}
