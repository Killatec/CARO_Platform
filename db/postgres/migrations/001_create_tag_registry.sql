-- =============================================================================
-- Migration: 001
-- Description: Create tag_registry table
-- Date: 2026-03-22
-- =============================================================================

CREATE TABLE IF NOT EXISTS tag_registry (
    id           SERIAL PRIMARY KEY,
    tag_id       BIGINT      NOT NULL,
    registry_rev INTEGER     NOT NULL,
    tag_path     VARCHAR     NOT NULL,
    data_type    VARCHAR(40) NOT NULL,
    is_setpoint  BOOLEAN     NOT NULL,
    retired      BOOLEAN     NOT NULL DEFAULT false,
    meta         JSONB       NOT NULL,

    CONSTRAINT uq_tag_registry_tag_rev UNIQUE (tag_id, registry_rev)
);

-- Partial unique index: no two active (non-retired) rows may share a tag_path
CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_registry_active_path
    ON tag_registry (tag_path)
    WHERE retired = false;

-- B-tree indexes for common lookup patterns
CREATE INDEX IF NOT EXISTS idx_tag_registry_tag_id
    ON tag_registry (tag_id);

CREATE INDEX IF NOT EXISTS idx_tag_registry_registry_rev
    ON tag_registry (registry_rev);

CREATE INDEX IF NOT EXISTS idx_tag_registry_data_type
    ON tag_registry (data_type);

CREATE INDEX IF NOT EXISTS idx_tag_registry_retired
    ON tag_registry (retired);

-- GIN index for JSONB meta field queries
CREATE INDEX IF NOT EXISTS idx_tag_registry_meta
    ON tag_registry USING GIN (meta);
