import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { listMqttModuleTemplates, buildTagDefs, buildTagDefsFile, validateTagDefs, TAG_DEFS_BANNER } from '../tagDefs.js';
import type { Template } from '../types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function tag(name: string, data_type: string, is_setpoint: boolean, extra: Template['fields'] = {}): Template {
  return {
    template_name: name,
    template_type: 'tag',
    fields: {
      data_type:   { field_type: 'TagType', default: data_type },
      is_setpoint: { field_type: 'Boolean', default: is_setpoint },
      Trends:      { field_type: 'Boolean', default: false },
      In_Tag_Name: { field_type: 'Boolean', default: true },
      ...extra,
    },
    children: [],
  };
}

function makeMap(): Map<string, Template> {
  const templates: Template[] = [
    tag('numeric_set', 'f32', true, {
      unit:    { field_type: 'String',  default: 'kW' },
      eng_max: { field_type: 'Numeric', default: 100 },
      format:  { field_type: 'String',  default: '#.##' },
    }),
    tag('numeric_mon', 'f32', false),
    tag('boolean_set', 'bool', true),
    {
      template_name: 'RF_Pwr', template_type: 'RF', fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
      children: [
        { template_name: 'numeric_set', asset_name: 'Gain', fields: {} },
        { template_name: 'numeric_mon', asset_name: 'kW',   fields: { data_type: 'i16' } },
      ],
    },
    {
      // Organizational grouping — In_Tag_Name false, so it never appears in names.
      template_name: 'Pwr_Mon', template_type: 'Group', fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
      children: [{ template_name: 'RF_Pwr', asset_name: 'Mag_1', fields: { In_Tag_Name: true } }],
    },
    {
      template_name: 'RF_Mod', template_type: 'module',
      fields: {
        Module_Type: { field_type: 'ModuleType', default: 'MQTT' },
        In_Tag_Name: { field_type: 'Boolean', default: false },
      },
      children: [
        { template_name: 'Pwr_Mon',     asset_name: 'Pwr_Mon', fields: {} },
        { template_name: 'boolean_set', asset_name: 'Enable', fields: {} },
      ],
    },
    {
      template_name: 'HMI', template_type: 'module',
      fields: { Module_Type: { field_type: 'ModuleType', default: 'HMI' } },
      children: [{ template_name: 'numeric_mon', asset_name: 'Tag_Count', fields: {} }],
    },
    {
      template_name: 'Sys', template_type: 'system', fields: {},
      children: [
        { template_name: 'HMI',    asset_name: 'HMI', fields: {} },
        { template_name: 'RF_Mod', asset_name: 'RF1', fields: { In_Tag_Name: true } },
      ],
    },
  ];
  return new Map(templates.map(t => [t.template_name, t]));
}

// ── listMqttModuleTemplates ───────────────────────────────────────────────────

describe('listMqttModuleTemplates', () => {
  it('returns only module templates whose Module_Type is MQTT', () => {
    expect(listMqttModuleTemplates(makeMap())).toEqual(['RF_Mod']);
  });

  it('excludes HMI-type modules and non-module templates', () => {
    const names = listMqttModuleTemplates(makeMap());
    expect(names).not.toContain('HMI');
    expect(names).not.toContain('Sys');
    expect(names).not.toContain('RF_Pwr');
  });

  it('sorts by code unit (uppercase before lowercase)', () => {
    const map = makeMap();
    for (const name of ['b_mod', 'A_mod', 'a_mod']) {
      map.set(name, { ...map.get('RF_Mod')!, template_name: name });
    }
    expect(listMqttModuleTemplates(map)).toEqual(['A_mod', 'RF_Mod', 'a_mod', 'b_mod']);
  });

  it('accepts a plain record of TemplateEntry wrappers', () => {
    const record = Object.fromEntries([...makeMap()].map(([k, t]) => [k, { template: t, hash: 'abc123' }]));
    expect(listMqttModuleTemplates(record)).toEqual(['RF_Mod']);
  });
});

// ── buildTagDefs ──────────────────────────────────────────────────────────────

