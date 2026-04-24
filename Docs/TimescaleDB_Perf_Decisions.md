# TimescaleDB Performance Investigation and Decisions

**Date:** 2026-04-23
**Scope:** Investigation into query performance against the `tag_samples` hypertable for the HMI Trend Viewer, the configuration changes that resulted, and where the Trend Viewer implementation stands at the end of the session.

---

## Background

Step 3 of the Trend Viewer implementation landed the REST endpoint `GET /api/v1/trends/tile` and its first perf baseline against real data. The baseline revealed one catastrophic outlier: L4 (`bucket_s = 600`, `tileSpan = 100h`) at 50 tags returned in 317 seconds cold. Every other level was within workable bounds. The rest of this document covers the investigation into why L4 was so slow, what was actually measured, and the configuration changes made.

At session start the Timescale DB had been collecting approximately 60 hours of data at the simulator's effective rate of about 4.8 samples per second per tag across roughly 360 active tags. T001 defined the hypertable with `chunk_time_interval = 12h`, `compress_segmentby = tag_id`, `compress_orderby = ts DESC`, `compress_after = 12h`, and `retention = 14 days`.

## Initial Perf Baseline

Collected via `TIMESCALE_LOG_TILE_QUERIES=1` against the running HMI server. Cold was the first request for a given parameter set, warm was the immediate follow-up. Fifty tags were drawn from the platform's trendable tag pool.

| Row | bucket_s | Tags | Tile span | Cold ms | Warm ms | Payload |
|---|---|---|---|---|---|---|
| 1 | 0 (raw) | 1 | 1h | 30.2 | 2.6 | 9.8 KB |
| 2 | 0 | 10 | 1h | 2,063 | 508 | 4.75 MB |
| 3 | 0 | 50 | 1h | 4,462 | 2,159 | 25.88 MB |
| 4 | 1 (L1) | 1 | 10min | 122.1 | 28.5 | 1.3 KB |
| 5 | 1 | 50 | 10min | 254 | 254 | 216 KB |
| 6 | 600 (L4) | 50 | 100h | 317,480 | 206,612 | 184 KB |

Rows 1 through 5 were within workable bounds. Row 6 was unusable: 317 seconds of server compute per L4 tile request, and warm cache improved it only to ~207 seconds. The investigation focused on understanding why.

## Deep-Dive Investigation

### Chunk inventory and index verification

Six chunks existed at session start. One was the pre-epoch sandbox chunk used by integration tests. The five production chunks covered about 60 hours of data. Three chunks (the oldest) were compressed per policy. Two (the most recent 24 hours) were uncompressed: one still receiving writes, and one waiting out the 12-hour compression lag.

Index audit confirmed the expected setup was in place. The parent hypertable had both the Timescale-auto `tag_samples_ts_idx` on `(ts DESC)` and the T001-defined `idx_tag_samples_tagid_ts` on `(tag_id, ts DESC)`. Both indexes had propagated to every chunk. Compressed backing chunks had their own `(tag_id, _ts_meta_min_1, _ts_meta_max_1)` composite index, created automatically from `compress_segmentby = tag_id` plus `compress_orderby = ts DESC`. Index usage stats showed the `idx_tag_samples_tagid_ts` being hit heavily on the active uncompressed chunks and ignored entirely on compressed chunks (the planner uses the compressed-backing composite index instead). This was correct behavior.

### Single-query `EXPLAIN ANALYZE`, uncompressed vs compressed

The same query shape — fetch 5 minutes of raw data for `tag_id = 1091` — was run against the middle of an uncompressed chunk and the middle of a compressed chunk. Both runs cold, both runs warm.

On the uncompressed chunk (`_hyper_1_5_chunk`):

| Cache | Execution | Buffers read | Buffers hit |
|---|---|---|---|
| Cold | 620 ms | 2,769 | 20 |
| Warm | 3.0 ms | 0 | 2,789 |

The cold result was revelatory. The index correctly identified 2,746 target rows, but those rows were scattered across 2,769 disk pages, meaning roughly one page fetched per target row. At 8 KB per page that's ~22 MB of random disk I/O to return ~44 KB of data — a 500× I/O amplification factor. The cause is the uncompressed heap layout: data is stored in insertion order, which for our multi-tag write pattern produces pages with samples from ~360 tags interleaved chronologically. A per-tag query has to touch most pages in the time range to extract one tag's fraction of each page.

