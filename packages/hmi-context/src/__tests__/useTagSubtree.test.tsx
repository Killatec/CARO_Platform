import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { useTagSubtree } from '../hooks/useTagSubtree.js';
import { mockTag, mockReadbackTag, mockBoolTag } from './fixtures.js';

describe('useTagSubtree', () => {
  it('returns null when no tags match prefix', () => {
    const { result } = renderHook(() => useTagSubtree('NonExistent'), {
      wrapper: ({ children }) => <MockHmiProvider>{children}</MockHmiProvider>,
    });
    expect(result.current).toBeNull();
  });

  it('builds correct tree for Plant1.Module.RF_Fwd with 3 child tags', () => {
    const tagDefs = { 1001: mockTag, 1002: mockReadbackTag, 1004: mockBoolTag };
    const { result } = renderHook(() => useTagSubtree('Plant1.Module.RF_Fwd'), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={tagDefs}>{children}</MockHmiProvider>
      ),
    });
    const node = result.current;
    expect(node).not.toBeNull();
    expect(node!.name).toBe('RF_Fwd');
    expect(node!.type).toBe('parameter');
    expect(node!.tag).toBeNull();
    expect(node!.children).not.toBeNull();
    expect(Object.keys(node!.children!)).toHaveLength(3);
  });

  it('leaf nodes have tag set, children null', () => {
    const { result } = renderHook(() => useTagSubtree('Plant1.Module.RF_Fwd'), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }}>{children}</MockHmiProvider>
      ),
    });
    const node = result.current;
    expect(node).not.toBeNull();
    const leaf = node!.children!['setpoint'];
    expect(leaf).toBeDefined();
    expect(leaf.tag).toBe(mockTag);
    expect(leaf.children).toBeNull();
  });

  it('structural nodes have children set, tag null', () => {
    const { result } = renderHook(() => useTagSubtree('Plant1'), {
      wrapper: ({ children }) => (
        <MockHmiProvider tagDefs={{ 1001: mockTag }}>{children}</MockHmiProvider>
      ),
    });
    const root = result.current; // Plant1
    expect(root).not.toBeNull();
    expect(root!.tag).toBeNull();
    expect(root!.children).not.toBeNull();

    const moduleNode = root!.children!['Module'];
    expect(moduleNode).toBeDefined();
    expect(moduleNode.tag).toBeNull();
    expect(moduleNode.children).not.toBeNull();

    const rfFwdNode = moduleNode.children!['RF_Fwd'];
    expect(rfFwdNode).toBeDefined();
    expect(rfFwdNode.tag).toBeNull();
    expect(rfFwdNode.children).not.toBeNull();
  });
});
