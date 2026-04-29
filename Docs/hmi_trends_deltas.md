# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

---

- `perf-gate-raw-16min.ts` and `perf-gate-1scag-div24.ts`: added `--prev-bound` flag (default `5 minutes`); production raw tile SQL shape now uses bounded `prev` subquery — reduces ChunkAppend from 61 → 1 chunk, planning from 14.8 ms → 1.85 ms per tile; Gate 1 moves from FAIL to PASS.
- `package.json` (packages/db): added `perf:gate-raw-16min-unbounded` script to preserve original unbounded behavior for regression testing.
- 2026-04-28: CAGs feed from raw `tag_samples` (flat topology), not hierarchically — preserves independent watermarks for §4.3 fall-through and isolates refresh failures per CAG. See spec §18 Resolved.
- 10min CAG `start_offset` = 1 hour (asymmetric vs 15 min on 1s/10s/1min); required by TimescaleDB's 2×bucket_width refresh-window rule. T009 fixed in place after the failed run.
- 2026-04-28 v0.5: API contract changes from (tag_ids, bucket_s, tile_index) to (tag_ids, start_time, end_time, bucket_count); spec §4.1, §4.2, §6.1, §6.2, §6.3, §10 rewritten.
- 2026-04-28 v0.5: bucketCount is 1..2500 server-accepted knob; trend viewer locks to 250 by policy.
- 2026-04-28 v0.5: INVALID_TILE_INDEX removed; INVALID_RANGE and INVALID_BUCKET_COUNT added to error set.
- 2026-04-28 v0.5: Response shape discriminated on `source` (not `bucketS`); aggregate carries startTime, endTime, n=bucketCount, bucketS for diagnostics; `source: 'mixed'` for watermark fall-through.
- 2026-04-28 v0.5: Cache key changes to (tagId, startTime, endTime, bucketCount) per §10.1.
- 2026-04-29 v0.6: Server returns natural-bucket grid honestly. `n` may be `bucket_count` (aligned request) or `bucket_count + 1` (unaligned). Response `startTime`/`endTime` reflect the served grid. Strict row-count assertion removed from `queryAggregate`; defensive check retained for pathological cases outside `{bucketCount, bucketCount+1}`. Trend viewer client unchanged (aligns by policy).
- 2026-04-28 Phase A Step 2 complete: `getTrendTile` rewritten in `packages/db/timescale/trends.ts` (4-arg v0.5 signature, discriminated union response, gapfill+locf with bounded prev, no-named-prepared-statement note); route updated to `start_time`/`end_time`/`bucket_count` params with `serializeTile()` for bigint→number; test helper updated with bigint types + `refreshTestCagg`; 31 integration/validation tests in `__tests__/timescale/trends.test.ts`; 209/209 HMI server tests passing; `apps/caro-hmi/CLAUDE.md` still references v0.3 params (bucket_s, tile_index, 20-tag cap) — needs propagation.
- 2026-04-29 v0.7: Phase A Step 4 complete — watermark-aware fall-through in `getTrendTile`. Recursive descent 10min_cagg → 1min_cagg → 10s_cagg → 1s_cagg → raw. Split at `floor(watermarkMs/bucketSMs)*bucketSMs` (bucket-boundary aligned, not raw watermark_ts). Watermark read via `_timescaledb_internal.cagg_watermark(mat_hypertable_id)` joining `_timescaledb_catalog.continuous_agg`. `__test_watermarkOverride` seam added. 7 new watermark fall-through tests; full suite 87/87. spec §4.3 updated with split-point formula and actual catalog query. cags.test.ts fixed (15 tests): policy joins corrected for TimescaleDB 2.26.3 (view name in `hypertable_name`, not internal hypertable name); compression layout query migrated from `pg_class.reloptions` to `timescaledb_information.hypertable_columnstore_settings`.
