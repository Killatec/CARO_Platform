import { describe, it, expect } from 'vitest';
import { validateResolvedTags } from '../validateResolvedTags.js';
import { resolveRegistry } from '../resolveRegistry.js';
import { ERROR_CODES, MAX_TAG_NAME_LENGTH, IN_TAG_NAME_FIELD } from '../constants.js';
import type { Template, ResolvedTag } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTagTemplate(
  name: string,
  dataType: string,
  trends: boolean,
  isSetpoint: boolean,
): Template {
  return {
    template_name: name,
    template_type: 'tag',
    fields: {
      [IN_TAG_NAME_FIELD]: { field_type: 'Boolean',  default: true },
      data_type:           { field_type: 'TagType',  default: dataType },
      Trends:              { field_type: 'Boolean',  default: trends },
      is_setpoint:         { field_type: 'Boolean',  default: isSetpoint },
    },
    children: [],
  };
}

/**
 * Builds a minimal two-level template map (system → tag) and resolves it.
 * The parent system can override child tag fields via `childFieldOverrides`.
 */
function resolveWithOverride(
  dataTypeDefault: string,
  trends: boolean,
  isSetpoint: boolean,
  childFieldOverrides: Record<string, unknown> = {},
): ResolvedTag[] {
  const tagTemplate = makeTagTemplate('MyTag', dataTypeDefault, trends, isSetpoint);

  const systemTemplate: Template = {
    template_name: 'SYS',
    template_type: 'system',
    fields: {},
    children: [
      {
        template_name: 'MyTag',
        asset_name:    'Tag1',
        fields:        childFieldOverrides as Record<string, unknown>,
      },
    ],
  };

  const templateMap = new Map<string, Template>([
    ['SYS',   systemTemplate],
    ['MyTag', tagTemplate],
  ]);

  return resolveRegistry(templateMap, 'SYS');
}

// ── Post-resolution validation ─────────────────────────────────────────────────

describe('validateResolvedTags — trends rule', () => {
  it('rejects a tag where parent override changed data_type to f32[] but trends is true', () => {
    // Template default: f32 + trends:true — passes template validation
    // Parent override:  data_type → f32[]  — now illegal at resolution time
    const tags = resolveWithOverride('f32', true, false, { data_type: 'f32[]' });
    expect(tags).toHaveLength(1);
    expect(tags[0].data_type).toBe('f32[]');
    expect(tags[0].trends).toBe(true);

    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ref?.tag_path).toBe('SYS.Tag1');
    expect(result.errors[0].message).toContain('trends');
    expect(result.errors[0].message).toContain('f32[]');
  });

  it('rejects trends:true on i16[] from parent override', () => {
    const tags = resolveWithOverride('f32', true, false, { data_type: 'i16[]' });
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors[0].ref?.tag_path).toBe('SYS.Tag1');
  });

  it('accepts trends:true on f32 (no override)', () => {
    const tags = resolveWithOverride('f32', true, false);
    expect(tags[0].data_type).toBe('f32');
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts trends:true on bool (bool is now trendable)', () => {
    const tags = resolveWithOverride('bool', true, false);
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
  });

  it('accepts trends:false on f32[] (no trends, no problem)', () => {
    const tags = resolveWithOverride('f32', false, false, { data_type: 'f32[]' });
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
  });
});

describe('validateResolvedTags — is_setpoint rule', () => {
  it('rejects a tag where parent override changed data_type to i16[] but is_setpoint is true', () => {
    const tags = resolveWithOverride('f32', false, true, { data_type: 'i16[]' });
    expect(tags[0].data_type).toBe('i16[]');
    expect(tags[0].is_setpoint).toBe(true);

    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ref?.tag_path).toBe('SYS.Tag1');
    expect(result.errors[0].message).toContain('is_setpoint');
    expect(result.errors[0].message).toContain('i16[]');
  });

  it('rejects is_setpoint:true on f32[] from parent override', () => {
    const tags = resolveWithOverride('f32', false, true, { data_type: 'f32[]' });
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors[0].ref?.tag_path).toBe('SYS.Tag1');
  });

  it('accepts is_setpoint:true on f32 scalar', () => {
    const tags = resolveWithOverride('f32', false, true);
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts is_setpoint:true on string scalar', () => {
    const tags = resolveWithOverride('string', false, true);
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
  });

  it('accepts is_setpoint:false on f32[] (read-only array, no problem)', () => {
    const tags = resolveWithOverride('f32', false, false, { data_type: 'f32[]' });
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
  });
});

