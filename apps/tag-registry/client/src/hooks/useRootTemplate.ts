import { create } from 'zustand';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';

export interface RootTemplateState {
  selectedRoot: string | null;
  setSelectedRoot: (rootName: string | null) => Promise<void>;
}

/**
 * Root template selection hook
 * Manages selected root and triggers loadRoot on change
 */
export const useRootTemplate = create<RootTemplateState>((set) => ({
  selectedRoot: null,

  setSelectedRoot: async (rootName) => {
    if (!rootName) {
      set({ selectedRoot: null });
      return;
    }

    set({ selectedRoot: rootName });

    const { loadRoot } = useTemplateGraphStore.getState();
    await loadRoot(rootName);
  }
}));
