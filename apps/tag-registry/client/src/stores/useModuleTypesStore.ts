import { create } from 'zustand';
import type { ModuleType } from '@caro/db';

interface ModuleTypesState {
  moduleTypes: ModuleType[];
  displayNameMap: Map<string, string>;
  setModuleTypes: (types: ModuleType[]) => void;
}

export const useModuleTypesStore = create<ModuleTypesState>((set) => ({
  moduleTypes: [],
  displayNameMap: new Map(),
  setModuleTypes: (types) => set({
    moduleTypes: types,
    displayNameMap: new Map(types.map(t => [t.type_name, t.display_name])),
  }),
}));
