import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import type { TagDef } from '@caro/hmi-context';
import { useTagGroup } from '../shared/useTagGroup.js';
import { prfTagDefs, prfSetTag } from './fixtures.js';

const CHILDREN = ['Set', 'Mon', 'Tol', 'By', 'Intk', 'RSS', 'Per', 'In_A', 'In_B'];

function makeWrapper(tagDefs: Record<number, TagDef>) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(MockHmiProvider, { tagDefs, children });
}

describe('useTagGroup', () => {
  it('resolves all children correctly when tags exist', () => {
    const { result } = renderHook(
      () => useTagGroup('RF1.PRF', CHILDREN, 'AnalogIn'),
      { wrapper: makeWrapper(prfTagDefs) }
    );
    expect(Object.keys(result.current)).toHaveLength(9);
    expect(result.current['Set'].tag_id).toBe(2001);
    expect(result.current['Mon'].tag_id).toBe(2002);
    expect(result.current['Tol'].tag_id).toBe(2003);
    expect(result.current['By'].data_type).toBe('bool');
    expect(result.current['Intk'].data_type).toBe('bool');
    expect(result.current['RSS'].tag_id).toBe(2006);
    expect(result.current['Per'].tag_id).toBe(2007);
    expect(result.current['In_A'].tag_id).toBe(2008);
    expect(result.current['In_B'].tag_id).toBe(2009);
  });

  it('throws when a child tag has zero matches', () => {
    expect(() =>
      renderHook(
        () => useTagGroup('RF1.PRF', ['Set', 'Missing'], 'AnalogIn'),
        { wrapper: makeWrapper(prfTagDefs) }
      )
    ).toThrow('AnalogIn: no tag found for "RF1.PRF.Missing"');
  });

  it('throws when a child tag has multiple matches', () => {
    // Add a second tag whose path also contains "RF1.PRF.Set"
    const dupeTagDefs: Record<number, TagDef> = {
      ...prfTagDefs,
      2010: { ...prfSetTag, tag_id: 2010, tag_path: 'CARO_2.RF1.PRF.Set' },
    };
    expect(() =>
      renderHook(
        () => useTagGroup('RF1.PRF', ['Set'], 'AnalogIn'),
        { wrapper: makeWrapper(dupeTagDefs) }
      )
    ).toThrow(/AnalogIn: ambiguous match for "RF1\.PRF\.Set" \(2 matches\)/);
  });
});
