import { describe, it, expect } from 'vitest';
import { collectDescendantTemplateNames } from './dragTypes.js';
import type { TemplateEntry } from '@caro/tag-registry-shared';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(
  template_name: string,
  children: Array<{ template_name: string; asset_name: string }> = []
): TemplateEntry {
  return {
    template: {
      template_name,
      template_type: 'parameter',
      fields: {},
      children: children.map(c => ({ ...c, fields: {} })),
    },
    hash: null,
  };
}

function child(template_name: string, asset_name = template_name) {
  return { template_name, asset_name };
}

// ── collectDescendantTemplateNames ────────────────────────────────────────────

describe('collectDescendantTemplateNames', () => {
  it('includes the start template itself', () => {
    const map = new Map([['A', makeEntry('A')]]);
    expect(collectDescendantTemplateNames('A', map)).toEqual(new Set(['A']));
  });

  it('collects a linear chain of descendants', () => {
    const map = new Map([
      ['A', makeEntry('A', [child('B')])],
      ['B', makeEntry('B', [child('C')])],
      ['C', makeEntry('C')],
    ]);
    expect(collectDescendantTemplateNames('A', map)).toEqual(new Set(['A', 'B', 'C']));
  });

  it('does not include ancestors or unrelated templates', () => {
    const map = new Map([
      ['Root', makeEntry('Root', [child('A'), child('Unrelated')])],
      ['A', makeEntry('A', [child('B')])],
      ['B', makeEntry('B')],
      ['Unrelated', makeEntry('Unrelated')],
    ]);
    expect(collectDescendantTemplateNames('A', map)).toEqual(new Set(['A', 'B']));
  });

  it('handles a diamond (shared template referenced twice) without infinite looping', () => {
    const map = new Map([
      ['A', makeEntry('A', [child('B'), child('C')])],
      ['B', makeEntry('B', [child('D')])],
      ['C', makeEntry('C', [child('D')])],
      ['D', makeEntry('D')],
    ]);
    expect(collectDescendantTemplateNames('A', map)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('terminates on a pre-existing cycle instead of looping forever', () => {
    const map = new Map([
      ['A', makeEntry('A', [child('B')])],
      ['B', makeEntry('B', [child('A')])],
    ]);
    expect(collectDescendantTemplateNames('A', map)).toEqual(new Set(['A', 'B']));
  });

  it('ignores references to templates not present in the map', () => {
    const map = new Map([
      ['A', makeEntry('A', [child('Ghost')])],
    ]);
    expect(collectDescendantTemplateNames('A', map)).toEqual(new Set(['A', 'Ghost']));
  });
});