On the compressed chunk (`_hyper_1_3_chunk`):

| Cache | Execution | Buffers read | Buffers hit |
|---|---|---|---|
| Cold | 34.6 ms | ~21 | ~40 |
| Warm | 0.68 ms | 0 | ~40 |

Compressed was faster than uncompressed in every cache state. Cold compressed beat cold uncompressed by 18×; warm by 4.4×. The plan explained why: the compressed backing table's composite index found just 3 compressed row-groups covering the tag's entire chunk of data, those row-groups were decompressed in one `Bulk Decompression` pass, and a vectorized filter dropped the samples outside the 5-min window. No random I/O. This inverted the "compression is a storage tradeoff" mental model: for per-tag time-range reads against our workload, compression is an accelerator, not an overhead.

### 100-query battery v1, before manual compression of chunk 5

A scripted battery of 100 random 5-minute windows per chunk (interleaved execution to control for cache warm-up) produced the distributions:

| | Compressed chunk 3 | Uncompressed chunk 5 |
|---|---|---|
| Mean | 9.66 ms | 546.72 ms |
| Median | 9.48 ms | 526.55 ms |
| Min | 7.07 ms | 7.78 ms |
| Max | 14.67 ms | 1,164.35 ms |
| p95 | 13.57 ms | 1,125.03 ms |
| Std dev | 1.92 ms | 409.31 ms |

The compressed distribution was nearly deterministic. The uncompressed distribution was bimodal: a small handful of lucky cache-hit queries at ~8 ms, and the rest of the distribution spread over 300 ms to 1,164 ms. Even after 190 queries, the uncompressed chunk's pages were still not fully cached — at 7 GB of raw data, a 12-hour uncompressed chunk is too large for typical PostgreSQL `shared_buffers` and is only partially accommodated by OS page cache on a modest machine.

### 100-query battery v2, after manual compression of chunk 5

Manual compression of chunk 5 via `compress_chunk()` took approximately 10 minutes for the 7 GB chunk. After compression, the battery was rerun.

| | Compressed chunk 3 | Newly-compressed chunk 5 |
|---|---|---|
| Mean | 9.08 ms | 15.11 ms |
| Median | 8.81 ms | 8.44 ms |
| p95 | 11.86 ms | 10.76 ms |
| Max | 12.53 ms | 312.93 ms |

Median and p95 for the newly-compressed chunk were indistinguishable from the previously-compressed control chunk. The mean of the newly-compressed chunk was pulled up by a single outlier (probably a briefly-cold segment). Overall the hypothesis was confirmed: the distinction between compressed and uncompressed chunks is the dominant factor in per-tag query latency and variance. Compression reorganizes data by `(tag_id, ts DESC)`, which is exactly the clustering a per-tag time-range query wants.

### Tag-scaling battery on compressed chunk 3

With compression now established as the right path, the next question was how query cost scales with tag count from 1 to 20 (the spec cap), using randomly-sampled tags from the trendable pool to avoid tag-specific cache bias.

The scaling curve fit a linear model very cleanly:

```
mean_ms(N) ≈ 4.3 + 7.35 × N
```

At N=1: 11.67 ms observed, 11.65 ms predicted. At N=10: 80.64 observed, 77.8 predicted. At N=20: 151.30 observed, 151.3 predicted. Per-tag cost started at ~11.7 ms at N=1 (dominated by fixed overhead), dropped to around 8 ms by N=4, and stabilized at ~7.5 to 7.9 ms per tag from N=7 onward. At the spec cap of 20 tags, mean was 151 ms and p95 was 168 ms — predictable and within UX budget.

Variance stayed tight (std 3 to 10 ms) for most N values, with occasional outliers at a few N values producing max spikes in the 300 to 440 ms range. These outliers didn't correlate with N and appeared to be system-level noise (other PG activity, compression jobs, OS scheduler preemption).

### `EXPLAIN ANALYZE` decomposition at N=20

A plan-level decomposition at N=20 revealed where the ~7.35 ms per-tag cost actually lives, and it was not where I initially assumed.

