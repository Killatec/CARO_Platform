import { useMemo } from 'react';
import { useTagMap } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';

/**
 * Resolves multiple child tags under a base asset path for composite widgets.
 *
 * Calls useTagMap once and performs all resolution in a single useMemo — this
 * avoids calling any hook inside a loop, satisfying React's rules of hooks.
 *
 * The `children` array MUST be statically defined per widget type (same length
 * and same entries on every render). Never pass a dynamically constructed array.
 */
export function useTagGroup(
  basePath: string,
  children: string[],
  widgetName: string
): Record<string, TagDef> {
  const tagMap = useTagMap();

  return useMemo(() => {
    const result: Record<string, TagDef> = {};

    for (const child of children) {
      const assetPath = `${basePath}.${child}`;
      const assetSegments = assetPath.split('.');
      const matches: TagDef[] = [];

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
          if (match) { found = true; break; }
        }

        if (found) matches.push(tag);
      }

      if (matches.length === 0) {
        throw new Error(`${widgetName}: no tag found for "${assetPath}"`);
      }
      if (matches.length > 1) {
        throw new Error(
          `${widgetName}: ambiguous match for "${assetPath}" (${matches.length} matches)`
        );
      }

      result[child] = matches[0];
    }

    return result;
  }, [basePath, children, tagMap, widgetName]);
}
