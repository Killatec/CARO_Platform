import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { useLiveValue } from '../hooks/useLiveValue.js';
import { useTagMap } from '../hooks/useTagMap.js';
import { useTagWriter } from '../hooks/useTagWriter.js';
import { mockTag } from './fixtures.js';

describe('MockHmiProvider', () => {
  it('provides context — hooks do not throw', () => {
    expect(() => {
      renderHook(() => useLiveValue(1001), {
        wrapper: ({ children }) => <MockHmiProvider>{children}</MockHmiProvider>,
      });
    }).not.toThrow();
  });

  it('getLiveValue returns seeded values', () => {
    const tagValues = { 1001: { value: 500 } };
    const { result } = renderHook(() => useLiveValue(1001), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }} tagValues={tagValues}>
          {children}
        </MockHmiProvider>
      ),
    });
    expect(result.current.value).toBe(500);
  });

  it('writeTag calls onWrite prop', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTagWriter(), {
      wrapper: ({ children }) => (
        <MockHmiProvider onWrite={onWrite}>{children}</MockHmiProvider>
      ),
    });

    await act(async () => {
      await result.current.write(1001, 42);
    });

    expect(onWrite).toHaveBeenCalledOnce();
    expect(onWrite).toHaveBeenCalledWith(1001, 42);
  });

  it('default write resolves when onWrite not provided', async () => {
    const { result } = renderHook(() => useTagWriter(), {
      wrapper: ({ children }) => <MockHmiProvider>{children}</MockHmiProvider>,
    });

    await expect(
      act(async () => {
        await result.current.write(1001, 99);
      })
    ).resolves.not.toThrow();

    expect(result.current.isPending(1001)).toBe(false);
    expect(result.current.error(1001)).toBeNull();
  });

  it('returns correct tagMap from tagDefs', () => {
    const { result } = renderHook(() => useTagMap(), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }}>{children}</MockHmiProvider>
      ),
    });
    expect(result.current.get(1001)).toBe(mockTag);
  });
});
