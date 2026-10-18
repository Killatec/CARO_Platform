-- =============================================================================
-- Migration: 018
-- Description: Create commanded_setpoints — the last commanded value of every
--              Set (SQL NULL = unpopulated), read for setpoint re-delivery.
--              Seeded once from pending_setpoint_values, which keeps its own
--              role (CARO_DB_Spec §7.1).
-- Date: 2026-10-18
-- =============================================================================

CREATE TABLE IF NOT EXISTS commanded_setpoints (
  tag_id      INTEGER      NOT NULL PRIMARY KEY,
  value       JSONB,
  ack_status  VARCHAR(16)  NOT NULL CHECK (ack_status IN ('accepted', 'timeout')),
  set_by      VARCHAR(255),
  set_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO commanded_setpoints (tag_id, value, ack_status, set_by, set_at)
SELECT tag_id, value, 'accepted', set_by, set_at
FROM pending_setpoint_values
ON CONFLICT (tag_id) DO NOTHING;
