import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TreeExpandState {
  expandedPaths: Record<string, boolean>;
  setExpanded: (ownPath: string, value: boolean) => void;
  clearExpanded: (ownPath: string) => void;
}

export const useTreeExpandStore = create<TreeExpandState>()(
  persist(
    (set) => ({
      expandedPaths: {},

      setExpanded: (ownPath, value) =>
        set((state) => ({
          expandedPaths: { ...state.expandedPaths, [ownPath]: value },
        })),

      clearExpanded: (ownPath) =>
        set((state) => {
          const next = { ...state.expandedPaths };
          for (const key of Object.keys(next)) {
            if (key === ownPath || key.startsWith(ownPath + '.')) {
              delete next[key];
            }
          }
          return { expandedPaths: next };
        }),
    }),
    { name: 'caro.tag-registry.tree-expand' },
  ),
);
