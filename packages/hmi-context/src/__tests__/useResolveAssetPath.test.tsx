import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '../MockHmiProvider.js';
import { useResolveAssetPath } from '../hooks/useResolveAssetPath.js';
import type { TagDef } from '../types.js';

// Test fixtures: two parameter groups (RF_Fwd and RF_Rev), each with setpoint + monitor
const rfFwdSetpoint: TagDef = {
  tag_id: 1001,
  tag_path: 'Plant1.Module.RF_Fwd.setpoint',
  data_type: 'f32',
  is_setpoint: true,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'setpoint', fields: {} },
  ],
};

const rfFwdMonitor: TagDef = {
  tag_id: 1002,
  tag_path: 'Plant1.Module.RF_Fwd.monitor',
  data_type: 'f32',
  is_setpoint: false,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'monitor', fields: {} },
  ],
};

const rfRevSetpoint: TagDef = {
  tag_id: 1003,
  tag_path: 'Plant1.Module.RF_Rev.setpoint',
  data_type: 'f32',
  is_setpoint: true,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Rev', fields: {} },
    { type: 'tag', name: 'setpoint', fields: {} },
  ],
};

const rfRevMonitor: TagDef = {
  tag_id: 1004,
  tag_path: 'Plant1.Module.RF_Rev.monitor',
  data_type: 'f32',
  is_setpoint: false,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Rev', fields: {} },
    { type: 'tag', name: 'monitor', fields: {} },
  ],
};

const allTagDefs = {
  1001: rfFwdSetpoint,
  1002: rfFwdMonitor,
  1003: rfRevSetpoint,
  1004: rfRevMonitor,
};

function makeWrapper(tagDefs: Record<number, TagDef> = allTagDefs) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MockHmiProvider tagDefs={tagDefs}>{children}</MockHmiProvider>;
  };
}

describe('useResolveAssetPath', () => {
  it('returns empty array when no tags match', () => {
    const { result } = renderHook(() => useResolveAssetPath('NoMatch'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([]);
  });

  it('returns single tag for exact full path match', () => {
    const { result } = renderHook(
      () => useResolveAssetPath('Plant1.Module.RF_Fwd.setpoint'),
      { wrapper: makeWrapper() }
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].tag_id).toBe(1001);
  });

  it('returns single tag for abbreviated leaf path (RF_Fwd.setpoint)', () => {
    const { result } = renderHook(() => useResolveAssetPath('RF_Fwd.setpoint'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].tag_id).toBe(1001);
  });

  it('returns multiple tags for subtree match (RF_Fwd matches setpoint + monitor)', () => {
    const { result } = renderHook(() => useResolveAssetPath('RF_Fwd'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toHaveLength(2);
    const ids = result.current.map(t => t.tag_id).sort();
    expect(ids).toEqual([1001, 1002]);
  });

  it('returns multiple tags when segment matches across branches (setpoint matches RF_Fwd + RF_Rev)', () => {
    const { result } = renderHook(() => useResolveAssetPath('setpoint'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toHaveLength(2);
    const ids = result.current.map(t => t.tag_id).sort();
    expect(ids).toEqual([1001, 1003]);
  });

  it('does NOT match partial segment names (RF does not match RF_Fwd)', () => {
    const { result } = renderHook(() => useResolveAssetPath('RF'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([]);
  });

  it('handles single-segment assetPath (setpoint)', () => {
    const { result } = renderHook(() => useResolveAssetPath('setpoint'), {
      wrapper: makeWrapper(),
    });
    // Should match both RF_Fwd.setpoint and RF_Rev.setpoint
    expect(result.current.length).toBeGreaterThanOrEqual(2);
    expect(result.current.every(t => t.tag_path.endsWith('.setpoint'))).toBe(true);
  });
});
