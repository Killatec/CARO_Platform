import type { TagDef } from '@caro/hmi-context';

/**
 * Returns the [min, max] for a tag's Y-scale per spec §8.1.1:
 * - Boolean → [-0.5, 1.5]
 * - Numeric with engineering range → [eng_min, eng_max]
 * - Numeric without engineering range → null (caller enables autoscale)
 */
export function defaultYScale(tag: TagDef): [number, number] | null {
  if (tag.data_type === 'bool') return [-0.5, 1.5];
  if (tag.eng_min !== null && tag.eng_max !== null) return [tag.eng_min, tag.eng_max];
  return null;
}