For the raw query at N=20 against chunk 3, DB execution time was 40.6 ms — far less than the observed 151 ms mean from the battery. The difference, about 110 ms, lives in the pg-node result transfer pipeline. At 55,325 rows per N=20 query and roughly 2 μs per row for the pg wire protocol plus JS array construction, the serialization path accounts for most of the per-tag marginal cost. So the `4.3 + 7.35 × N` model decomposes as roughly 2 ms per tag of actual DB decompression work plus 5 ms per tag of pg-node row serialization.

For the aggregate query at N=20 on 1-second buckets (the shape `queryAggregate` uses for L1 tiles), DB execution time was 23.0 ms. The ColumnarScan decompression was the same as the raw query (it has to touch the same source data), but the output row count dropped from 35,685 rows to 3,900 rows because `GroupAggregate` collapses samples into buckets inside the DB. End-to-end predicted aggregate cost at N=20 for a 5-min window is about 33 ms.

### L4 extrapolation

With the aggregate cost model in hand, L4 × 20 tags on fully-compressed data was extrapolated at approximately 22 seconds of DB time. Decomposed: about 52,000 compressed segments to decompress at 0.23 ms each (~12 s) plus GroupAggregate over 47 M source samples at ~0.22 μs each (~10 s). Still well above any interactive-UX budget, confirming that compression alone does not solve L4 — CAGs would be needed to make the historical zoom levels responsive.

For L3 (10h tile) the extrapolation was ~4 seconds, borderline usable. For L2 (100m tile) about 650 ms. For L1 (10m tile) about 65 ms.

## Key Findings

The uncompressed heap layout, not the index or aggregation logic, was the root cause of the L4 catastrophe. Per-tag queries against uncompressed chunks pay an I/O amplification factor of roughly 500× because insertion-order storage interleaves samples from many tags on each page. This amplification is fundamental to how PostgreSQL stores rows — it is not tunable through indexing.

Compression fixes this layout problem as a side effect of its primary purpose. The `compress_segmentby = tag_id` setting clusters each tag's data into contiguous segments and stores them in a custom columnar format. A per-tag query then touches one segment per tag rather than scattering across thousands of pages. This is effectively a `CLUSTER BY (tag_id, ts DESC)` operation fused with 10× storage compression.

For multi-tag queries at the spec cap of 20 tags, scaling is linear at about 7.35 ms per tag after fixed overhead, with decompression work accounting for roughly 2 ms per tag and pg-node serialization accounting for most of the remainder. Aggregate queries are substantially cheaper than raw queries because the output row count drops by about 10× inside the DB before hitting the wire.

Uncompressed chunk size matters independently for cache behavior. A 12-hour uncompressed chunk is about 7 GB at our data rate, which does not fit comfortably in typical PostgreSQL `shared_buffers` plus OS page cache. Random-window queries against such a chunk experience the cold-page-fetch cost repeatedly. Shrinking the chunk to 1 hour reduces uncompressed footprint to roughly 600 MB, which fits in cache and collapses the cold-read tail.

Under the original 12h chunk + 12h compress_after configuration, any query whose time window overlapped the last 24 hours could hit uncompressed data, exposing it to the 500× I/O amplification. That is roughly 7% of queries over a 14-day retention window. Under a 1h chunk + 10min compress_after configuration, only queries hitting the last ~75 minutes see uncompressed data — under 1% of queries.

## Decisions

The configuration settled on is `chunk_time_interval = 1h`, `compress_after = 10 min`, `schedule_interval = 5 min`. This caps uncompressed footprint at approximately 1h 15min of data (~900 MB), fits comfortably in cache, and absorbs late-arriving writes up to ~10 minutes past chunk close before they would trigger a decompress-and-rewrite. The configuration is expressed in migration T004.

The JSON-plus-optional-gzip wire format is retained. Binary encoding was considered and quantified: it would save 2–3× on uncompressed payload for raw tiles and 2× for aggregates, but JSON+gzip captures most of the payload benefit at essentially zero implementation cost, and for our LAN deployment target the wire is not the bottleneck anyway. The `HMI_TRENDS_GZIP` environment flag remains available as a deployment-time toggle.

