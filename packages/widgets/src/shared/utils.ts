import type { TagDef } from '@caro/hmi-context';

/**
 * Walk tag.meta from meta[0] (root) forward.
 * Return the first numeric "format" field found.
 * Lowest level (closest to root) wins. Default 2.
 */
export function resolveDecimalPlaces(tag: TagDef): number {
  for (const level of tag.meta) {
    if (typeof level.fields['format'] === 'number') {
      return level.fields['format'] as number;
    }
  }
  return 2;
}

/**
 * If labelOverride is provided, return it.
 * Otherwise return the last dot-separated segment of assetPath.
 */
export function resolveLabel(assetPath: string, labelOverride?: string): string {
  if (labelOverride !== undefined) return labelOverride;
  const segs = assetPath.split('.');
  return segs[segs.length - 1];
}
