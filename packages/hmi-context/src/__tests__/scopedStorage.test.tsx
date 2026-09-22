import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { scopedKey, useScopedKey } from '../scopedStorage.js';
import { MockHmiProvider } from '../MockHmiProvider.js';

describe('scopedKey', () => {
  it('builds caro.<projectRoot>.<name>', () => {
    expect(scopedKey('Narya1', 'trend-viewer.session.default')).toBe(
      'caro.Narya1.trend-viewer.session.default',
    );
  });

  it('preserves case', () => {
    expect(scopedKey('CARO_1', 'foo')).toBe('caro.CARO_1.foo');
  });

  it('falls back to the unknown namespace when projectRoot is null', () => {
    expect(scopedKey(null, 'foo')).toBe('caro.unknown.foo');
  });
});

describe('useScopedKey', () => {
  it('reads projectRoot from context and builds the scoped key', () => {
    const { result } = renderHook(() => useScopedKey('foo'), {
      wrapper: ({ children }) => (
        <MockHmiProvider projectRoot="Narya1">{children}</MockHmiProvider>
      ),
    });
    expect(result.current).toBe('caro.Narya1.foo');
  });

  it('falls back to the unknown namespace when projectRoot is null', () => {
    const { result } = renderHook(() => useScopedKey('foo'), {
      wrapper: ({ children }) => (
        <MockHmiProvider projectRoot={null}>{children}</MockHmiProvider>
      ),
    });
    expect(result.current).toBe('caro.unknown.foo');
  });
});