The dense 600-bucket response shape is kept for aggregates in Phase A. A sparse representation (ship only populated buckets plus the seed, reconstruct the grid client-side via LOCF) was identified as a legitimate Phase B optimization worth ~5–10× payload reduction at L1 but was deferred; the Open Questions bullet is pending a spec touch in Step 4.

CAGs for L3 and L4 were discussed, a migration direction was scoped, but the implementation was deferred pending confirmation of actual post-compression L4 performance against the new configuration. The extrapolation (~22 s for L4 × 20 tags fully-compressed) suggests CAGs will still be needed for historical zoom levels, but the measurement will decide.

Raw tiles are kept narrow via client-side policy. At 20 tags × 10 Hz a fully-saturated raw tile exceeds 250 KB; client code in Step 4 must limit raw to windows under roughly 5 minutes. Confirming exact spec §6 guidance on raw window limits is an item for Step 4.

## Migration Landed

`db/timescale/migrations/T004_tighten_compression_policy.sql` shrinks `chunk_time_interval` to 1h, replaces the compression policy with `compress_after = 10 min` and `schedule_interval = 5 min`, and carries a comment block explaining the measurements that justified the change. The migration is idempotent and safe to re-run. It was not applied by hand — it is picked up by `runTimescaleMigrations` on HMI startup.

Data wipe was performed manually via `TRUNCATE tag_samples;` in DBeaver between stopping and restarting the HMI. This was done rather than attempting to reorganize existing chunks, because existing 12h chunks cannot be resized in place and losing test data was acceptable. One delta file entry was added to `Docs/hmi_trends_deltas.md` capturing the configuration change and its justification.

## Trend Viewer Deployment Status

The Trend Viewer implementation is progressing along the Phase A build order from spec §17.1.1. Completed so far:

Prompt 0 reorganized `packages/db` to have a `timescale/` subfolder. Step 1 landed the raw tile path in `getTrendTile` and its test infrastructure (`packages/db/__tests__/helpers/trends-test-range.ts` with the pre-epoch sandbox). Step 2 added the aggregate path via a seed-subquery plus per-bucket-last pattern plus a JS LOCF walk in `assembleAggregateSeries`, handling the "null as a value" semantic. Prompt 2.5 renamed the bucket parameter unit from milliseconds to seconds platform-wide. Step 3 landed the REST endpoint at `GET /api/v1/trends/tile` in the HMI server, with envelope wrapping, error-code-to-HTTP-status translation, `HMI_TRENDS_GZIP` wiring scoped to the trends mount, and comprehensive unit and integration tests (17 new tests, 188 HMI tests passing total).

The Pre-Step-4 verification confirmed two items from spec §6: the response body convention is camelCase (per §6.2), complementary to the snake_case query-param convention of §6.1, and the 20-tag request cap has explicit spec backing (§6.1 and §6.6). A single delta line captures the URL/body naming convention to prevent future confusion.

The measurement-driven Step 3.5 work in this session produced the T004 migration. The HMI is now running on the new compression configuration, and data is accumulating under the new `chunk_time_interval = 1h` setting.

## Where the Session Ended

The HMI is running under the new configuration. T004 has been applied. The first post-migration chunk is accumulating data. Two items are pending that drive the next work:

The L4 re-measurement has not yet been performed. After approximately two hours of runtime, enough data will exist to rerun the aggregate perf battery against a tile that spans mostly post-migration compressed chunks. The specific query to rerun is `bucket_s = 600, tag_count = 20, tile = current L4 index` with `TIMESCALE_LOG_TILE_QUERIES = 1`. Result will decide whether Step 3.5b (CAG migrations for L3 and L4) is on the critical path for Step 4 or can be deferred.

The migration-blocking verification prompt was authored but not executed. It would confirm that `runTimescaleMigrations` blocks HMI startup until migrations complete, guaranteeing no writes land under the pre-migration chunk settings. The T004 rollout proceeded without running this verification; empirically the new config was picked up correctly, which strongly implies migrations do block, but the formal confirmation is still available to run for belt-and-braces certainty or to document for the platform handoff.

Two smaller items remain open. The client-LOCF Open Question bullet for `Docs/hmi_trend_viewer_spec.md` is pending the next spec touch — it did not land in Step 3 because the spec only needed its Open Questions section edited and that was already done for the client-side LOCF item's predecessor. The "tileIndex >= 1 for integration tests needing pre-tile seed writes" comment was captured in `packages/db/__tests__/helpers/trends-test-range.ts` during Step 3.

