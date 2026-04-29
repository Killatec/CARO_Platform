-- NO TRANSACTION
-- T009: Create 10-minute continuous aggregate
--
-- Serves windows in the 10d – 170d range (bucket_s ≥ 1600, Div 3.07–24.58).
-- The worst-case Div (24.58 at 85–170d windows) is outside the cheap zone
-- (Div ≤ 16) but inside the usable zone (Div ≤ 30). If latency at 85+ d windows
-- exceeds the 300ms p95 budget once sufficient history accumulates, a 1h CAG
-- can be added in Phase B (hmi_trend_viewer_spec.md §17.2).
--
-- Flat topology: feeds directly from raw tag_samples.
-- Independent watermark enables §4.3 fall-through without cascading failures.
--
-- Columns: bucket, tag_id, last, null_count, min, max
-- Retention: indefinite (no retention policy — long-window diagnostic use)

CREATE MATERIALIZED VIEW IF NOT EXISTS tag_samples_10min_cagg
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '10 minutes', ts) AS bucket,
  tag_id,
  last(value, ts)                                   AS last,
  count(*) FILTER (WHERE value IS NULL)             AS null_count,
  min(value)                                        AS min,
  max(value)                                        AS max
FROM tag_samples
GROUP BY bucket, tag_id
WITH NO DATA;

SELECT set_chunk_time_interval('tag_samples_10min_cagg', INTERVAL '24 hours');

-- start_offset is 1 hour for the 10min CAG (vs 15 min for the 1s/10s/1min CAGs).
-- TimescaleDB requires (start_offset - end_offset) >= 2 * bucket_width;
-- with a 10-minute bucket the minimum window is 20 minutes. 1 hour gives
-- reasonable refresh-recovery margin without re-aggregating excessively
-- (TimescaleDB only re-touches buckets where new raw data has arrived).
--
-- initial_start staggered to :45 of next minute to avoid lock contention
-- with 1s (:00), 10s (:15), and 1min (:30) refresh jobs.
SELECT add_continuous_aggregate_policy('tag_samples_10min_cagg',
  start_offset      => INTERVAL '1 hour',
  end_offset        => INTERVAL '0 seconds',
  schedule_interval => INTERVAL '1 minute',
  initial_start     => date_trunc('minute', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 minute 45 seconds',
  if_not_exists     => TRUE
);

ALTER MATERIALIZED VIEW tag_samples_10min_cagg SET (
  timescaledb.compress          = true,
  timescaledb.compress_segmentby = 'tag_id',
  timescaledb.compress_orderby   = 'bucket DESC'
);

SELECT add_compression_policy('tag_samples_10min_cagg',
  compress_after => INTERVAL '1 hour',
  if_not_exists  => TRUE
);

-- No retention policy: indefinite retention per DB_Config_Usage_And_Perf.md §3.1.
-- Operators may need 1+ year history for process trend analysis; the 10min CAG
-- is the only tier that accumulates this long-window data.

CALL refresh_continuous_aggregate('tag_samples_10min_cagg', NULL, NULL);
