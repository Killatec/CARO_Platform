-- =============================================================================
-- Migration: 017
-- Description: Add i32 (Int 32) data type to tag_types table.
-- Date: 2026-10-01
-- =============================================================================

INSERT INTO tag_types (type_name, display_name)
VALUES ('i32', 'Int 32')
ON CONFLICT (type_name) DO NOTHING;