describe('validateResolvedTags — both rules can fire on the same tag', () => {
  it('emits two errors when both trends and is_setpoint violate for an array type', () => {
    const tags = resolveWithOverride('f32', true, true, { data_type: 'f32[]' });
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe('validateResolvedTags — empty input', () => {
  it('returns valid with no errors for an empty tag list', () => {
    const result = validateResolvedTags([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validateResolvedTags — tag_name rules', () => {
  it('TAG_NAME_EMPTY: instance override flipping In_Tag_Name to false gives exactly one TAG_NAME_EMPTY error', () => {
    // Tag template default is true (from makeTagTemplate), instance override flips to false
    const tags = resolveWithOverride('f32', false, false, { [IN_TAG_NAME_FIELD]: false });
    expect(tags[0].tag_name).toBe('');
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.TAG_NAME_EMPTY);
    expect(result.errors[0].ref?.tag_path).toBe('SYS.Tag1');
  });

  it('TAG_NAME_TOO_LONG: all-flagged 3-level hierarchy with long names produces exactly one TAG_NAME_TOO_LONG error', () => {
    const longParam = 'A'.repeat(20);  // 20 chars
    const longTag   = 'B'.repeat(20);  // 20 chars
    // tag_name = 'SYS.' + longParam + '.' + longTag = 3+1+20+1+20 = 45 > MAX_TAG_NAME_LENGTH (40)
    const tagTemplate: Template = {
      template_name: 'TTag',
      template_type: 'tag',
      fields: {
        [IN_TAG_NAME_FIELD]: { field_type: 'Boolean', default: true },
        data_type:           { field_type: 'TagType',  default: 'f32' },
        is_setpoint:         { field_type: 'Boolean',  default: false },
      },
      children: [],
    };
    const paramTemplate: Template = {
      template_name: 'PParam',
      template_type: 'parameter',
      fields: { [IN_TAG_NAME_FIELD]: { field_type: 'Boolean', default: true } },
      children: [{ template_name: 'TTag', asset_name: longTag, fields: {} }],
    };
    const sysTemplate: Template = {
      template_name: 'SYS',
      template_type: 'system',
      fields: { [IN_TAG_NAME_FIELD]: { field_type: 'Boolean', default: true } },
      children: [{ template_name: 'PParam', asset_name: longParam, fields: {} }],
    };
    const templateMap = new Map<string, Template>([
      ['SYS', sysTemplate], ['PParam', paramTemplate], ['TTag', tagTemplate],
    ]);
    const tags = resolveRegistry(templateMap, 'SYS');
    expect(tags).toHaveLength(1);
    expect(tags[0].tag_name.length).toBeGreaterThan(MAX_TAG_NAME_LENGTH);
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.TAG_NAME_TOO_LONG);
    expect(result.errors[0].ref?.tag_path).toBe(`SYS.${longParam}.${longTag}`);
  });

  it('valid: default makeTagTemplate gives non-empty tag_name with no tag_name errors', () => {
    // makeTagTemplate sets In_Tag_Name: true; tag level name = 'Tag1'
    const tags = resolveWithOverride('f32', false, false);
    expect(tags[0].tag_name).toBe('Tag1');
    expect(tags[0].tag_name.length).toBeLessThanOrEqual(MAX_TAG_NAME_LENGTH);
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ── DUPLICATE_TAG_NAME ────────────────────────────────────────────────────────

/** Minimal ResolvedTag factory — only tag_path and tag_name vary across cases. */
function makeResolvedTag(tag_path: string, tag_name: string): ResolvedTag {
  return {
    tag_path,
    tag_name,
    data_type: 'f32',
    module: null,
    module_type: null,
    is_setpoint: false,
    trends: false,
    unit: null,
    format: null,
    eng_min: null,
    eng_max: null,
    meta: [],
  };
}

describe('validateResolvedTags — DUPLICATE_TAG_NAME', () => {
  it('two tags with the same tag_name produce one error per tag (2 errors total)', () => {
    const tags = [
      makeResolvedTag('SYS.chan_A.t0', 'Speed'),
      makeResolvedTag('SYS.chan_A.t1', 'Speed'),
    ];
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    const dupes = result.errors.filter(e => e.code === ERROR_CODES.DUPLICATE_TAG_NAME);
    expect(dupes).toHaveLength(2);
    expect(dupes.map(e => e.ref?.tag_path)).toEqual(
      expect.arrayContaining(['SYS.chan_A.t0', 'SYS.chan_A.t1']),
    );
  });

  it('comparison is case-insensitive ("Speed" and "speed" collide)', () => {
    const tags = [
      makeResolvedTag('SYS.chan_A.t0', 'Speed'),
      makeResolvedTag('SYS.chan_A.t1', 'speed'),
    ];
    const result = validateResolvedTags(tags);
    expect(result.valid).toBe(false);
    const dupes = result.errors.filter(e => e.code === ERROR_CODES.DUPLICATE_TAG_NAME);
    expect(dupes).toHaveLength(2);
  });

  it('three-way collision produces one error per tag (3 errors total)', () => {
    const tags = [
      makeResolvedTag('SYS.a.t0', 'Pressure'),
      makeResolvedTag('SYS.a.t1', 'PRESSURE'),
      makeResolvedTag('SYS.a.t2', 'pressure'),
    ];
    const result = validateResolvedTags(tags);
    const dupes = result.errors.filter(e => e.code === ERROR_CODES.DUPLICATE_TAG_NAME);
    expect(dupes).toHaveLength(3);
    expect(result.valid).toBe(false);
  });

  it('unique tag_names produce no DUPLICATE_TAG_NAME errors', () => {
    const tags = [
      makeResolvedTag('SYS.chan_A.t0', 'Temp'),
      makeResolvedTag('SYS.chan_A.t1', 'Pressure'),
      makeResolvedTag('SYS.chan_B.t0', 'Flow'),
    ];
    const result = validateResolvedTags(tags);
    const dupes = result.errors.filter(e => e.code === ERROR_CODES.DUPLICATE_TAG_NAME);
    expect(dupes).toHaveLength(0);
  });

  it('empty tag_names produce TAG_NAME_EMPTY only — never DUPLICATE_TAG_NAME', () => {
    const tags = [
      makeResolvedTag('SYS.chan_A.t0', ''),
      makeResolvedTag('SYS.chan_A.t1', ''),
    ];
    const result = validateResolvedTags(tags);
    const dupes = result.errors.filter(e => e.code === ERROR_CODES.DUPLICATE_TAG_NAME);
    const empties = result.errors.filter(e => e.code === ERROR_CODES.TAG_NAME_EMPTY);
    expect(dupes).toHaveLength(0);
    expect(empties).toHaveLength(2);
  });

  it('end-to-end via resolveRegistry: two tag children under a shared parameter produce a collision', () => {
    // Parameter has In_Tag_Name=true; tag children have In_Tag_Name=false.
    // Both children resolve tag_name = 'chan_A' (only parameter level contributes).
    const tagTemplate: Template = {
      template_name: 'TTag',
      template_type: 'tag',
      fields: {
        [IN_TAG_NAME_FIELD]: { field_type: 'Boolean', default: false },
        data_type:           { field_type: 'TagType',  default: 'f32' },
      },
      children: [],
    };
    const paramTemplate: Template = {
      template_name: 'PParam',
      template_type: 'parameter',
      fields: { [IN_TAG_NAME_FIELD]: { field_type: 'Boolean', default: true } },
      children: [
        { template_name: 'TTag', asset_name: 'child_0', fields: {} },
        { template_name: 'TTag', asset_name: 'child_1', fields: {} },
      ],
    };
    const sysTemplate: Template = {
      template_name: 'SYS',
      template_type: 'system',
      fields: {},
      children: [{ template_name: 'PParam', asset_name: 'chan_A', fields: {} }],
    };
    const templateMap = new Map<string, Template>([
      ['SYS', sysTemplate],
      ['PParam', paramTemplate],
      ['TTag', tagTemplate],
    ]);
    const resolved = resolveRegistry(templateMap, 'SYS');
    expect(resolved).toHaveLength(2);
    expect(resolved.every(t => t.tag_name === 'chan_A')).toBe(true);

    const result = validateResolvedTags(resolved);
    expect(result.valid).toBe(false);
    const dupes = result.errors.filter(e => e.code === ERROR_CODES.DUPLICATE_TAG_NAME);
    expect(dupes).toHaveLength(2);
    expect(dupes.map(e => e.ref?.tag_path)).toEqual(
      expect.arrayContaining(['SYS.chan_A.child_0', 'SYS.chan_A.child_1']),
    );
  });
});

