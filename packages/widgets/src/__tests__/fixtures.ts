import type { TagDef } from '@caro/hmi-context';

export const mockNumericTag: TagDef = {
  tag_id: 1001,
  tag_path: 'Plant1.Module.RF_Fwd.monitor',
  data_type: 'f64',
  is_setpoint: false,
  module_id: 'Module',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: { format: 3 } },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'monitor', fields: {} },
  ],
};

export const mockSetpointTag: TagDef = {
  tag_id: 1003,
  tag_path: 'Plant1.Module.RF_Fwd.setpoint',
  data_type: 'f64',
  is_setpoint: true,
  module_id: 'Module',
  eng_min: 0,
  eng_max: 100,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: { format: 1 } },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'setpoint', fields: {} },
  ],
};

export const mockBoolTag: TagDef = {
  tag_id: 1004,
  tag_path: 'Plant1.Module.RF_Fwd.interlock_status',
  data_type: 'bool',
  is_setpoint: false,
  module_id: 'Module',
  eng_min: null,
  eng_max: null,
  unit: null,
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
  data_type: 'bool',
  is_setpoint: true,
  module_id: 'Module',
  eng_min: null,
  eng_max: null,
  unit: null,
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'interlock_enable', fields: {} },
  ],
};

// A tag with same leaf name ("monitor") but under RF_Rev — for ambiguity tests
export const mockNumericTagRev: TagDef = {
  tag_id: 1002,
  tag_path: 'Plant1.Module.RF_Rev.monitor',
  data_type: 'f64',
  is_setpoint: false,
  module_id: 'Module',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: { format: 3 } },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Rev', fields: {} },
    { type: 'tag', name: 'monitor', fields: {} },
  ],
};
