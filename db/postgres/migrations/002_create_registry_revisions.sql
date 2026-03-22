-- =============================================================================
-- Migration: 002
-- Description: Create registry_revisions table
-- Date: 2026-03-22
-- =============================================================================

CREATE TABLE IF NOT EXISTS registry_revisions (
    registry_rev INTEGER     PRIMARY KEY,
    applied_by   VARCHAR     NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL,
    comment      TEXT        NOT NULL
);
