import { renderHook, act } from '@testing-library/react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { useLiveValue } from '../hooks/useLiveValue.js';
import type { LiveValue } from '../types.js';
import { mockTag, mockBoolTag } from './fixtures.js';

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
});
