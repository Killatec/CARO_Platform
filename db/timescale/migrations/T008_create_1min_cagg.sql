-- NO TRANSACTION
-- T008: Create 1-minute continuous aggregate
--
-- Serves windows in the 32h – 10d range (bucket_s 160–1600, Div 3.84–15.36).
-- Flat topology: feeds directly from raw tag_samples.
-- Independent watermark enables §4.3 fall-through without cascading failures.
--
-- Columns: bucket, tag_id, last, null_count, min, max
-- Retention: 365 days (1 year)

CREATE MATERIALIZED VIEW IF NOT EXISTS tag_samples_1min_cagg
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '1 minute', ts) AS bucket,
  tag_id,
  last(value, ts)                                   AS last,
  count(*) FILTER (WHERE value IS NULL)             AS null_count,
  min(value)                                        AS min,
  max(value)                                        AS max
FROM tag_samples
GROUP BY bucket, tag_id
WITH NO DATA;

SELECT set_chunk_time_interval('tag_samples_1min_cagg', INTERVAL '24 hours');

-- initial_start staggered to :30 of next minute to avoid lock contention
-- with 1s (:00), 10s (:15), and 10min (:45) refresh jobs.
SELECT add_continuous_aggregate_policy('tag_samples_1min_cagg',
  start_offset      => INTERVAL '15 minutes',
  end_offset        => INTERVAL '0 seconds',
  schedule_interval => INTERVAL '1 minute',
  initial_start     => date_trunc('minute', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 minute 30 seconds',
  if_not_exists     => TRUE
);

ALTER MATERIALIZED VIEW tag_samples_1min_cagg SET (
  timescaledb.compress          = true,
  timescaledb.compress_segmentby = 'tag_id',
  timescaledb.compress_orderby   = 'bucket DESC'
);

SELECT add_compression_policy('tag_samples_1min_cagg',
  compress_after => INTERVAL '1 hour',
  if_not_exists  => TRUE
);

SELECT add_retention_policy('tag_samples_1min_cagg',
  drop_after    => INTERVAL '365 days',
  if_not_exists => TRUE
);

CALL refresh_continuous_aggregate('tag_samples_1min_cagg', NULL, NULL);
