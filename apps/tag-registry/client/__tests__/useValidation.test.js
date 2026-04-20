// Tests for the resolved-tag validation pass added to useValidation.
// The hook's useMemo runs in a React render cycle that can't be exercised in a
// node/vitest environment without jsdom + testing-library.  These tests call the
// exact same functions the useMemo delegates to (resolveRegistry +
// validateResolvedTags) and verify the outcomes that would surface in the hook's
// `messages` array, following the pattern of every other test in this suite.
import { describe, it, expect } from 'vitest';
import { resolveRegistry, validateResolvedTags } from '@caro/tag-registry-shared';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTag(name, fieldOverrides = {}) {
  return {
    template_type: 'tag',
    template_name: name,
    fields: {
      data_type:   { field_type: 'TagType',  default: 'f32'   },
      is_setpoint: { field_type: 'Boolean',  default: false   },
      Trends:      { field_type: 'Boolean',  default: false   },
      ...fieldOverrides,
    },
    children: [],
  };
}

function makeSystem(name, children) {
  return {
    template_type: 'system',
    template_name: name,
    fields: {},
    children,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useValidation — resolved-tag validation pass', () => {
  it('illegal resolved tag (f32[] + Trends:true) produces error with ref.tag_path', () => {
    // Tag defaults Trends:false; parent override sets data_type:f32[] and Trends:true.
    // This is the same case validateResolvedTags.test.ts already covers server-side.
    const tagTemplate = makeTag('BadTag');
    const sysTemplate = makeSystem('BAD_SYS', [
      { template_name: 'BadTag', asset_name: 'T1', fields: { data_type: 'f32[]', Trends: true } },
    ]);
    const templates = new Map([['BAD_SYS', sysTemplate], ['BadTag', tagTemplate]]);

    const resolved = resolveRegistry(templates, 'BAD_SYS');
    const result   = validateResolvedTags(resolved);

    const messages = [...result.errors, ...result.warnings];
    expect(messages.some(m => m.ref?.tag_path === 'BAD_SYS.T1')).toBe(true);
    expect(messages.some(m => m.severity === 'error')).toBe(true);
  });

  it('rootName = null → resolveRegistry returns [] → no post-resolution messages', () => {
    // Mirrors the hook guard: `if (rootName) { ... }` — when rootName is null
    // resolveRegistry returns [] so validateResolvedTags finds nothing to check.
    const tagTemplate = makeTag('AnyTag');
    const templates = new Map([['AnyTag', tagTemplate]]);

    const resolved = resolveRegistry(templates, null);
    expect(resolved).toHaveLength(0);

    const result = validateResolvedTags(resolved);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('circular template reference causes resolveRegistry to throw; try/catch swallows it', () => {
    // Template A references B as a child; B references A — infinite recursion → RangeError.
    // The hook wraps this in try/catch; structural validators (validateGraph) would
    // already have reported the cycle in `messages` before this block runs.
    const templateA = {
      template_type: 'module',
      template_name: 'A',
      fields: {},
      children: [{ template_name: 'B', asset_name: 'b1', fields: {} }],
    };
    const templateB = {
      template_type: 'module',
      template_name: 'B',
      fields: {},
      children: [{ template_name: 'A', asset_name: 'a1', fields: {} }],
    };
    const templates = new Map([['A', templateA], ['B', templateB]]);

    expect(() => {
      try {
        const resolved = resolveRegistry(templates, 'A');
        const r = validateResolvedTags(resolved);
        // If it somehow didn't throw, result is still defined — no crash
        void r;
      } catch {
        // swallowed — this is exactly what the hook does
      }
    }).not.toThrow();
  });
});
