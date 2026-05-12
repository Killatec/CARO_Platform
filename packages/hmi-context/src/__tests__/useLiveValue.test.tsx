import { renderHook, act } from '@testing-library/react';
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { HmiDataContext, HmiStatsContext } from '../HmiContext.js';
import { buildTagPathIndex } from '../tagPathIndex.js';
import { useLiveValue } from '../hooks/useLiveValue.js';
import type { HmiDataContextValue, LiveValue, WsStats } from '../types.js';
import { mockTag, mockBoolTag } from './fixtures.js';

const mockWsStats: WsStats = {
  connected: false, latencyMs: null, messagesPerSec: 0, bytesPerSec: 0, subscribedCount: 0,
};

describe('useLiveValue', () => {
  it('returns { value: null } when tag not in tagValues', () => {
    const { result } = renderHook(() => useLiveValue(1001), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }}>{children}</MockHmiProvider>
      ),
    });
    expect(result.current).toEqual({ value: null });
  });

  it('returns seeded value when tag is in tagValues', () => {
    const tagValues = { 1001: { value: 1234.5 } };
    const { result } = renderHook(() => useLiveValue(1001), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }} tagValues={tagValues}>
          {children}
        </MockHmiProvider>
      ),
    });
    expect(result.current).toEqual({ value: 1234.5 });
  });

  it('updates when MockHmiProvider tagValues prop changes', async () => {
    let setTagValues!: (vals: Record<number, LiveValue>) => void;

    function Wrapper({ children }: { children: React.ReactNode }) {
      const [tagValues, setVals] = useState<Record<number, LiveValue>>({
        1001: { value: 42 },
      });
      setTagValues = setVals;
      return (
        <MockHmiProvider tagDefs={{ 1001: mockTag }} tagValues={tagValues}>
          {children}
        </MockHmiProvider>
      );
    }

    const { result } = renderHook(() => useLiveValue(1001), { wrapper: Wrapper });
    expect(result.current.value).toBe(42);

    await act(async () => {
      setTagValues({ 1001: { value: 99 } });
    });

    expect(result.current.value).toBe(99);
  });

  it('does not update state when a different tag changes', async () => {
    let setTagValues!: Dispatch<SetStateAction<Record<number, LiveValue>>>;

    function Wrapper({ children }: { children: React.ReactNode }) {
      const [tagValues, setVals] = useState<Record<number, LiveValue>>({
        1001: { value: 42 },
        1004: { value: true },
      });
      setTagValues = setVals;
      return (
        <MockHmiProvider tagDefs={{ 1001: mockTag, 1004: mockBoolTag }} tagValues={tagValues}>
          {children}
        </MockHmiProvider>
      );
    }

    const { result } = renderHook(() => useLiveValue(1001), { wrapper: Wrapper });
    expect(result.current.value).toBe(42);

    await act(async () => {
      // Change tag 1004, keep tag 1001 the same (same object)
      setTagValues(prev => ({ ...prev, 1004: { value: false } }));
    });

    // Tag 1001 value should be unchanged
    expect(result.current.value).toBe(42);
  });

  it('reconciles value via synchronous subscribeLiveValue callback when value changes before effect fires', () => {
    // getLiveValue returns stale null (what useState seeds); subscribeLiveValue delivers
    // the real value synchronously. Without the synchronous callback, the hook would be
    // stuck at null until the next external push.
    const freshValue: LiveValue = { value: 999 };

    function SyncCallbackProvider({ children }: { children: React.ReactNode }) {
      const getLiveValue = useCallback((_tagId: number): LiveValue => ({ value: null }), []);
      const subscribeLiveValue = useCallback(
        (_tagId: number, callback: (lv: LiveValue) => void): (() => void) => {
          callback(freshValue);
          return () => {};
        },
        []
      );
      const writeTag = useCallback(async () => {}, []);
      const subscribeTrend = useCallback(() => () => {}, []);
      const dataValue = useMemo<HmiDataContextValue>(
        () => ({
          tagMap: new Map(),
          tagPathIndex: buildTagPathIndex([]),
          getLiveValue,
          subscribeLiveValue,
          subscribeTrend,
          writeTag,
        }),
        [getLiveValue, subscribeLiveValue, subscribeTrend, writeTag]
      );

      return (
        <HmiDataContext.Provider value={dataValue}>
          <HmiStatsContext.Provider value={mockWsStats}>
            {children}
          </HmiStatsContext.Provider>
        </HmiDataContext.Provider>
      );
    }

    const { result } = renderHook(() => useLiveValue(1001), { wrapper: SyncCallbackProvider });
    expect(result.current.value).toBe(999);
  });
});
