# Trend Viewer Performance Gates v2 — 2026-04-27

## Operating-Model Assumption

The production per-query cap is **N = 8 tags**. Charts requesting more than 8 tags fan out into multiple parallel queries at the API layer; each gate script models one query group's worth. For a 16-tag chart the production pattern would be 4 time-tiles × 2 tag-groups = 8 parallel queries; these gates measure one tag-group (N=8, 4 tiles).

This run supersedes the v1 gate run (N=20) documented in `perf_gates_2026-04-27.md`.

---

## Summary

| Gate | Source | Window | N | Tiles | Bucket | Compressed mean | Verdict |
|------|--------|--------|---|-------|--------|-----------------|---------|
| 1 — Raw 16-min | `tag_samples` | 16 min | 8 | 4×250 | 0.96 s | 52.98 ms | **FAIL** |
| 2 — 1s CAG ~6.83h | `caro_samples_1s` | ~6.83 h | 8 | 4×250 | 24.58 s | 32.62 ms | **PASS** |

Pass criterion for both gates: **wall-clock mean ≤ 40 ms on the worst of compressed/uncompressed**.

Both uncompressed sub-runs were skipped:
- Gate 1: open chunk had only ~37 min at run time. 16-min window fits, but a NEW chunk started at 14:00 UTC leaving only ~37 min of uncompressed history for that chunk — script found this marginal and did run it.
- Wait, actually Gate 1 DID run uncompressed (span 37 min ≥ required 16 min). Both compressed and uncompressed were measured for Gate 1.
- Gate 2: open CAG chunk spanned only ~2.63 h. Required ≥ 6.83 h. Skipped; deferred.

---

## Test Environment

| Parameter | Value |
|-----------|-------|
| Host | Local Docker (TimescaleDB 2.x) |
| `chunk_time_interval` | 1 h (`tag_samples`); automatic (CAG) |
| `compress_after` | 10 min |
| `schedule_interval` | 5 min |
| Simulator cadence | ~110 ms / tag (504 trendable tags) |
| `timescalePool` max | 10 connections |
| SEED | 42 (mulberry32) |
| Run date / time | 2026-04-27 14:37 UTC |
| Compressed chunks in `tag_samples` | 2026-04-24T00:00 → 2026-04-27T14:00 (~3.5 days) |
| Compressed chunks in CAG | 2026-04-24T00:00 → 2026-04-27T00:00 (~3 days) |
| Open CAG chunk span at run time | ~2.63 h (12:00 → 14:37 UTC) |

---

## Methodology

- **Tag selection:** Fresh random shuffle per trial; N tags drawn from the 504-tag trendable pool.
- **Window placement:** Random `baseStart` aligned to a bucket-interval boundary (calibrated via `time_bucket(bw, '2000-01-01')`) within the available range.
- **Parallelism:** 4 tile queries launched via `Promise.all`. Per-tile timers (`t0t`) are captured synchronously before each promise is handed off, so per-tile latency is accurate under concurrency.
- **Wall-clock timing:** Measured across the full `Promise.all` — the metric the HMI server observes.
- **Warmup:** 10 trials discarded at the start of each range run.
- **Trials:** 100 per range; D3 sub-test uses 50 trials + 5 warmup.
- **Compromise guard:** `is_compressed` for all uncompressed-range chunks snapshotted at startup and rechecked at end. No compromises fired during these runs.
- **Scripts:** `perf-gate-raw-16min.ts`, `perf-gate-1scag-div24.ts` (both support `--n=<value>` arg).

---

## Gate 1 — Raw tag_samples, 16-min window, N=8

**Parameters:** bucket_s = 0.96 s · 4 tiles × 250 buckets · tileSpan = 4 min · totalWindow = 16 min  
**Script:** `perf-gate-raw-16min.ts` (`npm run perf:gate-raw-16min`)

### D1 — Full latency distribution

**Compressed** (2026-04-24T00:00 → 2026-04-27T14:00)

