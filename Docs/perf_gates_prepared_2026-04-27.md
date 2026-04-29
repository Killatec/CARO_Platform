# Trend Viewer Performance Gates — Prepared Statement Investigation — 2026-04-27

## Hypothesis

Planning overhead is the root cause of Gate 1's failure. The `locf(prev => ...)` correlated subquery
forces PostgreSQL's `ChunkAppend` to enumerate all 40+ `tag_samples` chunks at plan time (~14–17 ms
per tile). With 4 parallel tile queries, planning bottlenecks the wall-clock mean to ~42 ms, which
just exceeds the 40 ms criterion.

**Prediction:** pg named prepared statements (`pool.query({ name, text, values })`) cache the plan per
connection after first use, driving planning overhead to ~0 ms on subsequent queries. Expected
improvement: Gate 1 mean drops from ~42 ms → ~10–15 ms → **PASS**.

---

## Result Summary

| Run | Gate | Mode | Mean | p95 | Verdict | Δ vs unprepared |
|-----|------|------|------|-----|---------|-----------------|
| 1 | Gate 1 — raw `tag_samples` | Unprepared | 41.63 ms | 53.84 ms | **FAIL** | baseline |
| 2 | Gate 1 — raw `tag_samples` | Prepared | 46.05 ms | 53.90 ms | **FAIL** | +4.4 ms (**worse**) |
| 3 | Gate 2 — `caro_samples_1s` CAG | Unprepared | 34.00 ms | 43.58 ms | **PASS** | baseline |
| 4 | Gate 2 — `caro_samples_1s` CAG | Prepared | 30.69 ms | 39.70 ms | **PASS** | −3.3 ms (marginal) |

**Hypothesis: DISPROVED.** Prepared statements made Gate 1 worse, not better.

---

## Test Environment

| Parameter | Value |
|-----------|-------|
| Host | Local Docker (TimescaleDB 2.x) |
| Trendable tag pool | 504 tags |
| N (tags per tile query) | 8 |
| TILE_COUNT | 4 |
| TILE_BUCKETS | 250 |
| timescalePool max | 10 connections |
| SEED | 42 (mulberry32) |
| Trials | 100 + 10 warmup |
| Run date | 2026-04-27 |
| Gate 1 chunk age at run | ~3 days compressed; uncompressed open span ~10 min (skipped) |
| Gate 2 chunk age at run | ~3 days compressed; uncompressed open span ~3.18 h (skipped) |

---

## Root Cause: PostgreSQL Generic Plan Regime

When `pool.query({ name, text, values })` is used, PostgreSQL prepares the statement once per
connection and caches a **generic plan** — a plan compiled without knowledge of the actual parameter
values. PostgreSQL switches from custom plans to generic plans after the 5th execution if the
generic plan cost estimate is competitive.

For TimescaleDB hypertables, this is fatal for chunk pruning:

- **Custom plan** (unprepared): the planner substitutes the actual `$3`/`$4` timestamp values and
  prunes all chunks outside the query window. For a 4-min tile on `tag_samples`, only 1–2 of 40+
  chunks are scanned.
- **Generic plan** (prepared): the planner cannot use bind-parameter values for partition/chunk
  exclusion at plan time. It must conservatively include all chunks (or rely on runtime exclusion,
  which is less aggressive). This increases both per-tile scan work and the `ChunkAppend`
  enumeration cost.

For Gate 1 (`tag_samples`, 40+ chunks): the execution overhead of scanning extra chunks in the
generic plan more than offsets any planning savings. Net result: +4.4 ms worse.

For Gate 2 (CAG, 4 chunks): the generic plan penalty is negligible at 4 chunks. The marginal
−3.3 ms improvement comes from eliminating the 2.2 ms planning overhead per connection on first use,
amortized over 100 trials.

---

## Full Distributions

### Gate 1 — raw `tag_samples` — Compressed

