-- =============================================================================
-- Migration: 014
-- Description: Add string, f32[], and i16[] data types to tag_types table.
-- Date: 2026-04-18
-- =============================================================================

INSERT INTO tag_types (type_name, display_name) VALUES
  ('string',  'String'),
  ('f32[]',   'Float 32 Array'),
  ('i16[]',   'Int 16 Array');
