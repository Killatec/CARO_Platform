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
  it('nests module-relative tag_names (In_Tag_Name levels only) by segment', () => {
    expect(buildTagDefs(makeMap(), 'RF_Mod')).toEqual({
      Enable: { data_type: 'bool' },
      Mag_1:  { Gain: { data_type: 'f32' }, kW: { data_type: 'i16' } },
    });
  });

  it('leaves carry exactly data_type — no direction or other excluded fields', () => {
    const tags = buildTagDefs(makeMap(), 'RF_Mod');
    for (const leaf of [tags.Enable, (tags.Mag_1 as Record<string, object>).Gain, (tags.Mag_1 as Record<string, object>).kW]) {
      expect(Object.keys(leaf)).toEqual(['data_type']);
    }
  });

  it('inserts keys in code-unit order at every level', () => {
    const tags = buildTagDefs(makeMap(), 'RF_Mod');
    expect(Object.keys(tags)).toEqual(['Enable', 'Mag_1']);
    expect(Object.keys(tags.Mag_1)).toEqual(['Gain', 'kW']);
  });

  it('places a "__proto__" segment as an ordinary key', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'boolean_set', asset_name: '__proto__', fields: {} }] });
    const tags = buildTagDefs(map, 'RF_Mod');
    expect(Object.keys(tags)).toContain('__proto__');
    expect(JSON.stringify(tags)).toContain('"__proto__":{"data_type":"bool"}');
  });

  it('throws if a name is both a leaf and a group (validateTagDefs reports it first)', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'numeric_mon', asset_name: 'Mag_1', fields: {} }] });
    expect(() => buildTagDefs(map, 'RF_Mod')).toThrow(/Mag_1/);
  });

  it('is independent of how the module is instanced by a system', () => {
    const map = makeMap();
    const sys = map.get('Sys')!;
    map.set('Sys', { ...sys, children: [...sys.children, { template_name: 'RF_Mod', asset_name: 'RF2', fields: {} }] });
    expect(buildTagDefs(map, 'RF_Mod')).toEqual(buildTagDefs(makeMap(), 'RF_Mod'));
  });

  it('skips organizational levels whose In_Tag_Name is false', () => {
    expect(JSON.stringify(buildTagDefs(makeMap(), 'RF_Mod'))).not.toContain('Pwr_Mon');
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

  it('reports TAG_NAME_LEAF_AND_GROUP when a tag name is also the parent of other names', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'numeric_mon', asset_name: 'Mag_1', fields: {} }] });
    const errors = validateTagDefs(map, 'RF_Mod');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('TAG_NAME_LEAF_AND_GROUP');
    expect(errors[0].ref).toEqual({ template_name: 'RF_Mod', tag_path: 'RF_Mod.Mag_1' });
    expect(errors[0].message).toContain('Mag_1.Gain, Mag_1.kW');
  });

  it('TAG_NAME_LEAF_AND_GROUP is case-insensitive, like DUPLICATE_TAG_NAME', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'numeric_mon', asset_name: 'MAG_1', fields: {} }] });
    expect(validateTagDefs(map, 'RF_Mod').map(e => e.code)).toEqual(['TAG_NAME_LEAF_AND_GROUP']);
  });

  it('does not treat a shared name prefix without a dot as leaf-and-group', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'numeric_mon', asset_name: 'Mag', fields: {} }] });
    expect(validateTagDefs(map, 'RF_Mod')).toEqual([]);
  });

  it('reports TAG_NAME_RESERVED_SEGMENT for a segment named data_type', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [mod.children[0], { ...mod.children[1], asset_name: 'data_type' }] });
    const errors = validateTagDefs(map, 'RF_Mod');
    expect(errors.map(e => e.code)).toEqual(['TAG_NAME_RESERVED_SEGMENT']);
    expect(errors[0].ref).toEqual({ template_name: 'RF_Mod', tag_path: 'RF_Mod.data_type' });
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
    // Keys sorted at every level (code-unit order: uppercase "G" before lowercase "k"), no whitespace.
    const canonical =
      '{"Enable":{"data_type":"bool"},"Mag_1":{"Gain":{"data_type":"f32"},"kW":{"data_type":"i16"}}}';
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

  it('hash does not change when only Set/Mon direction changes (direction is not exported)', () => {
    const map = makeMap();
    map.set('boolean_set', tag('boolean_set', 'bool', false));
    expect(buildTagDefsFile(map, 'RF_Mod').content_hash)
      .toBe(buildTagDefsFile(makeMap(), 'RF_Mod').content_hash);
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
