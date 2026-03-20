import { describe, it, expect } from 'vitest';
import { validateTemplate } from '../validateTemplate.js';
import { DATA_TYPES, MAX_IDENTIFIER_LENGTH, ERROR_CODES } from '../constants.js';

function makeTag(overrides = {}) {
  return {
    template_type: 'tag',
    template_name: 'my_tag',
    data_type: 'f64',
    is_setpoint: false,
    fields: {},
    children: [],
    ...overrides,
  };
}

function makeStruct(overrides = {}) {
  return {
    template_type: 'parameter',
    template_name: 'my_param',
    fields: {},
    children: [],
    ...overrides,
  };
}

// ── Valid cases ──────────────────────────────────────────────────────────────

describe('valid templates', () => {
  it('minimal valid tag', () => {
    const r = validateTemplate(makeTag());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('minimal valid structural template', () => {
    const r = validateTemplate(makeStruct());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it.each(Object.values(DATA_TYPES).filter(t => t !== 'i32_array'))(
    'tag with data_type "%s" is valid', (dataType) => {
      const r = validateTemplate(makeTag({ data_type: dataType }));
      expect(r.valid).toBe(true);
    }
  );

  it('tag with is_setpoint: true is valid', () => {
    expect(validateTemplate(makeTag({ is_setpoint: true })).valid).toBe(true);
  });

  it('structural template with one valid child', () => {
    const r = validateTemplate(makeStruct({
      children: [{ template_name: 'child_tpl', asset_name: 'ch1', fields: {} }],
    }));
    expect(r.valid).toBe(true);
  });

  it('field with field_type Numeric, default 0 is valid', () => {
    const r = validateTemplate(makeTag({ fields: { eng_min: { field_type: 'Numeric', default: 0 } } }));
    expect(r.valid).toBe(true);
  });

  it('field with field_type String, default "" is valid', () => {
    const r = validateTemplate(makeTag({ fields: { label: { field_type: 'String', default: '' } } }));
    expect(r.valid).toBe(true);
  });

  it('field with field_type Boolean, default false is valid', () => {
    const r = validateTemplate(makeTag({ fields: { enabled: { field_type: 'Boolean', default: false } } }));
    expect(r.valid).toBe(true);
  });

  it('template_name at exactly MAX_IDENTIFIER_LENGTH (40) is valid', () => {
    const r = validateTemplate(makeTag({ template_name: 'a'.repeat(MAX_IDENTIFIER_LENGTH) }));
    expect(r.valid).toBe(true);
  });
});

// ── Null / missing ───────────────────────────────────────────────────────────

describe('null / missing', () => {
  it('null → invalid with SCHEMA_VALIDATION_ERROR', () => {
    const r = validateTemplate(null);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.SCHEMA_VALIDATION_ERROR)).toBe(true);
  });

  it('undefined → invalid', () => {
    expect(validateTemplate(undefined).valid).toBe(false);
  });

  it('empty object (no template_name) → invalid', () => {
    expect(validateTemplate({}).valid).toBe(false);
  });

  it('template_name missing → invalid with SCHEMA_VALIDATION_ERROR', () => {
    const r = validateTemplate(makeTag({ template_name: undefined }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.SCHEMA_VALIDATION_ERROR)).toBe(true);
  });

  it('template_type missing → invalid', () => {
    expect(validateTemplate(makeTag({ template_type: undefined })).valid).toBe(false);
  });
});

// ── Tag-specific errors ──────────────────────────────────────────────────────

describe('tag-specific errors', () => {
  it('data_type missing → invalid', () => {
    const r = validateTemplate(makeTag({ data_type: undefined }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.SCHEMA_VALIDATION_ERROR)).toBe(true);
  });

  it('data_type: "invalid_type" → invalid', () => {
    expect(validateTemplate(makeTag({ data_type: 'invalid_type' })).valid).toBe(false);
  });

  it('data_type: "i32_array" → valid (present in DATA_TYPE_VALUES)', () => {
    const result = validateTemplate(makeTag({ data_type: 'i32_array' }));
    expect(result.valid).toBe(true);
  });

  it('is_setpoint missing → invalid', () => {
    const t = makeTag();
    delete t.is_setpoint;
    expect(validateTemplate(t).valid).toBe(false);
  });

  it('is_setpoint: "true" (string) → invalid', () => {
    expect(validateTemplate(makeTag({ is_setpoint: 'true' })).valid).toBe(false);
  });

  it('tag with non-empty children array → invalid', () => {
    const r = validateTemplate(makeTag({
      children: [{ template_name: 'x', asset_name: 'y', fields: {} }],
    }));
    expect(r.valid).toBe(false);
  });
});

// ── Identifier length ────────────────────────────────────────────────────────

describe('identifier length', () => {
  it('template_name length 41 → invalid', () => {
    const r = validateTemplate(makeTag({ template_name: 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1) }));
    expect(r.valid).toBe(false);
  });
});

// ── Children validation ──────────────────────────────────────────────────────

describe('children validation', () => {
  it('asset_name containing a dot → invalid with INVALID_ASSET_NAME', () => {
    const r = validateTemplate(makeStruct({
      children: [{ template_name: 'x', asset_name: 'bad.name', fields: {} }],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.INVALID_ASSET_NAME)).toBe(true);
  });

  it('empty asset_name → invalid', () => {
    const r = validateTemplate(makeStruct({
      children: [{ template_name: 'x', asset_name: '', fields: {} }],
    }));
    expect(r.valid).toBe(false);
  });

  it('asset_name length 41 → invalid', () => {
    const r = validateTemplate(makeStruct({
      children: [{ template_name: 'x', asset_name: 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1), fields: {} }],
    }));
    expect(r.valid).toBe(false);
  });

  it('two children with same asset_name → invalid with DUPLICATE_SIBLING_NAME', () => {
    const r = validateTemplate(makeStruct({
      children: [
        { template_name: 'x', asset_name: 'ch', fields: {} },
        { template_name: 'y', asset_name: 'ch', fields: {} },
      ],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.DUPLICATE_SIBLING_NAME)).toBe(true);
  });

  it('two children with different asset_names → valid', () => {
    const r = validateTemplate(makeStruct({
      children: [
        { template_name: 'x', asset_name: 'ch1', fields: {} },
        { template_name: 'y', asset_name: 'ch2', fields: {} },
      ],
    }));
    expect(r.valid).toBe(true);
  });
});

// ── Field validation ─────────────────────────────────────────────────────────

describe('field validation', () => {
  it('field value is raw number (not { field_type, default }) → invalid with SCHEMA_VALIDATION_ERROR', () => {
    const r = validateTemplate(makeTag({ fields: { eng_min: 42 } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.code === ERROR_CODES.SCHEMA_VALIDATION_ERROR)).toBe(true);
  });

  it('Numeric field with string default → invalid', () => {
    const r = validateTemplate(makeTag({ fields: { x: { field_type: 'Numeric', default: 'not_a_number' } } }));
    expect(r.valid).toBe(false);
  });

  it('String field with numeric default → invalid', () => {
    const r = validateTemplate(makeTag({ fields: { x: { field_type: 'String', default: 42 } } }));
    expect(r.valid).toBe(false);
  });

  it('Boolean field with string default → invalid', () => {
    const r = validateTemplate(makeTag({ fields: { x: { field_type: 'Boolean', default: 'false' } } }));
    expect(r.valid).toBe(false);
  });

  it('field with field_type "InvalidType" → invalid', () => {
    const r = validateTemplate(makeTag({ fields: { x: { field_type: 'InvalidType', default: 0 } } }));
    expect(r.valid).toBe(false);
  });
});
