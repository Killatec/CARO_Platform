-- NO TRANSACTION
-- T007: Create 10-second continuous aggregate
--
-- Serves windows in the 4h – 32h range (bucket_s 16–160, Div 2.88–11.52).
-- Flat topology: feeds directly from raw tag_samples, not from the 1s CAG.
-- Independent watermark preserves §4.3 fall-through correctness and isolates
-- refresh failures — a stalled 10s CAG does not cascade to the 1s CAG.
--
-- Columns: bucket, tag_id, last, null_count, min, max
-- Retention: 90 days (coarser CAGs carry longer windows)

CREATE MATERIALIZED VIEW IF NOT EXISTS tag_samples_10s_cagg
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '10 seconds', ts) AS bucket,
  tag_id,
  last(value, ts)                                   AS last,
  count(*) FILTER (WHERE value IS NULL)             AS null_count,
  min(value)                                        AS min,
  max(value)                                        AS max
FROM tag_samples
GROUP BY bucket, tag_id
WITH NO DATA;

SELECT set_chunk_time_interval('tag_samples_10s_cagg', INTERVAL '24 hours');

-- initial_start staggered to :15 of next minute to avoid lock contention
-- with 1s (:00), 1min (:30), and 10min (:45) refresh jobs.
SELECT add_continuous_aggregate_policy('tag_samples_10s_cagg',
  start_offset      => INTERVAL '15 minutes',
  end_offset        => INTERVAL '0 seconds',
  schedule_interval => INTERVAL '1 minute',
  initial_start     => date_trunc('minute', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 minute 15 seconds',
  if_not_exists     => TRUE
);

ALTER MATERIALIZED VIEW tag_samples_10s_cagg SET (
  timescaledb.compress          = true,
  timescaledb.compress_segmentby = 'tag_id',
  timescaledb.compress_orderby   = 'bucket DESC'
);

SELECT add_compression_policy('tag_samples_10s_cagg',
  compress_after => INTERVAL '1 hour',
  if_not_exists  => TRUE
);

SELECT add_retention_policy('tag_samples_10s_cagg',
  drop_after    => INTERVAL '90 days',
  if_not_exists => TRUE
);

CALL refresh_continuous_aggregate('tag_samples_10s_cagg', NULL, NULL);
