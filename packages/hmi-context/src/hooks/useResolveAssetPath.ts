import { useMemo } from 'react';
import type { TagDef } from '../types.js';
import { useHmiContext } from './useHmiContext.js';

export function useResolveAssetPath(assetPath: string): TagDef[] {
  const ctx = useHmiContext();

  return useMemo(() => {
    return ctx.tagPathIndex.resolve(assetPath);
  }, [assetPath, ctx]);
}