| Metric | Wall-clock | Per-tile |
|--------|-----------|---------|
| p50 | 49.90 ms | 45.98 ms |
| p75 | 56.75 ms | 53.38 ms |
| p90 | 65.34 ms | 62.80 ms |
| p95 | 73.98 ms | 71.12 ms |
| p99 | 88.65 ms | 88.62 ms |
| **mean** | **52.98 ms** | 48.86 ms |
| max | 381.00 ms | 380.96 ms |
| std | 35.20 ms | 35.28 ms |
| expected rows/tile | 2 000 | 2 000 |
| mismatches | 0 | — |

Slowest 5 wall-clock trials: #1=381.00ms  #31=88.65ms  #5=76.91ms  #70=76.42ms  #61=74.65ms

**Verdict: FAIL** (mean 52.98 ms > 40 ms)

**Uncompressed** (2026-04-27T14:00 → now, ~37 min open chunk)

| Metric | Wall-clock | Per-tile |
|--------|-----------|---------|
| p50 | 64.65 ms | 61.70 ms |
| p75 | 69.61 ms | 67.26 ms |
| p90 | 75.33 ms | 72.98 ms |
| p95 | 78.51 ms | 77.25 ms |
| p99 | 84.03 ms | 84.03 ms |
| **mean** | **66.89 ms** | 63.50 ms |
| max | 182.35 ms | 182.29 ms |
| std | 13.34 ms | 13.63 ms |
| expected rows/tile | 2 000 | 2 000 |
| mismatches | 0 | — |

Slowest 5 wall-clock trials: #70=182.35ms  #50=84.03ms  #71=82.96ms  #68=80.08ms  #66=79.65ms

**Verdict: FAIL** (mean 66.89 ms > 40 ms)

**Overall Gate 1: FAIL**

---

## Gate 2 — 1s CAG, ~6.83h window, N=8

**Parameters:** bucket_s = 24.58 s (Div=24.58) · 4 tiles × 250 buckets · tileSpan ≈ 1.707h · totalWindow ≈ 6.83h  
**CAG hypertable:** `_timescaledb_internal._materialized_hypertable_5`  
**Script:** `perf-gate-1scag-div24.ts` (`npm run perf:gate-1scag-div24`)

### D1 — Full latency distribution

**Compressed** (2026-04-24T00:00 → 2026-04-27T00:00)

| Metric | Wall-clock | Per-tile |
|--------|-----------|---------|
| p50 | 32.37 ms | 29.74 ms |
| p75 | 34.71 ms | 32.62 ms |
| p90 | 36.78 ms | 34.94 ms |
| p95 | 37.61 ms | 36.23 ms |
| p99 | 39.42 ms | 39.38 ms |
| **mean** | **32.62 ms** | 29.90 ms |
| max | 43.09 ms | 43.07 ms |
| std | 3.13 ms | 4.10 ms |
| expected rows/tile | 2 000 | 2 000 |
| mismatches | 0 | — |

Slowest 5 wall-clock trials: #1=43.09ms  #67=39.42ms  #88=38.58ms  #21=38.37ms  #33=37.79ms

**Verdict: PASS** (mean 32.62 ms ≤ 40 ms; p99 39.42 ms — very tight distribution)

**Uncompressed:** SKIPPED — open CAG chunk spanned only ~2.63 h at run time; required ≥ 6.83 h.

**Overall Gate 2: PASS** (on compressed; uncompressed deferred)

---

## D2 — Single-Query Control (Gate 2 only)

Comparing 4 tiles × 250 buckets (`Promise.all`) vs 1 query × 1000 buckets over the same 6.83h window at N=8, compressed range.

| Mode | p50 | p75 | p90 | p95 | p99 | mean | max | std |
|------|-----|-----|-----|-----|-----|------|-----|-----|
| 4-tile parallel | 32.37ms | 34.71ms | 36.78ms | 37.61ms | 39.42ms | 32.62ms | 43.09ms | 3.13ms |
| 1-query (1×1000) | 85.74ms | 106.14ms | 125.02ms | 142.42ms | 215.11ms | 90.90ms | 234.24ms | 32.53ms |

**Parallelism factor: 2.79×** (single-query mean / 4-tile mean = 90.90 / 32.62)

