import { useEffect, useState } from 'react';
import type { LiveValue } from '../types.js';
import { useHmiContext } from './useHmiContext.js';

/**
 * tagId may be undefined — an asset path that legitimately doesn't resolve in this
 * registry (e.g. an optional diagnostic subtree). Absence is a non-event: no
 * subscription, no wire traffic, and the hook returns { value: null }.
 */
export function useLiveValue(tagId: number | undefined): LiveValue {
  const ctx = useHmiContext();
  const [liveValue, setLiveValue] = useState<LiveValue>(() =>
    tagId === undefined ? { value: null } : ctx.getLiveValue(tagId)
  );

  useEffect(() => {
    // subscribeLiveValue calls back synchronously with the current value, reconciling
    // any value that changed between the useState initializer and this effect firing.
    const unsubscribe = ctx.subscribeLiveValue(tagId, setLiveValue);
    return unsubscribe;
  }, [tagId, ctx]);

  return liveValue;
}