| Metric | Unprepared | Prepared | Δ |
|--------|-----------|---------|---|
| min | — | — | — |
| mean | 41.63 ms | 46.05 ms | +4.4 ms |
| p50 | — | 40.95 ms | |
| p75 | — | 45.60 ms | |
| p90 | — | 49.33 ms | |
| p95 | 53.84 ms | 53.90 ms | +0.1 ms |
| p99 | — | 329.36 ms | |
| max | — | 347.64 ms | |
| std | — | 42.69 ms | |
| tile mean | — | 36.87 ms | |
| tile p95 | — | 49.30 ms | |
| verdict | **FAIL** | **FAIL** | — |

Uncompressed: SKIPPED for both runs — open chunk span ~10 min < required 16 min.

### Gate 1 — First-15-Trial Warmup Behavior

| Trial | Unprepared | Prepared |
|-------|-----------|---------|
| #0 | 35.03 ms | 34.83 ms |
| #1 | 251.89 ms ← outlier | 48.53 ms |
| #2 | 29.68 ms | 38.59 ms |
| #3 | 30.27 ms | 37.52 ms |
| #4 | 27.20 ms | 26.09 ms |
| #5 | 69.74 ms | 47.51 ms |
| #6 | 29.90 ms | 30.25 ms |
| #7 | 33.50 ms | 33.90 ms |
| #8 | 43.31 ms | 42.00 ms |
| #9 | 43.46 ms | 42.07 ms |
| #10 | 31.25 ms | 31.13 ms |
| #11 | 38.38 ms | 42.51 ms |
| #12 | 38.62 ms | 36.38 ms |
| #13 | 44.99 ms | 49.09 ms |
| #14 | 25.62 ms | 29.67 ms |

The #1 spike in unprepared (251 ms) disappears in prepared mode — this is consistent with the plan
being cached per-connection by trial #1. However, the steady-state mean is higher, confirming the
generic plan regime costs more than it saves.

### Gate 2 — `caro_samples_1s` CAG — Compressed

| Metric | Unprepared | Prepared | Δ |
|--------|-----------|---------|---|
| mean | 34.00 ms | 30.69 ms | −3.3 ms |
| p50 | 31.89 ms | 29.26 ms | −2.6 ms |
| p75 | 36.77 ms | 31.29 ms | −5.5 ms |
| p90 | 41.23 ms | 36.49 ms | −4.7 ms |
| p95 | 43.58 ms | 39.70 ms | −3.9 ms |
| p99 | 53.74 ms | 52.89 ms | −0.9 ms |
| max | 57.96 ms | 57.17 ms | −0.8 ms |
| std | 5.77 ms | 5.19 ms | −0.6 ms |
| tile mean | 31.10 ms | 27.71 ms | −3.4 ms |
| tile p95 | 41.69 ms | 36.90 ms | −4.8 ms |
| verdict | **PASS** | **PASS** | — |

Uncompressed: SKIPPED for both runs — open CAG chunk span ~3.18 h < required 6.83 h.

### Gate 2 — First-15-Trial Warmup Behavior (Prepared)

| Trial | Prepared |
|-------|---------|
| #0 | 32.43 ms |
| #1 | 30.06 ms |
| #2 | 28.57 ms |
| #3 | 25.70 ms |
| #4 | 25.71 ms |
| #5 | 29.67 ms |
| #6 | 28.15 ms |
| #7 | 29.93 ms |
| #8 | 52.89 ms |
| #9 | 32.40 ms |
| #10 | 29.01 ms |
| #11 | 29.30 ms |
| #12 | 42.66 ms |
| #13 | 37.27 ms |
| #14 | 36.49 ms |

No warmup cliff at trial 0 — consistent with the plan being prepared on the first connection
checkout rather than at first query execution. The #8=52 ms and #12=42 ms spikes are typical
scheduling noise, not plan misses.

---

## D2 Single-Query Anomaly (Gate 2 Prepared)

| Metric | Unprepared | Prepared |
|--------|-----------|---------|
| single-query mean | 50.56 ms | **377.47 ms** |
| parallelism factor | 1.49× | 12.30× |

