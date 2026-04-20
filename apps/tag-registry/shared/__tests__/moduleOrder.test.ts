import { describe, it, expect } from 'vitest';
import { getModuleNames } from '../moduleOrder.js';

function makeTag(tag_id: number, module_id: string) {
  return { tag_id, module_id };
}

describe('getModuleNames', () => {
  it('returns [] for an empty tagMap', () => {
    expect(getModuleNames(new Map())).toEqual([]);
  });

  it('returns the single module id for a one-entry tagMap', () => {
    const tagMap = new Map([[1, makeTag(1, 'RF')]]);
    expect(getModuleNames(tagMap)).toEqual(['RF']);
  });

  it('returns modules ordered by their minimum tag_id', () => {
    const tagMap = new Map([
      [10, makeTag(10, 'POW')],
      [5,  makeTag(5,  'RF')],
      [20, makeTag(20, 'COOL')],
    ]);
    expect(getModuleNames(tagMap)).toEqual(['RF', 'POW', 'COOL']);
  });

  it('uses the minimum tag_id when a module spans multiple tags', () => {
    // RF has tags 5 and 3 → min is 3; POW has tags 10 and 2 → min is 2
    const tagMap = new Map([
      [5,  makeTag(5,  'RF')],
      [10, makeTag(10, 'POW')],
      [3,  makeTag(3,  'RF')],
      [2,  makeTag(2,  'POW')],
    ]);
    // POW min=2, RF min=3 → order: POW, RF
    expect(getModuleNames(tagMap)).toEqual(['POW', 'RF']);
  });

  it('handles interleaved tag_ids across two modules', () => {
    // A: 1, 3, 5 → min 1; B: 2, 4, 6 → min 2
    const tagMap = new Map([
      [1, makeTag(1, 'A')],
      [2, makeTag(2, 'B')],
      [3, makeTag(3, 'A')],
      [4, makeTag(4, 'B')],
      [5, makeTag(5, 'A')],
      [6, makeTag(6, 'B')],
    ]);
    expect(getModuleNames(tagMap)).toEqual(['A', 'B']);
  });

  it('deduplicates module ids — each appears exactly once', () => {
    const tagMap = new Map([
      [1, makeTag(1, 'RF')],
      [2, makeTag(2, 'RF')],
      [3, makeTag(3, 'RF')],
    ]);
    expect(getModuleNames(tagMap)).toEqual(['RF']);
  });
});
