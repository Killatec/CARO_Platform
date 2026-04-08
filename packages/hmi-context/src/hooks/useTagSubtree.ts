import { useMemo } from 'react';
import type { NestedTagNode, TagDef } from '../types.js';
import { useHmiContext } from './useHmiContext.js';

function ensureChildren(node: NestedTagNode): Record<string, NestedTagNode> {
  if (!node.children) node.children = {};
  return node.children as Record<string, NestedTagNode>;
}

export function useTagSubtree(pathPrefix: string): NestedTagNode | null {
  const { tagMap } = useHmiContext();

  return useMemo(() => {
    const prefixSegs = pathPrefix.split('.');
    const P = prefixSegs.length;

    const matches: TagDef[] = [];
    for (const tag of tagMap.values()) {
      if (tag.tag_path === pathPrefix || tag.tag_path.startsWith(pathPrefix + '.')) {
        matches.push(tag);
      }
    }

    if (matches.length === 0) return null;

    const rootType = matches[0].meta[P - 1]?.type ?? 'unknown';
    const root: NestedTagNode = {
      name: prefixSegs[P - 1],
      type: rootType,
      tag: null,
      children: null,
    };

    for (const tag of matches) {
      const tagSegs = tag.tag_path.split('.');
      const remainingSegs = tagSegs.slice(P);

      if (remainingSegs.length === 0) {
        root.tag = tag;
        continue;
      }

      let current = root;
      for (let i = 0; i < remainingSegs.length; i++) {
        const seg = remainingSegs[i];
        const isLeaf = i === remainingSegs.length - 1;
        const nodeType = tag.meta[P + i]?.type ?? 'unknown';

        const children = ensureChildren(current);

        if (!children[seg]) {
          children[seg] = {
            name: seg,
            type: nodeType,
            tag: null,
            children: null,
          };
        }

        if (isLeaf) {
          children[seg].tag = tag;
          // children stays null — it's a leaf
        }

        current = children[seg];
      }
    }

    return root;
  }, [pathPrefix, tagMap]);
}
