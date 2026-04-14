import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { HmiContext } from './HmiContext.js';
import type { HmiContextValue, LiveValue, TagDef, WsStats } from './types.js';

interface MockHmiProviderProps {
  children: ReactNode;
  tagValues?: Record<number, LiveValue>;
  tagDefs?: Record<number, TagDef>;
  onWrite?: (tagId: number, value: number | boolean | string) => Promise<void>;
}

export function MockHmiProvider({
  children,
  tagValues = {},
  tagDefs = {},
  onWrite,
}: MockHmiProviderProps) {
  const valuesRef = useRef<Record<number, LiveValue>>(tagValues);
  const prevTagValuesRef = useRef<Record<number, LiveValue>>(tagValues);
  const subscribersRef = useRef<Map<number, Set<(lv: LiveValue) => void>>>(new Map());

  // Sync tagValues prop to internal ref each render; notify subscribers for changed entries.
  useEffect(() => {
    const prev = prevTagValuesRef.current;
    const curr = tagValues;

    valuesRef.current = curr;
    prevTagValuesRef.current = curr;

    const allIds = new Set([
      ...Object.keys(prev).map(Number),
      ...Object.keys(curr).map(Number),
    ]);

    for (const id of allIds) {
      const prevLv = prev[id];
      const currLv = curr[id];
      if (prevLv === currLv) continue;
      if (
        prevLv !== undefined &&
        currLv !== undefined &&
        prevLv.value === currLv.value
      ) continue;

      const lv: LiveValue = currLv ?? { value: null };
      subscribersRef.current.get(id)?.forEach(cb => cb(lv));
    }
  }, [tagValues]);

  const tagMap = useMemo(
    () => new Map(Object.entries(tagDefs).map(([k, v]) => [Number(k), v])),
    [tagDefs]
  );

  const getLiveValue = useCallback(
    (tagId: number): LiveValue => valuesRef.current[tagId] ?? { value: null },
    []
  );

  const subscribeLiveValue = useCallback(
    (tagId: number, callback: (lv: LiveValue) => void): (() => void) => {
      if (!subscribersRef.current.has(tagId)) {
        subscribersRef.current.set(tagId, new Set());
      }
      subscribersRef.current.get(tagId)!.add(callback);
      return () => {
        subscribersRef.current.get(tagId)?.delete(callback);
      };
    },
    []
  );

  const writeTag = useCallback(
    (tagId: number, value: number | boolean | string): Promise<void> => {
      if (onWrite) return onWrite(tagId, value);
      return Promise.resolve();
    },
    [onWrite]
  );

  const mockWsStats: WsStats = useMemo(
    () => ({ connected: true, latencyMs: null, messagesPerSec: 0, bytesPerSec: 0, subscribedCount: 0 }),
    []
  );

  const contextValue = useMemo<HmiContextValue>(
    () => ({ tagMap, getLiveValue, subscribeLiveValue, writeTag, wsStats: mockWsStats }),
    [tagMap, getLiveValue, subscribeLiveValue, writeTag, mockWsStats]
  );

  return <HmiContext.Provider value={contextValue}>{children}</HmiContext.Provider>;
}
