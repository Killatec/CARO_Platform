import { create } from 'zustand';
import type { TagType } from '@caro/db';

interface TagTypesState {
  tagTypes: TagType[];
  displayNameMap: Map<string, string>;  // type_name → display_name
  setTagTypes: (types: TagType[]) => void;
}

export const useTagTypesStore = create<TagTypesState>((set) => ({
  tagTypes: [],
  displayNameMap: new Map(),
  setTagTypes: (types) => set({
    tagTypes: types,
    displayNameMap: new Map(types.map(t => [t.type_name, t.display_name])),
  }),
}));
