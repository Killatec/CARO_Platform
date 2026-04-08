import { useResolveAssetPath } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';

export function useSingleTag(assetPath: string, widgetName: string): TagDef {
  const tags = useResolveAssetPath(assetPath);
  if (tags.length === 0) {
    throw new Error(`${widgetName}: no tags found matching assetPath "${assetPath}"`);
  }
  if (tags.length > 1) {
    throw new Error(
      `${widgetName}: ambiguous assetPath "${assetPath}" matched ${tags.length} tags. ` +
      `Use a longer path to disambiguate. Matches: ${tags.map(t => t.tag_path).join(', ')}`
    );
  }
  return tags[0];
}
