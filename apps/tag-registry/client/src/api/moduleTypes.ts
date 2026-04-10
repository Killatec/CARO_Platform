import { apiClient } from '@caro/ui/api/client';
import type { ModuleType } from '@caro/db';

export async function fetchModuleTypes(): Promise<ModuleType[]> {
  return apiClient.get<ModuleType[]>('/module-types');
}
