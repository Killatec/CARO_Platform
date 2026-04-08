import { useEffect, useState } from 'react';
import type { LiveValue } from '../types.js';
import { useHmiContext } from './useHmiContext.js';

export function useLiveValue(tagId: number): LiveValue {
  const ctx = useHmiContext();
  const [liveValue, setLiveValue] = useState<LiveValue>(() => ctx.getLiveValue(tagId));

  useEffect(() => {
    // Sync to current value when tagId changes (may have updated since mount)
    setLiveValue(ctx.getLiveValue(tagId));
    const unsubscribe = ctx.subscribeLiveValue(tagId, setLiveValue);
    return unsubscribe;
  }, [tagId, ctx]);

  return liveValue;
}
