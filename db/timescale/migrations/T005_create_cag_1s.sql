-- T005: Create caro_samples_1s continuous aggregate (1-second buckets)
--
-- First tier of the historian aggregation hierarchy. Aggregates raw
-- tag_samples into 1-second buckets to enable fast trend rendering for
-- short windows (~1 min to ~1 day) without scanning raw data.
--
-- Aggregates:
--   * last(value, ts)  — primary; used by trend tile endpoint with LOCF
--   * min(value)       — trend min/max bands
--   * max(value)       — trend min/max bands
--   * count(value)     — sample density indicator (NULL-aware)
--
-- Hypertable config:
--   * chunk_time_interval = 12h
--     Sized to keep open-chunk row count similar to raw 1h chunks
--     (~22M rows per open chunk at 504 trendable tags). See
--     historian_perf_battery_2026-04-24.md for the heap-scatter cliff
--     analysis that justifies this sizing.
--   * compress_segmentby = tag_id (mirrors raw)
--   * compress_orderby   = bucket DESC
--   * compress_after     = 12h (waits for chunk close)
--   * schedule_interval  = 5 min (mirrors raw)
--
-- Refresh policy:
--   * start_offset = 1 day  (recomputes late writes within last 24h)
--   * end_offset   = 10 sec (avoids materializing the trailing partial bucket)
--   * schedule     = 30 sec (~10 sec data lag at the seam)
--
-- Retention: 14 days, matching raw. Coarser CAGs (1m, 1h, 1d) will
-- carry longer windows in subsequent migrations.

CREATE MATERIALIZED VIEW IF NOT EXISTS caro_samples_1s
WITH (timescaledb.continuous) AS
SELECT
  tag_id,
  time_bucket(INTERVAL '1 second', ts) AS bucket,
  last(value, ts)  AS value_last,
  min(value)       AS value_min,
  max(value)       AS value_max,
  count(value)     AS value_count
FROM tag_samples
GROUP BY tag_id, bucket
WITH NO DATA;

-- Set chunk interval on the materialized hypertable.
SELECT set_chunk_time_interval('caro_samples_1s', INTERVAL '12 hours');

-- Primary access pattern: per-tag time-range scan on the open chunk
-- (mirrors raw idx_tag_samples_tagid_ts).
CREATE INDEX IF NOT EXISTS idx_caro_samples_1s_tagid_bucket
  ON caro_samples_1s (tag_id, bucket DESC);

-- Continuous aggregate refresh policy must be registered before compression
-- can be enabled on the CAG (TimescaleDB requirement).
-- end_offset = 10s ensures we never materialize an in-progress 1s bucket
-- (must be > bucket width). start_offset = 1d backfills any late writes.
SELECT add_continuous_aggregate_policy(
  'caro_samples_1s',
  start_offset      => INTERVAL '1 day',
  end_offset        => INTERVAL '10 seconds',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists     => TRUE
);

-- Compression: same shape as raw (segment by tag_id, order by time DESC).
ALTER MATERIALIZED VIEW caro_samples_1s SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'tag_id',
  timescaledb.compress_orderby   = 'bucket DESC'
);

-- Compress chunks after 12h (chunk has closed; safe to compress).
SELECT add_compression_policy(
  'caro_samples_1s',
  compress_after    => INTERVAL '12 hours',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists     => TRUE
);

-- Retention: drop chunks older than 14 days (matches raw).
SELECT add_retention_policy('caro_samples_1s', INTERVAL '14 days', if_not_exists => TRUE);