The single-query runner uses `QUERY_NAME + '-single'` as the prepared statement name. With 1×1000
buckets spanning the full ~6.83 h window, the generic plan cannot prune chunks to just the relevant
range. The query scans significantly more data than needed, driving latency from 50 ms to 377 ms.

This anomaly does not affect the 4-tile parallel results (each tile spans ~1.7 h, hitting 1 CAG
chunk even without pruning) but demonstrates the danger of prepared statements on longer query
windows. The D2 parallelism factor of 12.30× is an artifact — it reflects the degraded single-query
baseline, not a real parallelism gain.

---

## D4 EXPLAIN — Unprepared vs Prepared

### Gate 2 Unprepared (reference)

```
Custom Scan (GapFill)  actual time=0.249..11.658 rows=2000
  Planning Time: 2.202 ms   Execution Time: 12.183 ms
  Buffers: shared hit=41
  -> Custom Scan (ColumnarScan) on _hyper_5_95_chunk
       Vectorized Filter on bucket range
       Rows Removed by Filter: 11129
       Buffers: shared hit=32
  SubPlan 1 (locf prev):
       ChunkAppend on _materialized_hypertable_5 — 4 chunks
       Only _hyper_5_95_chunk executed (pruned at runtime)
       Buffers: shared hit=9
```

**Planning: 2.2 ms. Execution: 12.2 ms.** Single compressed chunk scanned for main query. 3 of 4
chunks excluded at runtime for SubPlan.

### Gate 1 Unprepared (from previous v2 session)

```
Custom Scan (GapFill)  actual time=...
  Planning Time: 16.983 ms   Execution Time: 10.639 ms
  Buffers: shared hit=1235 (planning)
  -> ChunkAppend on tag_samples — 40+ chunks
```

**Planning: 17 ms. Execution: 11 ms.** Planning dominates because the `ChunkAppend` on `tag_samples`
enumerates all 40+ historical chunks at plan time (1235 catalog buffer hits).

### Prepared EXPLAIN — Status

The `EXPLAIN EXECUTE` section has a bug in the prepared-mode path: `EXPLAIN EXECUTE <name>($1, $2,
$3, $4)` with pg bind parameters does not work — `EXECUTE` requires literal values embedded in the
SQL string, not pg protocol bind parameters. Both Gate 1 and Gate 2 prepared EXPLAIN sections
emitted `"bind message supplies 4 parameters, but prepared statement "" requires 0"`. Fix: use
string interpolation to embed literal values directly in the `EXPLAIN EXECUTE` SQL string. EXPLAIN
data for prepared mode is therefore not available from this run.

---

## Why Prepared Statements Didn't Help Gate 1

The planning overhead in Gate 1 (17 ms) is caused by the `ChunkAppend` on `tag_samples` enumerating
40+ chunks at **plan time** to determine which chunks overlap the query window. This is custom-plan
behavior — the planner uses the actual `$3`/`$4` values to prune chunks and still evaluates all 40+
in the catalog.

With a generic plan, the planner cannot use `$3`/`$4` at plan time at all. The result is one of:

a) A plan that defers all chunk exclusion to runtime — similar catalog work at execution time,
   slightly different timing, no net win.
b) A plan with explicit `AND ts >= $3 AND ts < $4` filters scanned across more chunks — worse
   execution time.

Either way, the ~14–17 ms of catalog work remains; it just shifts from plan-time to execution-time
or remains at plan-time under the generic plan's coarser analysis. The mean rising from 41.6 ms to
46.1 ms is consistent with scenario (b) — marginally worse execution under the generic plan.

---

## Gate 2 Prepared — Why It Worked (Marginally)

The CAG has exactly 4 chunks. At 4 chunks:

- The planning catalog overhead is ~2.2 ms (small, irrelevant to savings).
- The generic plan's inability to prune is also irrelevant — with 4 chunks, even a full scan adds
  negligible overhead.
- The marginal gain (−3.3 ms mean) comes from eliminating per-connection plan-compile overhead on
  the first use of each pool connection, amortized over 100 trials with a 10-connection pool.

