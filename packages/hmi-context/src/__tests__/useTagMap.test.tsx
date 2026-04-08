import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { useTagMap } from '../hooks/useTagMap.js';
import { mockTag, mockBoolTag } from './fixtures.js';

describe('useTagMap', () => {
  it('returns empty Map when no tagDefs provided', () => {
    const { result } = renderHook(() => useTagMap(), {
      wrapper: ({ children }) => <MockHmiProvider>{children}</MockHmiProvider>,
    });
    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
  });

  it('returns Map with all provided tags', () => {
    const tagDefs = { 1001: mockTag, 1004: mockBoolTag };
    const { result } = renderHook(() => useTagMap(), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={tagDefs}>{children}</MockHmiProvider>
      ),
    });
    expect(result.current.size).toBe(2);
    expect(result.current.has(1001)).toBe(true);
    expect(result.current.has(1004)).toBe(true);
  });

  it('map entries have correct TagDef shape', () => {
    const { result } = renderHook(() => useTagMap(), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }}>{children}</MockHmiProvider>
      ),
    });
    const tag = result.current.get(1001);
    expect(tag).toBeDefined();
    expect(tag!.tag_id).toBe(1001);
    expect(tag!.tag_path).toBe('Plant1.Module.RF_Fwd.setpoint');
    expect(tag!.data_type).toBe('f64');
    expect(tag!.is_setpoint).toBe(true);
    expect(tag!.unit).toBe('W');
  });
});
