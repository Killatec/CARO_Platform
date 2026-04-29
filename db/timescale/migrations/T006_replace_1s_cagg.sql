-- NO TRANSACTION
-- T006: Replace broken T005 1s CAG with spec-compliant shape
--
-- T005 shipped caro_samples_1s with these spec violations:
--   * count(value) instead of null_count = count(*) FILTER (WHERE value IS NULL)
--     → breaks null-as-gap contract on the CAG path (hmi_trend_viewer_spec.md §5.4)
--   * 12h chunks   (spec requires 24h per DB_Config_Usage_And_Perf.md §3)
--   * 30s refresh  (spec requires 1 min)
--   * 12h compress_after (spec requires 1h)
--
-- This migration drops caro_samples_1s and creates tag_samples_1s_cagg with:
--   * Columns: bucket, tag_id, last, null_count, min, max
--   * Flat topology: feeds from raw tag_samples (not from a smaller CAG)
--   * 24h chunks, 1-min refresh, 1h compression-after, 14-day retention
--
-- Requires NO TRANSACTION because CALL refresh_continuous_aggregate() issues
-- its own transaction control on some TimescaleDB versions.

-- ── Step 1: Remove old CAG and its policies (conditional on existence) ─────────
--
-- remove_*_policy will error if the relation does not exist, so guard the whole
-- cleanup block. Safe to skip if T005 was never applied or was already dropped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'caro_samples_1s' AND view_schema = 'public'
  ) THEN
    PERFORM remove_continuous_aggregate_policy('caro_samples_1s', if_not_exists => TRUE);
    PERFORM remove_compression_policy('caro_samples_1s', if_exists => TRUE);
    PERFORM remove_retention_policy('caro_samples_1s', if_exists => TRUE);
  END IF;
END $$;

DROP MATERIALIZED VIEW IF EXISTS caro_samples_1s CASCADE;

-- ── Step 2: Create spec-compliant 1s CAG ──────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS tag_samples_1s_cagg
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '1 second', ts) AS bucket,
  tag_id,
  last(value, ts)                                   AS last,
  count(*) FILTER (WHERE value IS NULL)             AS null_count,
  min(value)                                        AS min,
  max(value)                                        AS max
FROM tag_samples
GROUP BY bucket, tag_id
WITH NO DATA;

-- 24h chunks: larger than raw (1h) to reduce per-query chunk-open overhead on
-- the CAG; 24h is the spec setting for all four CAGs.
SELECT set_chunk_time_interval('tag_samples_1s_cagg', INTERVAL '24 hours');

-- ── Step 3: Refresh policy ────────────────────────────────────────────────────
--
-- schedule_interval = 1 min: matches the TrendSnapshotScheduler write cadence
-- (one sample/tag/60s guaranteed), so CAG data lags reality by ≤ 1 min + 1 bucket.
-- start_offset = 15 min: re-materializes any late writes within the last 15 min.
-- end_offset = 0 s: materializes up to now (combined with materialized_only = true,
-- any query past the watermark falls through to raw).
-- initial_start staggered to :00 of next minute to avoid lock contention with
-- the 10s (:15), 1min (:30), and 10min (:45) refresh jobs.

SELECT add_continuous_aggregate_policy('tag_samples_1s_cagg',
  start_offset      => INTERVAL '15 minutes',
  end_offset        => INTERVAL '0 seconds',
  schedule_interval => INTERVAL '1 minute',
  initial_start     => date_trunc('minute', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 minute',
  if_not_exists     => TRUE
);

-- ── Step 4: Compression ───────────────────────────────────────────────────────
--
-- Mirror raw layout: segment by tag_id (most queries filter by tag_id),
-- order by bucket DESC (range scans fetch newest data first).

ALTER MATERIALIZED VIEW tag_samples_1s_cagg SET (
  timescaledb.compress          = true,
  timescaledb.compress_segmentby = 'tag_id',
  timescaledb.compress_orderby   = 'bucket DESC'
);

-- compress_after = 1h: aggressive relative to 24h chunks because CAGs have no
-- late writes — data is populated only by the refresh policy, which controls
-- the materialization boundary. A closed-enough chunk is safe to compress
-- as soon as the refresh has finished writing into it.
SELECT add_compression_policy('tag_samples_1s_cagg',
  compress_after => INTERVAL '1 hour',
  if_not_exists  => TRUE
);

-- ── Step 5: Retention ─────────────────────────────────────────────────────────
--
-- 14 days: matches raw tag_samples. 1s resolution is not useful beyond the raw
-- retention window (operators querying > 14d should use the 10s or coarser CAGs).
SELECT add_retention_policy('tag_samples_1s_cagg',
  drop_after    => INTERVAL '14 days',
  if_not_exists => TRUE
);

-- ── Step 6: Backfill ──────────────────────────────────────────────────────────
--
-- Materialize all available raw data into the new CAG inline. On an empty or
-- freshly-truncated DB this is a no-op; on a production DB it may run for
-- several minutes (proportional to raw data volume). The refresh policy will
-- keep the CAG current from this point forward.
CALL refresh_continuous_aggregate('tag_samples_1s_cagg', NULL, NULL);
