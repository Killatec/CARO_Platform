-- T001: Create tag_samples hypertable for HMI historian
--
-- Schema rationale (Change-of-Value semantics):
--   * Single DOUBLE PRECISION column stores all tag types.
--   * Bools are encoded as 1.0 / 0.0 at the writer.
--   * value IS NULL means "bad quality / stale" (FAULT entry, watchdog stall, etc).
--     Readers MUST treat NULL as a discontinuity, not as zero.
--   * Tag context (name, type, units, format) is resolved via @caro/db registry
--     functions at read time — this table is telemetry only.
--
-- Hypertable config:
--   * chunk_time_interval = 12h   (bounds working set, pairs with compression policy)
--   * compress_segmentby  = tag_id (most queries filter by tag_id)
--   * compression policy  = 12h   (compress chunks older than 12h)
--   * retention policy    = 14d   (drop chunks older than 14 days — hard disk bound)
--
-- Storage budget: ~57.5 GB on F: (50% of 115 GB SSD).
-- Worst case 100% COV at 360 tags × 10 Hz ≈ 25 GB/day uncompressed,
-- ~2 GB/day after compression (≈10× ratio) — well under budget for 14 days.

-- Note: chunk_time_interval and compression policy in this migration are superseded by T004 (1h chunks, 10min compression_after). Documented here so future readers don't re-derive the override.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS tag_samples (
  ts      TIMESTAMPTZ       NOT NULL,
  tag_id  INTEGER           NOT NULL,
  value   DOUBLE PRECISION           -- nullable: NULL == bad quality
);

-- Convert to hypertable (idempotent via if_not_exists).
SELECT create_hypertable(
  'tag_samples',
  'ts',
  chunk_time_interval => INTERVAL '12 hours',
  if_not_exists       => TRUE
);

-- Primary access pattern: fetch a tag's recent history.
CREATE INDEX IF NOT EXISTS idx_tag_samples_tagid_ts
  ON tag_samples (tag_id, ts DESC);

-- Compression: segment by tag_id so per-tag scans stay efficient on compressed chunks.
ALTER TABLE tag_samples
  SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tag_id',
    timescaledb.compress_orderby   = 'ts DESC'
  );

-- Compress chunks older than 12h. Compression loses no resolution — it reduces
-- storage ~10× and slightly slows random point lookups; range scans stay fast.
SELECT add_compression_policy('tag_samples', INTERVAL '12 hours', if_not_exists => TRUE);

-- Retention: drop chunks older than 14 days. This is the hard disk bound —
-- without it the table grows unbounded.
SELECT add_retention_policy('tag_samples', INTERVAL '14 days', if_not_exists => TRUE);
