import { create } from 'zustand';
import type { NewTagInput } from '@caro/db';

export interface RegistryStoreState {
  tags: NewTagInput[];
  sortField: string;
  sortDirection: 'asc' | 'desc';
  setTags: (tags: NewTagInput[]) => void;
  setSort: (field: string) => void;
}

/**
 * Registry store - manages resolved registry (Phase 1: client-side only)
 * Tags are set directly by RegistryPage, not fetched from server
 */
export const useRegistryStore = create<RegistryStoreState>((set, get) => ({
  tags: [],
  sortField: 'tag_path',
  sortDirection: 'asc',

  setTags: (tags) => {
    set({ tags });
  },

  setSort: (field) => {
    const current = get();
    const direction: 'asc' | 'desc' = current.sortField === field && current.sortDirection === 'asc' ? 'desc' : 'asc';

    const sortedTags = [...current.tags].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[field];
      const bVal = (b as unknown as Record<string, unknown>)[field];
      const aStr = String(aVal ?? '');
      const bStr = String(bVal ?? '');
      if (aStr < bStr) return direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    set({ sortField: field, sortDirection: direction, tags: sortedTags });
  }
}));
