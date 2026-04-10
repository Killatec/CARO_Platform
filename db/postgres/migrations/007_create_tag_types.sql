-- =============================================================================
-- Migration: 007
-- Description: Create tag_types lookup table; migrate tag_registry.data_type to integer FK
-- Date: 2026-04-10
-- =============================================================================

-- 1. Create lookup table
CREATE TABLE IF NOT EXISTS tag_types (
    id         SERIAL PRIMARY KEY,
    type_name  VARCHAR(40) NOT NULL UNIQUE
);

-- 2. Seed default types (id assignment is deterministic via SERIAL)
INSERT INTO tag_types (type_name) VALUES
    ('f32'),
    ('f64'),
    ('i32'),
    ('i32_array'),
    ('bool'),
    ('string')
ON CONFLICT (type_name) DO NOTHING;

-- 3. Add new integer column
ALTER TABLE tag_registry ADD COLUMN IF NOT EXISTS data_type_id INTEGER;

-- 4. Populate from existing VARCHAR data_type column
UPDATE tag_registry
SET data_type_id = tt.id
FROM tag_types tt
WHERE tt.type_name = tag_registry.data_type
  AND tag_registry.data_type_id IS NULL;

-- 5. Set NOT NULL
ALTER TABLE tag_registry ALTER COLUMN data_type_id SET NOT NULL;

-- 6. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_tag_registry_data_type_id'
    ) THEN
        ALTER TABLE tag_registry
            ADD CONSTRAINT fk_tag_registry_data_type_id
            FOREIGN KEY (data_type_id) REFERENCES tag_types (id);
    END IF;
END $$;

-- 7. Add index on new column
CREATE INDEX IF NOT EXISTS idx_tag_registry_data_type_id
    ON tag_registry (data_type_id);

-- 8. Drop old VARCHAR column and its index
DROP INDEX IF EXISTS idx_tag_registry_data_type;
ALTER TABLE tag_registry DROP COLUMN IF EXISTS data_type;
