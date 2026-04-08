import type { TagDef } from '../types.js';
import { useHmiContext } from './useHmiContext.js';

export function useTagMap(): Map<number, TagDef> {
  return useHmiContext().tagMap;
}
