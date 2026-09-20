CREATE TABLE IF NOT EXISTS pending_setpoint_values (
  tag_id  INTEGER      NOT NULL PRIMARY KEY,
  value   JSONB        NOT NULL,
  set_by  VARCHAR(255),
  set_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
