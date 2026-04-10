-- =============================================================================
-- Migration: 009
-- Description: Remove unused tag types from tag_types table; rename f64 → f32
--              in existing tag_registry rows. Keep only f32 and bool.
-- Date: 2026-04-10
-- =============================================================================

-- 1. Rename existing f64 references in tag_registry to f32
--    (must happen before we drop the f64 row from tag_types)
UPDATE tag_registry
SET data_type = 'f32'
WHERE data_type = 'f64';

-- 2. Remove unused tag types (no FK references remain after step 1)
DELETE FROM tag_types WHERE type_name IN ('f64', 'i32', 'i32_array', 'string');
