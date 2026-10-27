import { describe, it, expect } from 'vitest';
import { listMqttModuleTemplates, buildTagDefs, buildTagDefsFile, validateTagDefs, moduleRelativeTagName, TAG_DEFS_BANNER } from '../tagDefs.js';
import type { MetaLevel, Template } from '../types.js';

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
      Mag_1:  { _template: 'RF_Pwr', Gain: { data_type: 'f32' }, kW: { data_type: 'i16' } },
    });
  });

  it('leaves carry exactly data_type — no direction or other excluded fields', () => {
    const tags = buildTagDefs(makeMap(), 'RF_Mod');
    for (const leaf of [tags.Enable, (tags.Mag_1 as Record<string, object>).Gain, (tags.Mag_1 as Record<string, object>).kW]) {
      expect(Object.keys(leaf)).toEqual(['data_type']);
    }
  });

  it('inserts keys in code-unit order at every level, _template first in a marked node', () => {
    const tags = buildTagDefs(makeMap(), 'RF_Mod');
    expect(Object.keys(tags)).toEqual(['Enable', 'Mag_1']);
    expect(Object.keys(tags.Mag_1)).toEqual(['_template', 'Gain', 'kW']);
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

  it('reports TAG_NAME_RESERVED_SEGMENT for a segment named _template', () => {
    const map = makeMap();
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [mod.children[0], { ...mod.children[1], asset_name: '_template' }] });
    const errors = validateTagDefs(map, 'RF_Mod');
    expect(errors.map(e => e.code)).toEqual(['TAG_NAME_RESERVED_SEGMENT']);
    expect(errors[0].message).toContain('"_template"');
  });

  it('reports TEMPLATE_NAME_INVALID once per marked template that is not a C identifier', () => {
    const map = makeMap();
    const rfPwr = map.get('RF_Pwr')!;
    map.delete('RF_Pwr');
    map.set('RF-Pwr', { ...rfPwr, template_name: 'RF-Pwr' });
    const pwrMon = map.get('Pwr_Mon')!;
    map.set('Pwr_Mon', {
      ...pwrMon,
      children: [
        { template_name: 'RF-Pwr', asset_name: 'Mag_1', fields: { In_Tag_Name: true } },
        { template_name: 'RF-Pwr', asset_name: 'Mag_2', fields: { In_Tag_Name: true } },
      ],
    });
    const errors = validateTagDefs(map, 'RF_Mod');
    expect(errors.map(e => e.code)).toEqual(['TEMPLATE_NAME_INVALID']);
    expect(errors[0].message).toContain('Mag_1, Mag_2');
    expect(errors[0].ref).toEqual({ template_name: 'RF_Mod', child_template: 'RF-Pwr' });
  });

  it('does not check names of templates that mark no node', () => {
    const map = makeMap();
    const rfPwr = map.get('RF_Pwr')!;
    map.delete('RF_Pwr');
    map.set('RF-Pwr', { ...rfPwr, template_name: 'RF-Pwr' });
    const pwrMon = map.get('Pwr_Mon')!;
    // In_Tag_Name false: no node of its own, so the name never reaches the export.
    map.set('Pwr_Mon', { ...pwrMon, children: [{ template_name: 'RF-Pwr', asset_name: 'Mag_1', fields: {} }] });
    expect(validateTagDefs(map, 'RF_Mod')).toEqual([]);
  });
});

// ── _template marks ───────────────────────────────────────────────────────────

