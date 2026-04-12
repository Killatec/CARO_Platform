-- =============================================================================
-- Migration: 012
-- Description: Add i16 (Int 16) data type to tag_types table.
-- Date: 2026-04-11
-- =============================================================================

INSERT INTO tag_types (type_name, display_name)
VALUES ('i16', 'Int 16');
