// tag-list.ts — builds the handshake TAG_LIST for one module from the tag map.
//
// The tag map is the registry's latest active row per tag_id, loaded once at
// startup, so a TAG_LIST reflects the registry as of the last HMI restart.
// tag_name is module-relative and comes from moduleRelativeTagName — the same
// rule the Tag Registry's "Generate Tag Defs" export uses, which the module's
// compiled names are generated from (tag_registry_spec §12.1).

import type { TagDef } from '@caro/hmi-context';
import { moduleRelativeTagName } from '@caro/tag-registry-shared';

export interface TagListEntry {
  tag_id:      number;
  tag_name:    string;
  is_setpoint: boolean;
}

export interface TagListResult {
  /** Entries for the module, ordered by tag_id. */
  tags: TagListEntry[];
  /** tag_ids of the module left out because they have no module-relative name. */
  skipped: number[];
}

export function buildTagList(tagMap: Map<number, TagDef>, moduleId: string): TagListResult {
  const tags: TagListEntry[] = [];
  const skipped: number[] = [];

  for (const tag of tagMap.values()) {
    if (tag.module_id !== moduleId) continue;
    const tagName = moduleRelativeTagName(tag.meta);
    if (!tagName) {
      skipped.push(tag.tag_id);
      continue;
    }
    tags.push({ tag_id: tag.tag_id, tag_name: tagName, is_setpoint: tag.is_setpoint });
  }

  tags.sort((a, b) => a.tag_id - b.tag_id);
  skipped.sort((a, b) => a - b);
  return { tags, skipped };
}