describe('buildTagDefs — _template marks', () => {
  function withPwrMonChildren(children: Template['children']): Map<string, Template> {
    const map = makeMap();
    map.set('Pwr_Mon', { ...map.get('Pwr_Mon')!, children });
    return map;
  }

  it('marks two instances of one template, with identical members', () => {
    const tags = buildTagDefs(withPwrMonChildren([
      { template_name: 'RF_Pwr', asset_name: 'Mag_1', fields: { In_Tag_Name: true } },
      { template_name: 'RF_Pwr', asset_name: 'Mag_2', fields: { In_Tag_Name: true } },
    ]), 'RF_Mod');
    expect(tags.Mag_1).toEqual({ _template: 'RF_Pwr', Gain: { data_type: 'f32' }, kW: { data_type: 'i16' } });
    expect(tags.Mag_2).toEqual(tags.Mag_1);
  });

  it('never marks the root or a leaf', () => {
    const tags = buildTagDefs(makeMap(), 'RF_Mod');
    expect('_template' in tags).toBe(false);
    expect(Object.keys(tags.Enable)).toEqual(['data_type']);
  });

  it('does not mark an instance whose own level has In_Tag_Name false (its children merge into the parent)', () => {
    const tags = buildTagDefs(withPwrMonChildren([
      { template_name: 'RF_Pwr', asset_name: 'Mag_1', fields: {} },
    ]), 'RF_Mod');
    expect(tags).toEqual({ Enable: { data_type: 'bool' }, Gain: { data_type: 'f32' }, kW: { data_type: 'i16' } });
  });

  it('marks an instance that contains In_Tag_Name false levels, and its nested instances', () => {
    const map = makeMap();
    // Coupler (named) -> Grp (In_Tag_Name false, flattened) -> Fwd (RF_Pwr, named)
    map.set('Grp', {
      template_name: 'Grp', template_type: 'Group', fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
      children: [{ template_name: 'RF_Pwr', asset_name: 'Fwd', fields: { In_Tag_Name: true } }],
    });
    map.set('Coupler', {
      template_name: 'Coupler', template_type: 'RF', fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
      children: [
        { template_name: 'Grp', asset_name: 'Grp', fields: {} },
        { template_name: 'numeric_mon', asset_name: 'Att', fields: {} },
      ],
    });
    map.set('Pwr_Mon', { ...map.get('Pwr_Mon')!, children: [{ template_name: 'Coupler', asset_name: 'Comb', fields: { In_Tag_Name: true } }] });
    const tags = buildTagDefs(map, 'RF_Mod');
    expect(tags.Comb).toEqual({
      _template: 'Coupler',
      Att: { data_type: 'f32' },
      Fwd: { _template: 'RF_Pwr', Gain: { data_type: 'f32' }, kW: { data_type: 'i16' } },
    });
  });

  it('does not mark a node that mixes in content from outside the instance', () => {
    const map = makeMap();
    // A second, unrelated "Mag_1" level, flattened in from an In_Tag_Name false group.
    map.set('Extra_Mag', {
      template_name: 'Extra_Mag', template_type: 'Group', fields: { In_Tag_Name: { field_type: 'Boolean', default: true } },
      children: [{ template_name: 'numeric_mon', asset_name: 'Att', fields: {} }],
    });
    map.set('Extra', {
      template_name: 'Extra', template_type: 'Group', fields: { In_Tag_Name: { field_type: 'Boolean', default: false } },
      children: [{ template_name: 'Extra_Mag', asset_name: 'Mag_1', fields: {} }],
    });
    const mod = map.get('RF_Mod')!;
    map.set('RF_Mod', { ...mod, children: [...mod.children, { template_name: 'Extra', asset_name: 'Extra', fields: {} }] });
    const tags = buildTagDefs(map, 'RF_Mod');
    expect(tags.Mag_1).toEqual({ Att: { data_type: 'f32' }, Gain: { data_type: 'f32' }, kW: { data_type: 'i16' } });
    expect(validateTagDefs(map, 'RF_Mod')).toEqual([]);
  });

  it('is unchanged by validation: the file carries the same marks', () => {
    expect(buildTagDefsFile(makeMap(), 'RF_Mod', 7).tags).toEqual(buildTagDefs(makeMap(), 'RF_Mod'));
    expect(TAG_DEFS_BANNER).toContain('"_template"');
  });
});

// ── buildTagDefsFile ──────────────────────────────────────────────────────────

describe('buildTagDefsFile', () => {
  it('stamps banner, template name and the given registry revision, with no content hash', () => {
    const file = buildTagDefsFile(makeMap(), 'RF_Mod', 9);
    expect(file._generated).toBe(TAG_DEFS_BANNER);
    expect(file.template_name).toBe('RF_Mod');
    expect(file.tag_registry_rev).toBe(9);
    expect(file).not.toHaveProperty('content_hash');
  });

  it('writes the keys in a fixed order: banner, template, revision, tags', () => {
    expect(Object.keys(buildTagDefsFile(makeMap(), 'RF_Mod', 9)))
      .toEqual(['_generated', 'template_name', 'tag_registry_rev', 'tags']);
  });

  it('carries the same tags tree as buildTagDefs', () => {
    expect(buildTagDefsFile(makeMap(), 'RF_Mod', 9).tags).toEqual(buildTagDefs(makeMap(), 'RF_Mod'));
  });

  it('is stable across regenerations at the same revision', () => {
    expect(buildTagDefsFile(makeMap(), 'RF_Mod', 9)).toEqual(buildTagDefsFile(makeMap(), 'RF_Mod', 9));
  });
});

describe('moduleRelativeTagName', () => {
  const lvl = (type: string, name: string, inTagName?: boolean): MetaLevel => ({
    type,
    name,
    fields: inTagName === undefined ? {} : { In_Tag_Name: inTagName },
  });

  it('export shape: module at meta[0] — same as dropping meta[0]', () => {
    const meta = [lvl('module', 'Narya_RF', false), lvl('Phase', 'Phase', true), lvl('tag', 'Set', true)];
    expect(moduleRelativeTagName(meta)).toBe('Phase.Set');
  });

  it('registry shape: levels above the module are skipped', () => {
    const meta = [
      lvl('system', 'Narya1', true),
      lvl('module', 'RF1', true),
      lvl('Pwr_Mon', 'Pwr_Mon', false),
      lvl('Mag', 'Mag_1', true),
      lvl('Dir', 'Fwd', true),
      lvl('tag', 'Gain', true),
    ];
    expect(moduleRelativeTagName(meta)).toBe('Mag_1.Fwd.Gain');
  });

  it('never includes the module level, even with In_Tag_Name true', () => {
    expect(moduleRelativeTagName([lvl('module', 'RF1', true), lvl('tag', 'IP', true)])).toBe('IP');
  });

  it('skips levels whose In_Tag_Name is false or absent', () => {
    const meta = [lvl('module', 'M'), lvl('Group', 'G', false), lvl('Group', 'H'), lvl('tag', 'T', true)];
    expect(moduleRelativeTagName(meta)).toBe('T');
  });

  it('uses the first module level; a nested module level is an ordinary level', () => {
    const meta = [lvl('module', 'Outer', true), lvl('module', 'Inner', true), lvl('tag', 'T', true)];
    expect(moduleRelativeTagName(meta)).toBe('Inner.T');
  });

  it('returns "" when no level below the module is in the name', () => {
    expect(moduleRelativeTagName([lvl('module', 'M', true), lvl('tag', 'T', false)])).toBe('');
  });

  it('returns null when meta has no module level', () => {
    expect(moduleRelativeTagName([lvl('system', 'S', true), lvl('tag', 'T', true)])).toBeNull();
  });
});