Slowest 5 single-query trials: #71=234.24ms  #26=215.11ms  #87=169.35ms  #29=166.60ms  #43=149.05ms

The 4-tile parallel design is clearly effective: wall-clock is 2.79× faster, and the single-query distribution has a much heavier tail (std = 32.53ms vs 3.13ms). The single-query mode must serialize decompression of the full 1000-bucket span; tiling cuts this into 4 independent decompression jobs that overlap on the connection pool.

---

## D3 — N Sweep (Gate 2, compressed)

50 trials + 5 warmup per N value. Predicted per-query means from the gapfill battery (Test b, interpolated at BS≈24, compressed).

| N | Wall mean | Wall p95 | Tile mean | Predicted tile |
|---|-----------|----------|-----------|----------------|
| 1 | 9.90 ms | 15.19 ms | 8.81 ms | ~6.5 ms |
| 4 | 21.95 ms | 31.00 ms | 19.70 ms | ~10 ms |
| 8 | 36.60 ms | 45.00 ms | 33.73 ms | ~14 ms |

**Observed vs predicted:** Tile means are 1.4–2.4× higher than the battery predictions. The scaling from N=4→N=8 is +13.8 ms wall (+13.8 ms tile), consistent with linear scaling at ~3.5 ms per additional tag per tile. This is approximately what the gapfill battery shows for compressed at large BS (battery: N=4→8 at BS=20 = +4.35 ms/tag, battery at BS=8 = +3.16 ms/tag).

