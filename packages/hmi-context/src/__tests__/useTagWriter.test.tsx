import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { useTagWriter } from '../hooks/useTagWriter.js';

describe('useTagWriter', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MockHmiProvider>{children}</MockHmiProvider>
  );

  it('isPending returns false initially', () => {
    const { result } = renderHook(() => useTagWriter(), { wrapper });
    expect(result.current.isPending(1001)).toBe(false);
  });

  it('isPending returns true during write, false after resolve', async () => {
    let resolveWrite!: () => void;
    const pendingPromise = new Promise<void>(resolve => {
      resolveWrite = resolve;
    });
    const onWrite = vi.fn().mockReturnValue(pendingPromise);

    const { result } = renderHook(() => useTagWriter(), {
      wrapper: ({ children }) => (
        <MockHmiProvider onWrite={onWrite}>{children}</MockHmiProvider>
      ),
    });

    act(() => {
      void result.current.write(1001, 42);
    });

    expect(result.current.isPending(1001)).toBe(true);

    await act(async () => {
      resolveWrite();
      await pendingPromise;
    });

    expect(result.current.isPending(1001)).toBe(false);
  });

  it('error is set when write rejects', async () => {
    const onWrite = vi.fn().mockRejectedValue(new Error('write failed'));

    const { result } = renderHook(() => useTagWriter(), {
      wrapper: ({ children }) => (
        <MockHmiProvider onWrite={onWrite}>{children}</MockHmiProvider>
      ),
    });

    await act(async () => {
      await result.current.write(1001, 99).catch(() => {/* swallow */});
    });

    expect(result.current.error(1001)).toBe('write failed');
    expect(result.current.isPending(1001)).toBe(false);
  });

  it('error clears on next write attempt', async () => {
    let callCount = 0;
    const onWrite = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('first fail'));
      return Promise.resolve();
    });

    const { result } = renderHook(() => useTagWriter(), {
      wrapper: ({ children }) => (
        <MockHmiProvider onWrite={onWrite}>{children}</MockHmiProvider>
      ),
    });

    // First write fails
    await act(async () => {
      await result.current.write(1001, 1).catch(() => {/* swallow */});
    });
    expect(result.current.error(1001)).toBe('first fail');

    // Start second write — error should clear
    await act(async () => {
      await result.current.write(1001, 2);
    });
    expect(result.current.error(1001)).toBeNull();
  });

  it('concurrent writes to different tags track independently', async () => {
    let resolve1001!: () => void;
    let resolve1002!: () => void;
    const p1001 = new Promise<void>(r => { resolve1001 = r; });
    const p1002 = new Promise<void>(r => { resolve1002 = r; });

    const onWrite = vi.fn().mockImplementation((tagId: number) => {
      if (tagId === 1001) return p1001;
      return p1002;
    });

    const { result } = renderHook(() => useTagWriter(), {
      wrapper: ({ children }) => (
        <MockHmiProvider onWrite={onWrite}>{children}</MockHmiProvider>
      ),
    });

    act(() => {
      void result.current.write(1001, 1);
      void result.current.write(1002, 2);
    });

    expect(result.current.isPending(1001)).toBe(true);
    expect(result.current.isPending(1002)).toBe(true);

    await act(async () => {
      resolve1001();
      await p1001;
    });

    expect(result.current.isPending(1001)).toBe(false);
    expect(result.current.isPending(1002)).toBe(true);

    await act(async () => {
      resolve1002();
      await p1002;
    });

    expect(result.current.isPending(1002)).toBe(false);
  });
});
