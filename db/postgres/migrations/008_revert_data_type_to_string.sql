-- =============================================================================
-- Migration: 008
-- Description: Revert tag_registry to string data_type FK → tag_types.type_name;
--              add display_name to tag_types
-- Date: 2026-04-10
-- =============================================================================

-- 1. Add display_name column to tag_types
ALTER TABLE tag_types ADD COLUMN IF NOT EXISTS display_name VARCHAR(80);

UPDATE tag_types SET display_name = CASE type_name
    WHEN 'f32'       THEN 'Float 32'
    WHEN 'f64'       THEN 'Float 64'
    WHEN 'i32'       THEN 'Integer 32'
    WHEN 'i32_array' THEN 'Integer 32 Array'
    WHEN 'bool'      THEN 'Boolean'
    WHEN 'string'    THEN 'String'
    ELSE initcap(replace(type_name, '_', ' '))
END
WHERE display_name IS NULL;

ALTER TABLE tag_types ALTER COLUMN display_name SET NOT NULL;

-- 2. Add string data_type column back to tag_registry
ALTER TABLE tag_registry ADD COLUMN IF NOT EXISTS data_type VARCHAR(40);

-- 3. Populate from data_type_id via join
UPDATE tag_registry
SET data_type = tt.type_name
FROM tag_types tt
WHERE tt.id = tag_registry.data_type_id
  AND tag_registry.data_type IS NULL;

ALTER TABLE tag_registry ALTER COLUMN data_type SET NOT NULL;

-- 4. Drop old integer FK, index, and column
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tag_registry_data_type_id') THEN
        ALTER TABLE tag_registry DROP CONSTRAINT fk_tag_registry_data_type_id;
    END IF;
END $$;

DROP INDEX IF EXISTS idx_tag_registry_data_type_id;
ALTER TABLE tag_registry DROP COLUMN IF EXISTS data_type_id;

-- 5. Add new FK and index referencing type_name
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tag_registry_data_type') THEN
        ALTER TABLE tag_registry
            ADD CONSTRAINT fk_tag_registry_data_type
            FOREIGN KEY (data_type) REFERENCES tag_types (type_name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tag_registry_data_type
    ON tag_registry (data_type);
