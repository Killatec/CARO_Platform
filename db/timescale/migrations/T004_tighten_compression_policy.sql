-- T004: Tighten chunk interval and compression policy for faster cold reads
--
-- Perf measurement on 2026-04-23 showed compressed chunks deliver 60× faster
-- single-tag 5-min reads than uncompressed (mean 9 ms vs 547 ms; p95 11 ms
-- vs 1,125 ms). Uncompressed queries are random-I/O bound due to
-- insertion-order heap layout; compressed chunks are fast because
-- compress_segmentby = tag_id clusters each tag's data into contiguous
-- segments and the heap becomes a ~10× smaller columnar store.
--
-- With chunk_time_interval = 1 h and compress_after = 10 min, max
-- uncompressed footprint is ~1 h 15 min (~900 MB at 10 Hz × 360 tags),
-- which fits comfortably in PG shared_buffers + OS page cache. Fraction
-- of queries hitting uncompressed data drops from ~7% (24 h / 14 d) to
-- <1% (1h 15min / 14 d).
--
-- Late-write tolerance: writes arriving up to ~10 min after a chunk closes
-- land in the uncompressed chunk cheaply. Later arrivals would trigger
-- decompress-then-rewrite (one-shot expensive). Tight enough for the local
-- HMI → MQTT → DB pipeline where the writer is sub-second; loosen
-- compress_after if this ever moves to a deployment with unreliable transports.

SELECT set_chunk_time_interval('tag_samples', INTERVAL '1 hour');

SELECT remove_compression_policy('tag_samples', if_exists => TRUE);
SELECT add_compression_policy(
  'tag_samples',
  compress_after    => INTERVAL '10 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists     => TRUE
);