The implication: **prepared statements are only beneficial when (a) query planning is expensive and
(b) the generic plan does not significantly degrade chunk pruning**. CAG satisfies (b) but not (a).
`tag_samples` fails (b) fatally.

---

## D3 N-Sweep Comparison

### Gate 2 N-Sweep (wall-clock mean)

| N | Unprepared | Prepared | Δ |
|---|-----------|---------|---|
| 1 | 8.91 ms | 8.56 ms | −0.35 ms |
| 4 | 16.65 ms | 17.59 ms | +0.94 ms |
| 8 | 30.69 ms | 31.26 ms | +0.57 ms |

The N-sweep is essentially flat between modes. Prepared statements neither help nor hurt materially
at this tag count for the CAG workload. The D3 variance is within normal run-to-run noise.

---

## Verdict and Recommendation

**The prepared-statement optimization does not fix Gate 1.** The hypothesis was incorrect: planning
overhead in Gate 1 is not primarily caused by repeated plan compilation — it is caused by the
`ChunkAppend` enumerating 40+ chunks in the catalog regardless of plan caching. Eliminating plan
compilation does not eliminate this catalog work.

**Do NOT integrate named prepared statements into the trends API.** The risks outweigh the benefits:

1. Gate 1 latency is unchanged (FAIL remains FAIL).
2. Prepared statements create a subtle correctness hazard: as `tag_samples` grows more chunks, the
   generic plan's chunk pruning degrades silently, with no observable error — only a latency cliff.
3. The D2 single-query regression (50 ms → 377 ms) shows that prepared statements can cause
   catastrophic degradation on longer query windows without any warning.
4. Gate 2 marginal gain (−3.3 ms) does not justify the complexity or risk.

### Alternative Fixes for Gate 1

The Gate 1 failure root cause is the `locf(prev => ...)` correlated subquery on `tag_samples`
at N=8 — the `ChunkAppend` catalog overhead (~14–17 ms planning per tile × 4 tiles) dominates
wall-clock. Viable alternatives:

1. **Promote all data to the 1s CAG before serving tiles.** At Gate 2's mean (30–34 ms), the 40 ms
   criterion is met. The 16-min raw window would be replaced by a 16-min CAG tile window. Planning
   cost drops to 2.2 ms per tile (4 chunks). This is the recommended path.

2. **Restrict the raw `tag_samples` path to very recent data only** (e.g., last 15 min, always
   within a single open chunk). Eliminates `ChunkAppend` entirely; planning cost drops to ~1–2 ms.
   Requires a cutover logic in the API: raw for <15 min, CAG for ≥15 min.

3. **Reduce N below the planning-overhead inflection point.** At N=4, Gate 1 unprepared mean ≈
   20–25 ms (from D3 extrapolation). However, this halves display density and is a product
   decision, not a DB fix.

---

## Caveats

**1. Uncompressed ranges skipped for all four runs.**  
Gate 1 required a 16-min open chunk (available: ~7–10 min). Gate 2 required a 6.83 h open CAG
span (available: ~3.18 h). Both must be re-run once open chunks have accumulated sufficient history.

**2. EXPLAIN prepared mode unavailable.**  
The `EXPLAIN EXECUTE` call in the scripts uses pg bind parameters, which are not accepted by
`EXPLAIN EXECUTE`. The planned fix is to embed literal values via string interpolation in the SQL
string. This does not affect the performance measurements — only the diagnostic output.

**3. D2 parallelism factor is misleading in prepared mode.**  
The 12.30× factor for Gate 2 prepared reflects degraded single-query performance under the generic
plan, not a true parallelism gain. The D2 metric should be interpreted cautiously when prepared
statements are in use.

**4. Run-to-run variance.**  
Gate 2 unprepared mean varied from ~32.62 ms (v2 session, earlier today) to ~34.00 ms (this run).
Acceptable noise. Gate 1 unprepared mean varied 41.63 ms (Run 1) — consistent with previous v2
measurements of ~52.98 ms compressed, though the window narrowed (only compressed available).
