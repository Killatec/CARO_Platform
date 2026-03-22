-- =============================================================================
-- Seed: dev_seed.sql
-- Description: Minimal dev seed derived from the Plant1_System_A template
--              hierarchy in apps/tag-registry/templates/.
--              Tag paths reflect the Phase 2 behaviour: prefix is the root
--              template name, not the literal string "root.".
--
-- Hierarchy resolved by resolveRegistry(templates, 'Plant1_System_A'):
--
--   Plant1_System_A (module)
--   └── RFPowerModule  ← rf_power_module (module)
--       ├── RF_Fwd     ← analog_control  (parameter, overrides: description, eng_min)
--       │   ├── setpoint        ← numeric_set  (f64,  is_setpoint=true)
--       │   ├── monitor         ← numeric_mon  (f64,  is_setpoint=false)
--       │   └── interlock_enable← boolean_set  (bool, is_setpoint=true)
--       ├── RF_Ref     ← analog_control  (parameter, no field overrides)
--       │   ├── setpoint        ← numeric_set  (f64,  is_setpoint=true)
--       │   ├── monitor         ← numeric_mon  (f64,  is_setpoint=false)
--       │   └── interlock_enable← boolean_set  (bool, is_setpoint=true)
--       └── boolean_mon         ← boolean_mon  (bool, is_setpoint=false)
-- =============================================================================

-- ── Registry revision ────────────────────────────────────────────────────────

INSERT INTO registry_revisions (registry_rev, applied_by, applied_at, comment)
VALUES (
    1,
    'dev_seed',
    '2026-03-22T00:00:00+00:00',
    'Initial dev seed from Plant1_System_A template hierarchy'
)
ON CONFLICT (registry_rev) DO NOTHING;

-- ── Tag registry rows ────────────────────────────────────────────────────────
-- tag_id values are stable logical identifiers for each tag across revisions.
-- The SERIAL `id` column is assigned by the database.

INSERT INTO tag_registry
    (tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta)
VALUES

-- 1. Plant1_System_A.RFPowerModule.RF_Fwd.setpoint
(1001, 1,
 'Plant1_System_A.RFPowerModule.RF_Fwd.setpoint',
 'f64', true, false,
 '[
   {"type": "tag",       "name": "setpoint",        "fields": {}},
   {"type": "parameter", "name": "RF_Fwd",           "fields": {"description": "Forward RF power channel", "eng_min": 55, "eng_max": 100, "Units": "V"}},
   {"type": "module",    "name": "RFPowerModule",    "fields": {"description": "Main RF power"}},
   {"type": "module",    "name": "Plant1_System_A",  "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb),

-- 2. Plant1_System_A.RFPowerModule.RF_Fwd.monitor
(1002, 1,
 'Plant1_System_A.RFPowerModule.RF_Fwd.monitor',
 'f64', false, false,
 '[
   {"type": "tag",       "name": "monitor",          "fields": {}},
   {"type": "parameter", "name": "RF_Fwd",           "fields": {"description": "Forward RF power channel", "eng_min": 55, "eng_max": 100, "Units": "V"}},
   {"type": "module",    "name": "RFPowerModule",    "fields": {"description": "Main RF power"}},
   {"type": "module",    "name": "Plant1_System_A",  "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb),

-- 3. Plant1_System_A.RFPowerModule.RF_Fwd.interlock_enable
(1003, 1,
 'Plant1_System_A.RFPowerModule.RF_Fwd.interlock_enable',
 'bool', true, false,
 '[
   {"type": "tag",       "name": "interlock_enable", "fields": {}},
   {"type": "parameter", "name": "RF_Fwd",           "fields": {"description": "Forward RF power channel", "eng_min": 55, "eng_max": 100, "Units": "V"}},
   {"type": "module",    "name": "RFPowerModule",    "fields": {"description": "Main RF power"}},
   {"type": "module",    "name": "Plant1_System_A",  "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb),

-- 4. Plant1_System_A.RFPowerModule.RF_Ref.setpoint
(1004, 1,
 'Plant1_System_A.RFPowerModule.RF_Ref.setpoint',
 'f64', true, false,
 '[
   {"type": "tag",       "name": "setpoint",         "fields": {}},
   {"type": "parameter", "name": "RF_Ref",            "fields": {"description": "RF_Param", "eng_min": 51, "eng_max": 100, "Units": "V"}},
   {"type": "module",    "name": "RFPowerModule",    "fields": {"description": "Main RF power"}},
   {"type": "module",    "name": "Plant1_System_A",  "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb),

-- 5. Plant1_System_A.RFPowerModule.RF_Ref.monitor
(1005, 1,
 'Plant1_System_A.RFPowerModule.RF_Ref.monitor',
 'f64', false, false,
 '[
   {"type": "tag",       "name": "monitor",          "fields": {}},
   {"type": "parameter", "name": "RF_Ref",            "fields": {"description": "RF_Param", "eng_min": 51, "eng_max": 100, "Units": "V"}},
   {"type": "module",    "name": "RFPowerModule",    "fields": {"description": "Main RF power"}},
   {"type": "module",    "name": "Plant1_System_A",  "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb),

-- 6. Plant1_System_A.RFPowerModule.RF_Ref.interlock_enable
(1006, 1,
 'Plant1_System_A.RFPowerModule.RF_Ref.interlock_enable',
 'bool', true, false,
 '[
   {"type": "tag",       "name": "interlock_enable", "fields": {}},
   {"type": "parameter", "name": "RF_Ref",            "fields": {"description": "RF_Param", "eng_min": 51, "eng_max": 100, "Units": "V"}},
   {"type": "module",    "name": "RFPowerModule",    "fields": {"description": "Main RF power"}},
   {"type": "module",    "name": "Plant1_System_A",  "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb),

-- 7. Plant1_System_A.RFPowerModule.boolean_mon
(1007, 1,
 'Plant1_System_A.RFPowerModule.boolean_mon',
 'bool', false, false,
 '[
   {"type": "tag",    "name": "boolean_mon",       "fields": {}},
   {"type": "module", "name": "RFPowerModule",     "fields": {"description": "Main RF power"}},
   {"type": "module", "name": "Plant1_System_A",   "fields": {"description": "Plant1_System_A stage", "version": 155}}
 ]'::jsonb)

ON CONFLICT (tag_id, registry_rev) DO NOTHING;
