import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { HmiDataContext, HmiStatsContext } from './HmiContext.js';
import { buildTagPathIndex } from './tagPathIndex.js';
import type { HmiDataContextValue, LiveValue, TagDef, WsStats } from './types.js';

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

  const tagPathIndex = useMemo(
    () => buildTagPathIndex(tagMap.values()),
    [tagMap]
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
      // Synchronously deliver current value — mirrors HmiContextProvider behavior.
      callback(valuesRef.current[tagId] ?? { value: null });
      return () => {
        subscribersRef.current.get(tagId)?.delete(callback);
      };
    },
    []
  );

  const subscribeTrend = useCallback(
    (_tagId: number, _callback: (moduleTs: number, value: number | boolean | string | null) => void): (() => void) => {
      return () => {};
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

  const dataValue = useMemo<HmiDataContextValue>(
    () => ({ tagMap, tagPathIndex, getLiveValue, subscribeLiveValue, subscribeTrend, writeTag }),
    [tagMap, tagPathIndex, getLiveValue, subscribeLiveValue, subscribeTrend, writeTag]
  );

  return (
    <HmiDataContext.Provider value={dataValue}>
      <HmiStatsContext.Provider value={mockWsStats}>
        {children}
      </HmiStatsContext.Provider>
    </HmiDataContext.Provider>
  );
}
