import { describe, it, expect } from 'vitest';
import { compileFormat, resolveFormat } from '../shared/utils.js';
import type { TagDef } from '@caro/hmi-context';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTag(metaFields: Record<string, unknown>[]): TagDef {
  return {
    tag_id:      1,
    tag_path:    'X.Y',
    tag_name:    null,
    data_type:   'f32',
    is_setpoint: false,
    trendable:   true,
    module_id:   'X',
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
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
  it('tag.format = "#.###" → uses that format', () => {
    const tag = { ...makeTag([{}]), format: '#.###' };
    expect(resolveFormat(tag)(42.5)).toBe('42.500');
  });

  it('tag.format = null → defaults to "#.##"', () => {
    const tag = makeTag([{}]);
    expect(resolveFormat(tag)(42.567)).toBe('42.57');
  });

  it('regression: tag.format = null with string format in meta → meta ignored, defaults to "#.##"', () => {
    // resolveFormat must NOT walk meta — tag.format is the registry-resolved value.
    const tag = makeTag([{ format: '#.#' }]); // meta carries '#.#'; tag.format stays null
    expect(resolveFormat(tag)(42.567)).toBe('42.57');
  });

  it('regression: tag.format = null with numeric format in meta → meta ignored, defaults to "#.##"', () => {
    // resolveRegistry stores numeric meta formats as null (typeof check gates string-only).
    // resolveFormat must not apply the old numeric backward-compat path.
    const tag = makeTag([{ format: 3 }]); // meta carries numeric 3; tag.format stays null
    expect(resolveFormat(tag)(42.5)).toBe('42.50');
  });
});
