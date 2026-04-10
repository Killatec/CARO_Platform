import type { TagDef } from '../types.js';

export const mockTag: TagDef = {
  tag_id: 1001,
  tag_path: 'Plant1.Module.RF_Fwd.setpoint',
  data_type: 'f32',
  is_setpoint: true,
  module_id: 'Module',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'setpoint', fields: {} },
  ],
};

export const mockReadbackTag: TagDef = {
  tag_id: 1002,
  tag_path: 'Plant1.Module.RF_Fwd.readback',
  data_type: 'f32',
  is_setpoint: false,
  module_id: 'Module',
  eng_min: 0,
  eng_max: 5000,
  unit: 'W',
  meta: [
    { type: 'system', name: 'Plant1', fields: {} },
    { type: 'module', name: 'Module', fields: {} },
    { type: 'parameter', name: 'RF_Fwd', fields: {} },
    { type: 'tag', name: 'readback', fields: {} },
  ],
};

export const mockBoolTag: TagDef = {
  tag_id: 1004,
  tag_path: 'Plant1.Module.RF_Fwd.enabled',
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
    { type: 'tag', name: 'enabled', fields: {} },
  ],
};
