import { useEffect, useState } from 'react';
import type { LiveValue } from '../types.js';
import { useHmiContext } from './useHmiContext.js';

export function useLiveValue(tagId: number): LiveValue {
  const ctx = useHmiContext();
  const [liveValue, setLiveValue] = useState<LiveValue>(() => ctx.getLiveValue(tagId));

  useEffect(() => {
    // subscribeLiveValue calls back synchronously with the current value, reconciling
    // any value that changed between the useState initializer and this effect firing.
    const unsubscribe = ctx.subscribeLiveValue(tagId, setLiveValue);
    return unsubscribe;
  }, [tagId, ctx]);

  return liveValue;
}
