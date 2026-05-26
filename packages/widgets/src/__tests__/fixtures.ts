import type { TagDef } from '@caro/hmi-context';

export const mockNumericTag: TagDef = {
  tag_id: 1001,
  tag_path: 'Plant1.Module.RF_Fwd.monitor',
  tag_name: null,
  data_type: 'f32',
  is_setpoint: false,
  trendable: true,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  format: '#.###',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'monitor', fields: {} },
  ],
};

export const mockSetpointTag: TagDef = {
  tag_id: 1003,
  tag_path: 'Plant1.Module.RF_Fwd.setpoint',
  tag_name: null,
  data_type: 'f32',
  is_setpoint: true,
  trendable: true,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 100,
  unit: 'W',
  format: '#.#',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'setpoint', fields: {} },
  ],
};

export const mockBoolTag: TagDef = {
  tag_id: 1004,
  tag_path: 'Plant1.Module.RF_Fwd.interlock_status',
  tag_name: null,
  data_type: 'bool',
  is_setpoint: false,
  trendable: false,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: null,
  eng_max: null,
  unit: null,
  format: null,
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'interlock_status', fields: {} },
  ],
};

export const mockBoolSetTag: TagDef = {
  tag_id: 1005,
  tag_path: 'Plant1.Module.RF_Fwd.interlock_enable',
  tag_name: null,
  data_type: 'bool',
  is_setpoint: true,
  trendable: false,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: null,
  eng_max: null,
  unit: null,
  format: null,
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'interlock_enable', fields: {} },
  ],
};

// ── AnalogIn / PRF group — CARO_1.RF1.PRF.* (9 child tags) ───────────────────

const PRF_META: TagDef['meta'] = [
  { type: 'system',    name: 'CARO_1', fields: { format: 2 } },
  { type: 'module',    name: 'RF1',    fields: {} },
  { type: 'parameter', name: 'PRF',    fields: { unit: 'dBm' } },
];

function prfTag(
  id: number,
  child: string,
  dataType: 'f32' | 'bool',
  isSetpoint: boolean,
): TagDef {
  return {
    tag_id: id,
    tag_path: `CARO_1.RF1.PRF.${child}`,
    tag_name: null,
    data_type: dataType,
    is_setpoint: isSetpoint,
    trendable: true,
    module_id: 'RF1',
    module_type: 'MQTT',
    eng_min: dataType === 'f32' ? -10 : null,
    eng_max: dataType === 'f32' ? 50  : null,
    unit: dataType === 'f32' ? 'dBm' : null,
    format: null,
    meta: [...PRF_META, { type: 'tag', name: child, fields: {} }],
  };
}

export const prfSetTag  = prfTag(2001, 'Set',  'f32',  true);
export const prfMonTag  = prfTag(2002, 'Mon',  'f32',  false);
export const prfTolTag  = prfTag(2003, 'Tol',  'f32',  true);
export const prfByTag   = prfTag(2004, 'By',   'bool', true);
export const prfIntkTag = prfTag(2005, 'Intk', 'bool', false);
export const prfRssTag  = prfTag(2006, 'RSS',  'f32',  true);
export const prfPerTag  = prfTag(2007, 'Per',  'f32',  true);
export const prfInATag  = prfTag(2008, 'In_A', 'f32',  true);
export const prfInBTag  = prfTag(2009, 'In_B', 'f32',  true);

/** All 9 PRF tag defs keyed by tag_id — ready for MockHmiProvider. */
export const prfTagDefs: Record<number, TagDef> = {
  2001: prfSetTag,
  2002: prfMonTag,
  2003: prfTolTag,
  2004: prfByTag,
  2005: prfIntkTag,
  2006: prfRssTag,
  2007: prfPerTag,
  2008: prfInATag,
  2009: prfInBTag,
};

/** Good-quality live values for all 9 PRF tags. */
export const prfTagValues: Record<number, import('@caro/hmi-context').LiveValue> = {
  2001: { value: 20.5  }, // Set
  2002: { value: 15.3  }, // Mon
  2003: { value: 1.0   }, // Tol
  2004: { value: true  }, // By
  2005: { value: false }, // Intk
  2006: { value: 18.7  }, // RSS
  2007: { value: 100.0 }, // Per
  2008: { value: 21.2  }, // In_A
  2009: { value: 19.8  }, // In_B
};

// A tag with same leaf name ("monitor") but under RF_Rev — for ambiguity tests
export const mockNumericTagRev: TagDef = {
  tag_id: 1002,
  tag_path: 'Plant1.Module.RF_Rev.monitor',
  tag_name: null,
  data_type: 'f32',
  is_setpoint: false,
  trendable: true,
  module_id: 'Module',
  module_type: 'MQTT',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  format: '#.###',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Rev', fields: {} },
    { type: 'tag', name: 'monitor', fields: {} },
  ],
};
