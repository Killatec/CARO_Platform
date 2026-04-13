import { describe, it, expect } from 'vitest';
import { compileFormat, resolveFormat } from '../shared/utils.js';
import type { TagDef } from '@caro/hmi-context';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTag(metaFields: Record<string, unknown>[]): TagDef {
  return {
    tag_id:      1,
    tag_path:    'X.Y',
    data_type:   'f32',
    is_setpoint: false,
    module_id:   'X',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    meta: metaFields.map((fields, i) => ({
      type:   i === 0 ? 'system' : 'tag',
      name:   String(i),
      fields,
    })),
  };
}

// ── compileFormat ─────────────────────────────────────────────────────────────

describe('compileFormat', () => {
  it('"#" formats 42.567 as "43"', () => {
    expect(compileFormat('#')(42.567)).toBe('43');
  });

  it('"#.#" formats 42.567 as "42.6"', () => {
    expect(compileFormat('#.#')(42.567)).toBe('42.6');
  });

  it('"#.##" formats 42.567 as "42.57"', () => {
    expect(compileFormat('#.##')(42.567)).toBe('42.57');
  });

  it('"#.###" formats 42.567 as "42.567"', () => {
    expect(compileFormat('#.###')(42.567)).toBe('42.567');
  });

  it('"#.####" formats 42.5 as "42.5000"', () => {
    expect(compileFormat('#.####')(42.5)).toBe('42.5000');
  });

  it('"#.##E+0" formats 12345.67 as toExponential(2)', () => {
    expect(compileFormat('#.##E+0')(12345.67)).toBe((12345.67).toExponential(2));
  });

  it('"#.#E+0" formats 12345.67 as toExponential(1)', () => {
    expect(compileFormat('#.#E+0')(12345.67)).toBe((12345.67).toExponential(1));
  });

  it('"#E+0" formats 12345.67 as toExponential(0)', () => {
    expect(compileFormat('#E+0')(12345.67)).toBe((12345.67).toExponential(0));
  });

  it('"invalid" returns "Format not valid"', () => {
    expect(compileFormat('invalid')(42)).toBe('Format not valid');
  });

  it('"" (empty string) returns "Format not valid"', () => {
    expect(compileFormat('')(42)).toBe('Format not valid');
  });

  it('"#.##e+0" (lowercase e) returns "Format not valid"', () => {
    expect(compileFormat('#.##e+0')(42)).toBe('Format not valid');
  });
});

// ── resolveFormat ─────────────────────────────────────────────────────────────

describe('resolveFormat', () => {
  it('string format in meta → uses compileFormat with that string', () => {
    const tag = makeTag([{ format: '#.###' }]);
    expect(resolveFormat(tag)(42.5)).toBe('42.500');
  });

  it('number format in meta (backward compat) → treats as decimal count', () => {
    const tag = makeTag([{ format: 3 }]);
    expect(resolveFormat(tag)(42.5)).toBe('42.500');
  });

  it('no format field → defaults to "#.##"', () => {
    const tag = makeTag([{}]);
    expect(resolveFormat(tag)(42.567)).toBe('42.57');
  });

  it('root-level format wins over leaf-level', () => {
    const tag = makeTag([{ format: '#.#' }, { format: '#.####' }]);
    expect(resolveFormat(tag)(42.567)).toBe('42.6');
  });
});
