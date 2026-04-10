-- =============================================================================
-- Migration: 010
-- Description: Create module_types standalone lookup table
-- Date: 2026-04-10
-- =============================================================================

-- 1. Create lookup table
CREATE TABLE IF NOT EXISTS module_types (
    id           SERIAL PRIMARY KEY,
    type_name    VARCHAR(40) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL
);

-- 2. Seed default types
INSERT INTO module_types (type_name, display_name) VALUES
    ('HMI',  'HMI'),
    ('MQTT', 'MQTT')
ON CONFLICT (type_name) DO NOTHING;