## Immediate Next Actions

The concrete next step is to wait approximately two hours for the post-migration data to accumulate, then rerun the L4 × 20 tags measurement. Based on the result, one of two paths opens up. If L4 lands under ~5 seconds on post-migration compressed data, CAGs can be deferred and work proceeds directly to Step 4 (the client-side `packages/trend-chart/` package). If L4 is still in the tens of seconds, Step 3.5b is drafted: CAG migrations for L3 (1-minute buckets) and L4 (10-minute buckets), plus dispatch logic in `queryAggregate` to select from the CAG view when `bucket_s` is in {60, 600}.

Step 4 itself covers the client-side trend chart rendering, hooks, mode state machine, live-tail via SnapshotEmitter, and tag picker. It is the largest remaining Phase A item by scope. Its sizing depends on the L4 measurement (which determines whether the server path is solid first) and the perf baseline in the new configuration (which informs client-side caching and parallelism strategy).

## Artifacts

Migration: `db/timescale/migrations/T004_tighten_compression_policy.sql`
Delta file: `Docs/hmi_trends_deltas.md` (one added line capturing T004)
Perf scripts: `packages/db/scripts/perf-single-tag.ts` and `packages/db/scripts/perf-tag-scaling.ts`, both runnable via `pnpm --filter @caro/db perf:single-tag` and `pnpm --filter @caro/db perf:tag-scaling` respectively.

---

## Post-Session Addenda

### TrendSnapshotScheduler

The session that ended with T004 also implemented `TrendSnapshotScheduler` (`apps/caro-hmi/server/src/trend-snapshot-scheduler.ts`). The scheduler provides a guaranteed minimum of one DB row per trendable tag per minute, addressing the LOCF seed problem for tags that are silent (no value changes) between trend tile reads.

Two complementary write paths handle different module behavior:

**Piggyback path (active modules):** Each scheduler tick arms a per-module flag in `TelemetryIntake`. When the module's next MQTT telemetry frame arrives, `ingest()` consumes the flag and writes the full trendable-tag set from LKV to the historian using `message.timestamp` as `moduleTs`. This means the snapshot row is anchored to the module's own clock rather than server wall clock, and it piggybacks on existing MQTT traffic rather than creating an extra write transaction.

**Force-write path (silent modules):** If a module's flag is still set at the next tick (no telemetry arrived in the interval), `tick()` calls `forceTrendSnapshot()` directly. This writes the full trendable-tag set from LKV with `moduleTs = Date.now()`. LKV returns null for tags that have never received a sample — these are intentionally preserved in the snapshot as LOCF seeds for bad-quality or offline tags.

The scheduler runs inside `DutyTracker.track()`. It is controlled by two env vars: `TREND_SNAPSHOT_ENABLED` (default `true`) and `TREND_SNAPSHOT_INTERVAL_MS` (default `60000`). Shutdown is handled via `trendSnapshotScheduler.stop()` before `dbPipeline.stop()` in the graceful shutdown path.

### HMI trendable tag inventory

An investigation during this session confirmed that as of 2026-04-23, only **one HMI tag** has `trends = true` in the tag registry: `CARO_1.HMI.Trend_Info.DB_Size` (tag_id = 2654). DB_Size grows slowly (TimescaleDB allocates in chunks), so COV filtering suppresses nearly every 250 ms publish tick. TrendSnapshotScheduler's force-write path provides the guaranteed minimum one row per minute for this tag.

All other `module_type = 'HMI'` tags (`Trending`, `Queue_Depth`, `Rows_Per_Sec`, `Flush_ms`, `Dropped_Pkgs`, `Error_Count`, and the Module_Info family) have `trends = false` and are not written to the historian.

### L4 × 20 tags re-measurement (pending)

The L4 re-measurement against post-T004 compressed chunks was not yet possible at session end — insufficient data had accumulated under the new 1h chunk configuration. The concrete next step is to run the aggregate perf battery at `bucket_s = 600`, `tag_count = 20` once enough compressed chunks exist. See "Immediate Next Actions" above for the decision tree based on the result.
