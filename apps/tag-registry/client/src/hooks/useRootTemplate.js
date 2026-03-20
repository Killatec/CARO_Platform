import { create } from 'zustand';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';

/**
 * Root template selection hook
 * Manages selected root and triggers loadRoot on change
 */
export const useRootTemplate = create((set, get) => ({
  selectedRoot: null,

  setSelectedRoot: async (rootName) => {
    if (!rootName) {
      set({ selectedRoot: null });
      return;
    }

    set({ selectedRoot: rootName });

    // Trigger loadRoot in template graph store
    const { loadRoot } = useTemplateGraphStore.getState();
    await loadRoot(rootName);
  }
}));