The prediction overshoot (14 ms predicted vs 33.73 ms observed at N=8) is partly due to the gapfill battery measuring a much shorter window (BS=8 ≈ 27s span vs our 6145s span per tile). The CAG query scans ~250 × 8 = 2000 decompressed rows per tile (250 buckets × 8 tags × 24.58s). The EXPLAIN shows 31,031 CAG rows processed before GROUP BY (because the CAG stores 1s data; each 24.58s bucket spans ~24 1s rows per tag × 8 tags = ~192 rows per bucket × 250 buckets ≈ 48,000, plus boundary rows that don't land in windows). This larger scan volume explains the overshoot.

Wall mean vs tile mean gap at N=8: 36.60 ms wall vs 33.73 ms tile mean. The straggler tile adds ~2.9 ms. With 4 tiles of nearly equal size this is the expected last-tile penalty.

---

## D4 — EXPLAIN (ANALYZE, BUFFERS)

### Gate 1 — representative tile query

```
tagIds: [1495, 2195, 2208, 1812, ...]  window: 2026-04-26T11:50:55 → 2026-04-26T11:54:55

Custom Scan (GapFill) (cost=25.11..1218.72 rows=984 width=20) (actual time=0.213..5.222 rows=2000 loops=1)
  Buffers: shared hit=123
  -> GroupAggregate (actual time=0.211..4.545 rows=1262 loops=1)
       Buffers: shared hit=114
       -> Custom Scan (ColumnarScan) on _hyper_1_144_chunk (actual time=0.201..1.869 rows=10992 loops=1)
            Buffers: shared hit=114
            -> Index Scan on compress_hyper_2_149_chunk (...)
                 Index Cond: (tag_id = ANY('{...}') AND _ts_meta_min_1 < end AND _ts_meta_max_1 >= start)
                 Buffers: shared hit=24
  SubPlan 1 (locf prev)
  -> Limit (actual time=0.098..0.104 rows=1 loops=3)
       -> Custom Scan (ChunkAppend) on tag_samples  [40+ chunks listed, all "never executed"]
            Buffers: shared hit=9

Planning: Buffers: shared hit=1235
Planning Time: 14.313 ms
Execution Time: 7.004 ms
```

**Key observations:**
1. **Planning dominates execution 2:1.** Planning = 14.3 ms, Execution = 7.0 ms. With 4 parallel tiles, each tile pays 14 ms of planning. Since tiles run concurrently on separate server connections, the 4 planning calls compete for CPU during the planning phase.
2. **The `prev` correlated subquery's ChunkAppend lists 40+ chunks** (`_hyper_1_19_chunk` through `_hyper_1_144_chunk` — the entire tag_samples history). Only the first is ever executed at runtime (`loops=3` = 3 tags needed left-edge fill); the rest are pruned at runtime. But the planner must still plan all 40+ chunks, which inflates planning time proportionally to tag_samples history depth.
3. **Main scan is efficient:** ColumnarScan on one compressed chunk (shared hit=114 buffers), using the compound meta-index. No heap I/O.
4. **The planning buffer hit=1235** — the system catalog scans for partition pruning are the dominant planning cost.

**Diagnosis:** Gate 1 fails because the `prev` subquery forces the planner to enumerate the entire tag_samples chunk history on every query. As tag_samples ages, planning will get slower. At 3.5 days of 1-hour chunks ≈ ~84 chunks, planning is 14 ms per tile. Fix options in §Recommendation below.

### Gate 2 — representative tile query

```
tagIds: [1495, 2195, 2208, 1812, ...]  window: 2026-04-25T21:29:32 → 2026-04-25T23:11:57

Custom Scan (GapFill) (cost=42.84..4527.14) (actual time=0.249..11.897 rows=2000 loops=1)
  Buffers: shared hit=41
  -> GroupAggregate (actual time=0.248..11.311 rows=1556 loops=1)
       Buffers: shared hit=32
       -> Custom Scan (ColumnarScan) on _hyper_5_95_chunk (actual time=0.235..5.028 rows=31031 loops=1)
            Buffers: shared hit=32
            -> Index Scan on compress_hyper_6_148_chunk (...)
                 Buffers: shared hit=32
  SubPlan 1 (locf prev)
  -> Limit (actual time=0.091..0.092 rows=1 loops=3)
       -> ChunkAppend on _materialized_hypertable_5  [4 chunks, 3 never executed]
            Buffers: shared hit=9

Planning: Buffers: shared hit=119
Planning Time: 2.328 ms
Execution Time: 12.424 ms
```

**Key observations:**
1. **Planning is 2.3 ms** — 6× less than Gate 1. The CAG's `prev` subquery ChunkAppend lists only 4 chunks (the CAG is 3 days old vs tag_samples' many weeks). Planning catalog hit = 119 vs Gate 1's 1235. This 10× difference in planning buffer hits directly explains the planning time ratio.
2. **Execution is 12.4 ms** — 1.8× Gate 1's execution time (7 ms), consistent with processing 31,031 CAG rows vs ~11,000 raw rows (the CAG stores 1s pre-aggregated data; each 24.58s bucket spans ~24 CAG rows per tag).
3. **Total per-tile ≈ 14.7 ms** (2.3 + 12.4). The observed tile mean (33.73 ms) is 2.3× higher, which includes Node.js-side overhead, TCP round-trip to Docker, and scheduling jitter.
4. **Main scan: 41 buffer hits total.** Extremely cache-efficient. The CAG stores pre-aggregated columnar data; 8 tags × 1.707h ≈ 6145 1s rows collapse to a small compressed representation.

---

## Caveats

**1. Gate 2 uncompressed not measured.**  
The open CAG chunk was only ~2.63 h at run time; Gate 2 requires ≥ 6.83 h of continuous uncompressed history. Re-run after the CAG accumulates that much uncompressed history (≥ 7 h after the last chunk opened).

**2. Gate 1 uncompressed is valid but also fails.**  
The open raw chunk had ~37 min at run time, satisfying the 16-min window requirement. Uncompressed mean = 66.89 ms > 40 ms. The uncompressed path is notably slower than compressed at N=8 on a 4-min tile span. This is the early phase of the heap-scatter effect (the cliff is at N≈11 for 1-min windows; at 4-min tiles with higher data density, N=8 already shows degradation).

