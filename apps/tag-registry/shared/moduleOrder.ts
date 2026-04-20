/** Minimal tag shape needed for module ordering — avoids a circular dep on @caro/hmi-context. */
interface TagEntry {
  tag_id: number;
  module_id: string;
}

/**
 * Returns unique module_id values ordered by the minimum tag_id observed per module.
 *
 * Ordering rule: modules are sorted by the smallest tag_id among their tags.
 * Commissioning order becomes display order; new modules append; existing indices
 * never shift.
 */
export function getModuleNames(tagMap: Map<number, TagEntry>): string[] {
  const firstSeen = new Map<string, number>();
  for (const tag of tagMap.values()) {
    const current = firstSeen.get(tag.module_id);
    if (current === undefined || tag.tag_id < current) {
      firstSeen.set(tag.module_id, tag.tag_id);
    }
  }
  return [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([moduleId]) => moduleId);
}