describe('buildTagDefs', () => {
  it('emits module-relative tag_names (In_Tag_Name levels only), sorted', () => {
    expect(buildTagDefs(makeMap(), 'RF_Mod')).toEqual([
      { tag_name: 'Enable',     direction: 'Set', data_type: 'bool' },
      { tag_name: 'Mag_1.Gain', direction: 'Set', data_type: 'f32' },
      { tag_name: 'Mag_1.kW',   direction: 'Mon', data_type: 'i16' },
    ]);
  });

  it('carries exactly tag_name, direction and data_type — no excluded fields', () => {
    for (const entry of buildTagDefs(makeMap(), 'RF_Mod')) {
      expect(Object.keys(entry).sort()).toEqual(['data_type', 'direction', 'tag_name']);
    }
  });

  it('is independent of how the module is instanced by a system', () => {
    const map = makeMap();
    const sys = map.get('Sys')!;
    map.set('Sys', { ...sys, children: [...sys.children, { template_name: 'RF_Mod', asset_name: 'RF2', fields: {} }] });
    expect(buildTagDefs(map, 'RF_Mod')).toEqual(buildTagDefs(makeMap(), 'RF_Mod'));
  });

  it('skips organizational levels whose In_Tag_Name is false', () => {
    const paths = buildTagDefs(makeMap(), 'RF_Mod').map(e => e.tag_name);
    expect(paths.some(p => p.includes('Pwr_Mon'))).toBe(false);
  });

  it('never includes the module level, even if the module template sets In_Tag_Name true', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, fields: { ...mod.fields, In_Tag_Name: { field_type: 'Boolean', default: true } } });
    expect(buildTagDefs(map, 'RF_Mod')).toEqual(buildTagDefs(makeMap(), 'RF_Mod'));
  });
});

// ── validateTagDefs ───────────────────────────────────────────────────────────

describe('validateTagDefs', () => {
  it('returns no errors for a well-formed module', () => {
    expect(validateTagDefs(makeMap(), 'RF_Mod')).toEqual([]);
  });

  it('reports TAG_NAME_EMPTY when no level below the module has In_Tag_Name', () => {
    const map = makeMap();
    map.set('boolean_set', tag('boolean_set', 'bool', true, { In_Tag_Name: { field_type: 'Boolean', default: false } }));
    const errors = validateTagDefs(map, 'RF_Mod');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('TAG_NAME_EMPTY');
    expect(errors[0].ref).toEqual({ template_name: 'RF_Mod', tag_path: 'RF_Mod.Enable' });
  });

  it('reports DUPLICATE_TAG_NAME (case-insensitive) once per colliding tag', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    // Second Pwr_Mon-style group whose Mag_1 collides with the first (group names are hidden).
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'Pwr_Mon', asset_name: 'Pwr_Mon_2', fields: {} }] });
    const errors = validateTagDefs(map, 'RF_Mod');
    expect(errors.every(e => e.code === 'DUPLICATE_TAG_NAME')).toBe(true);
    expect(errors).toHaveLength(4); // Mag_1.Gain ×2, Mag_1.kW ×2
  });
});

// ── buildTagDefsFile ──────────────────────────────────────────────────────────

describe('buildTagDefsFile', () => {
  it('stamps banner, template name, and a sha256 content hash', () => {
    const file = buildTagDefsFile(makeMap(), 'RF_Mod');
    expect(file._generated).toBe(TAG_DEFS_BANNER);
    expect(file.template_name).toBe('RF_Mod');
    expect(file.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('content_hash is reproducible from the documented canonical form of tags', () => {
    const file = buildTagDefsFile(makeMap(), 'RF_Mod');
    const canonical = '[' + file.tags
      .map(t => `{"data_type":${JSON.stringify(t.data_type)},"direction":${JSON.stringify(t.direction)},"tag_name":${JSON.stringify(t.tag_name)}}`)
      .join(',') + ']';
    const expected = createHash('sha256').update(canonical).digest('hex');
    expect(file.content_hash).toBe(`sha256:${expected}`);
  });

  it('hash is stable across regenerations', () => {
    expect(buildTagDefsFile(makeMap(), 'RF_Mod')).toEqual(buildTagDefsFile(makeMap(), 'RF_Mod'));
  });

  it('hash changes when a data_type changes', () => {
    const map = makeMap();
    map.set('boolean_set', tag('boolean_set', 'i16', true));
    expect(buildTagDefsFile(map, 'RF_Mod').content_hash)
      .not.toBe(buildTagDefsFile(makeMap(), 'RF_Mod').content_hash);
  });

  it('hash changes when a direction changes', () => {
    const map = makeMap();
    map.set('boolean_set', tag('boolean_set', 'bool', false));
    expect(buildTagDefsFile(map, 'RF_Mod').content_hash)
      .not.toBe(buildTagDefsFile(makeMap(), 'RF_Mod').content_hash);
  });

  it('hash changes when a tag is renamed', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [mod.children[0], { ...mod.children[1], asset_name: 'Enabled' }] });
    expect(buildTagDefsFile(map, 'RF_Mod').content_hash)
      .not.toBe(buildTagDefsFile(makeMap(), 'RF_Mod').content_hash);
  });

  it('hash does not change for display-only edits (unit, format, eng_max)', () => {
    const map = makeMap();
    map.set('numeric_set', tag('numeric_set', 'f32', true, {
      unit:    { field_type: 'String',  default: 'W' },
      eng_max: { field_type: 'Numeric', default: 5 },
      format:  { field_type: 'String',  default: '#.#' },
    }));
    expect(buildTagDefsFile(map, 'RF_Mod').content_hash)
      .toBe(buildTagDefsFile(makeMap(), 'RF_Mod').content_hash);
  });
});