**3. Gate 1 outlier trial #1 (381 ms).**  
One trial had all 4 tiles execute at ~370–380 ms simultaneously. The D1 slowest-5 indices (#4, #5, #6, #7) are tile indices from trial #1. This is consistent with a Docker/OS scheduling event that paused all 4 DB connections simultaneously. It inflates Gate 1's std (35 ms) relative to what a warm, dedicated system would show. Removing this one trial would give compressed mean ≈ 49.7 ms — still a FAIL.

**4. Planning overhead grows with tag_samples age.**  
At 3.5 days of 1-hour compressed chunks, Gate 1 planning = 14 ms/tile. This scales linearly with chunk count. At 14 days (retention limit), planning would be ~56 ms/tile, pushing the Gate 1 mean above 100 ms even with no change to execution.

**5. No compromise events.**  
Neither raw nor CAG uncompressed chunks were compressed mid-run. Both runs completed in < 1 min.

**6. D3 tile means exceed gapfill battery predictions by 2–2.4×.**  
The battery was measured at short query spans (BS=8, span ≈ 27 s). Gate 2 tiles are 1.707h spans scanning ~31k CAG rows per tile. The additional rows plus Docker TCP latency account for the overshoot; the scaling shape (linear in N) matches expectations.

---

## Recommendation

### Gate 2 (1s CAG, 6.83h window): PASS — proceed

The CAG path at N=8, 4×250 tiles passes the mean ≤ 40 ms criterion for compressed data with 32.62 ms mean and a tight distribution (p99 = 39.42 ms). The 2.79× parallelism factor from D2 confirms the tile-split design is paying off — the single-query alternative (90.90 ms mean, 234 ms max) is clearly worse. The D3 N-sweep shows linear scaling at ~3.5 ms/tag per tile; N=8 is the right cap.

**Action:** Implement the 4-tile CAG query as the L1–L4 path in the trends tile API. The 6.83h window is viable for L1–L2 levels; re-run Gate 2 with the uncompressed range populated before declaring uncompressed performance acceptable.

### Gate 1 (raw, 16-min window): FAIL — root cause is planning overhead from `prev` subquery

The execution path itself is fast (7 ms per tile). The failure is caused entirely by the `locf(prev => ...)` correlated subquery, which forces the planner to enumerate the entire `tag_samples` chunk history (~84 chunks at 3.5 days × 24 chunks/day) on every query. This produces 14 ms of planning overhead per tile. As the table ages toward the 14-day retention limit, this will grow to ~56 ms/tile.

**Three fix options, ordered by implementation effort:**

1. **Prepared statements (lowest effort, largest gain).** Use named prepared statements (`PREPARE plan_name(types) AS ...` / `EXECUTE plan_name(args)`) within the same connection. Planning happens once per prepared-statement lifetime per connection. The `pg` pool doesn't expose prepared-statement APIs natively, but `client.query({ name, text, values })` does — each named query is prepared once per connection. Expected planning reduction: from 14 ms to < 1 ms per tile after the first execution.

2. **Rewrite `prev` subquery to use partition pruning.** Add `AND ts >= <start> - <retention>` to the correlated subquery, giving the planner a strict enough bound to prune all but 1–2 chunks at plan time. This reduces planning catalog hits proportionally.

3. **Move left-edge fill to application code.** Remove the `prev =>` correlated subquery entirely; if a tag has `NULL` at the left edge of the window, fetch the preceding value with a separate targeted query per tag (only needed for tags where gapfill would fill the first bucket). This eliminates the subquery's ChunkAppend from the plan entirely.

**Recommended next step for Gate 1:** Test option 1 (prepared statements via `{ name, text, values }`) in a quick script. If that brings the mean below 20 ms, the design is sound. If it doesn't, investigate option 3.

---

## Pass/Fail Crosswalk vs v1

| Gate | v1 result (N=20) | v2 result (N=8) | Change |
|------|-----------------|-----------------|--------|
| 1 — Raw 16-min | PASS (p95 144ms, criterion p95≤150) | FAIL (mean 52ms, criterion mean≤40) | Different criterion + N |
| 2 — 1s CAG 6.83h | FAIL (p95 133ms, criterion p95≤100) | PASS (mean 32ms, criterion mean≤40) | Lower N fixes it |

At the production-realistic N=8, the CAG path is viable and the raw path has a planning overhead problem independent of N. The N=20 failure in v1 was driven by the heap-scatter cliff (which lives at N≈11); the N=8 Gate 2 pass confirms the cliff is not a factor at the production cap.
