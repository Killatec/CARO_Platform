import { apiClient } from '@caro/ui/api/client';
import type { TagType } from '@caro/db';

export async function fetchTagTypes(): Promise<TagType[]> {
  return apiClient.get<TagType[]>('/tag-types');
}
