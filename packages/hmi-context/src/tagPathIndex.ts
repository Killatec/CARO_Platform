import type { TagDef } from './types.js';

export interface TagPathIndex {
  resolve(assetPath: string): TagDef[];
}

export function buildTagPathIndex(tags: Iterable<TagDef>): TagPathIndex {
  const map = new Map<string, TagDef[]>();

  for (const tag of tags) {
    const segments = tag.tag_path.split('.');
    const n = segments.length;
    // Insert every contiguous subsequence of segments as a key.
    // e.g. "A.B.C" → "A", "A.B", "A.B.C", "B", "B.C", "C"
    for (let start = 0; start < n; start++) {
      for (let end = start + 1; end <= n; end++) {
        const key = segments.slice(start, end).join('.');
        const bucket = map.get(key);
        if (bucket !== undefined) {
          bucket.push(tag);
        } else {
          map.set(key, [tag]);
        }
      }
    }
  }

  return {
    resolve(assetPath: string): TagDef[] {
      return map.get(assetPath) ?? [];
    },
  };
}
