import type { TagDef } from '@caro/hmi-context';

export interface TagForestNode {
  name: string;
  pathKey: string;
  tag: TagDef | null;
  children: TagForestNode[];
  hasTrendableDescendant: boolean;
}

// Intermediate mutable tree built before materialization.
interface MutableNode {
  name: string;
  pathKey: string;
  tag: TagDef | null;
  children: Map<string, MutableNode>;
}

function getOrCreate(parent: Map<string, MutableNode>, segment: string, parentKey: string): MutableNode {
  const key = parentKey ? `${parentKey}.${segment}` : segment;
  if (!parent.has(segment)) {
    parent.set(segment, { name: segment, pathKey: key, tag: null, children: new Map() });
  }
  return parent.get(segment)!;
}

function materialize(node: MutableNode): TagForestNode {
  const children = [...node.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(materialize);

  const hasTrendableDescendant =
    (node.tag !== null && node.tag.trendable) ||
    children.some(c => c.hasTrendableDescendant);

  return {
    name:                   node.name,
    pathKey:                node.pathKey,
    tag:                    node.tag,
    children,
    hasTrendableDescendant,
  };
}

export function buildTagForest(tagMap: Map<number, TagDef>): TagForestNode[] {
  const roots = new Map<string, MutableNode>();

  for (const tag of tagMap.values()) {
    const segments = tag.tag_path.split('.');
    let currentMap = roots;
    let parentKey = '';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const node = getOrCreate(currentMap, seg, parentKey);
      parentKey = node.pathKey;

      if (i === segments.length - 1) {
        node.tag = tag;
      }

      currentMap = node.children;
    }
  }

  return [...roots.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(materialize);
}
