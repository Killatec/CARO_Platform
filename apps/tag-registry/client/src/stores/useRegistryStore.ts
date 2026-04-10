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
    set({ sortField: field, sortDirection: direction });
  }
}));
