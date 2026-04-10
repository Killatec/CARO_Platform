-- =============================================================================
-- Migration: 011
-- Description: Add module and module_type nullable columns to tag_registry
-- Date: 2026-04-10
-- =============================================================================

-- 1. Add nullable columns (existing rows will have NULL)
ALTER TABLE tag_registry ADD COLUMN IF NOT EXISTS module      VARCHAR(40);
ALTER TABLE tag_registry ADD COLUMN IF NOT EXISTS module_type VARCHAR(40);

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS idx_tag_registry_module
    ON tag_registry (module);

CREATE INDEX IF NOT EXISTS idx_tag_registry_module_type
    ON tag_registry (module_type);
