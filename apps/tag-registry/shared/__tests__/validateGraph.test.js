import { describe, it, expect } from 'vitest';
import { validateGraph } from '../validateGraph.js';
import { ERROR_CODES } from '../constants.js';

// Helper: wrap a template in the { template, hash } envelope
function wrap(template) {
  return { template, hash: 'aabbcc' };
}

function makeTemplate(name, type = 'parameter', children = []) {
  return { template_type: type, template_name: name, fields: {}, children };
}

// ── Valid cases ──────────────────────────────────────────────────────────────

describe('valid graphs', () => {
  it('null input → valid with empty arrays', () => {
    const r = validateGraph(null);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('empty plain object → valid', () => {
    expect(validateGraph({}).valid).toBe(true);
  });

  it('single template with no children → valid', () => {
    const map = { A: wrap(makeTemplate('A')) };
    expect(validateGraph(map).valid).toBe(true);
  });

  it('two templates, A references B as child → valid', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [{ template_name: 'B', asset_name: 'b', fields: {} }])),
      B: wrap(makeTemplate('B', 'tag')),
    };
    expect(validateGraph(map).valid).toBe(true);
  });

  it('three-level chain A → B → C → valid', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [{ template_name: 'B', asset_name: 'b', fields: {} }])),
      B: wrap(makeTemplate('B', 'parameter', [{ template_name: 'C', asset_name: 'c', fields: {} }])),
      C: wrap(makeTemplate('C', 'tag')),
    };
    expect(validateGraph(map).valid).toBe(true);
  });

  it('accepts Map input as well as plain object', () => {
    const templateMap = new Map([
      ['A', wrap(makeTemplate('A', 'module', [{ template_name: 'B', asset_name: 'b', fields: {} }]))],
      ['B', wrap(makeTemplate('B', 'tag'))],
    ]);
    expect(validateGraph(templateMap).valid).toBe(true);
  });
});

// ── INVALID_REFERENCE ────────────────────────────────────────────────────────

describe('INVALID_REFERENCE', () => {
  it('template A references nonexistent child → invalid', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [{ template_name: 'nonexistent', asset_name: 'ch', fields: {} }])),
    };
    const r = validateGraph(map);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.INVALID_REFERENCE)).toBe(true);
  });

  it('two broken references in same template → two INVALID_REFERENCE errors', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [
        { template_name: 'ghost1', asset_name: 'ch1', fields: {} },
        { template_name: 'ghost2', asset_name: 'ch2', fields: {} },
      ])),
    };
    const r = validateGraph(map);
    const refs = r.errors.filter(e => e.code === ERROR_CODES.INVALID_REFERENCE);
    expect(refs).toHaveLength(2);
  });
});

// ── CIRCULAR_REFERENCE ───────────────────────────────────────────────────────

describe('CIRCULAR_REFERENCE', () => {
  it('A → B → A (2-cycle) → invalid', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [{ template_name: 'B', asset_name: 'b', fields: {} }])),
      B: wrap(makeTemplate('B', 'parameter', [{ template_name: 'A', asset_name: 'a', fields: {} }])),
    };
    const r = validateGraph(map);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.CIRCULAR_REFERENCE)).toBe(true);
  });

  it('A → B → C → A (3-cycle) → invalid', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [{ template_name: 'B', asset_name: 'b', fields: {} }])),
      B: wrap(makeTemplate('B', 'parameter', [{ template_name: 'C', asset_name: 'c', fields: {} }])),
      C: wrap(makeTemplate('C', 'tag', [{ template_name: 'A', asset_name: 'a', fields: {} }])),
    };
    const r = validateGraph(map);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.CIRCULAR_REFERENCE)).toBe(true);
  });

  it('self-reference: A → A → invalid', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [{ template_name: 'A', asset_name: 'self', fields: {} }])),
    };
    const r = validateGraph(map);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.CIRCULAR_REFERENCE)).toBe(true);
  });
});

// ── Multiple errors ───────────────────────────────────────────────────────────

describe('multiple errors', () => {
  it('one broken ref + one cycle → both error codes present', () => {
    const map = {
      A: wrap(makeTemplate('A', 'module', [
        { template_name: 'ghost', asset_name: 'ch1', fields: {} },
        { template_name: 'B',     asset_name: 'ch2', fields: {} },
      ])),
      B: wrap(makeTemplate('B', 'parameter', [{ template_name: 'A', asset_name: 'a', fields: {} }])),
    };
    const r = validateGraph(map);
    expect(r.errors.some(e => e.code === ERROR_CODES.INVALID_REFERENCE)).toBe(true);
    expect(r.errors.some(e => e.code === ERROR_CODES.CIRCULAR_REFERENCE)).toBe(true);
  });
});
