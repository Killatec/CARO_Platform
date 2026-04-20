import { describe, it, expect } from 'vitest';
import { validateResolvedTags } from '../validateResolvedTags.js';
import { resolveRegistry } from '../resolveRegistry.js';
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
      data_type:   { field_type: 'TagType',  default: dataType },
      Trends:      { field_type: 'Boolean',  default: trends },
      is_setpoint: { field_type: 'Boolean',  default: isSetpoint },
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

