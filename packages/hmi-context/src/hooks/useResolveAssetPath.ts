import { useMemo } from 'react';
import type { TagDef } from '../types.js';
import { useTagMap } from './useTagMap.js';

export function useResolveAssetPath(assetPath: string): TagDef[] {
  const tagMap = useTagMap();

  return useMemo(() => {
    const assetSegments = assetPath.split('.');
    const results: TagDef[] = [];

    for (const tag of tagMap.values()) {
      const tagSegments = tag.tag_path.split('.');
      if (assetSegments.length > tagSegments.length) continue;

      let found = false;
      for (let i = 0; i <= tagSegments.length - assetSegments.length; i++) {
        let match = true;
        for (let j = 0; j < assetSegments.length; j++) {
          if (tagSegments[i + j] !== assetSegments[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          found = true;
          break;
        }
      }

      if (found) results.push(tag);
    }

    return results;
  }, [assetPath, tagMap]);
}
