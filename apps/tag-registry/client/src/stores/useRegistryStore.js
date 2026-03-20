import { create } from 'zustand';

/**
 * Registry store - manages resolved registry (Phase 1: client-side only)
 * Tags are set directly by RegistryPage, not fetched from server
 */
export const useRegistryStore = create((set, get) => ({
  // State
  tags: [], // Array of { tag_path, data_type, is_setpoint, meta }
  sortField: 'tag_path',
  sortDirection: 'asc',

  // Actions
  setTags: (tags) => {
    set({ tags });
  },

  setSort: (field) => {
    const current = get();
    const direction = current.sortField === field && current.sortDirection === 'asc' ? 'desc' : 'asc';

    // Sort the tags array
    const sortedTags = [...current.tags].sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    set({ sortField: field, sortDirection: direction, tags: sortedTags });
  }
}));
