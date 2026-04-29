# CARO Historian — Database Configuration, Usage & Performance Summary

**Date:** 2026-04-27
**Status:** Design validated by measurement gates. Ready for implementation.
**Target path:** `Docs/Historian_DB_Summary.md`

This document is the single source of truth for all decisions regarding the historian database (TimescaleDB on `caro_timescale`) — chunk and compression policy, continuous aggregates (CAGs), tile structure, query shape, dispatch logic, and the empirical performance results that justify each choice.

For the design narrative and the full window-to-CAG mapping table, see `Trend_CAGs_Structure.md`. This document is the operational summary.

---

## 1. Architecture at a Glance

- **Raw hypertable:** `tag_samples` on `caro_timescale` (port 5433)
- **Four CAGs:** 1-second, 10-second, 1-minute, 10-minute, all materialized off `tag_samples`
- **Tile structure:** fixed 250 buckets per tile, 4 tiles per window in parallel
- **Per-query tag cap:** N ≤ 8 tags. Larger charts fan out into multiple parallel queries.
- **Dispatch:** by output bucket size (`bucket_s`), routed to the CAG where re-aggregation ratio (Div) stays ≤ 16
- **Query shape:** `time_bucket_gapfill()` + `locf()` with **bounded `prev` correlated subquery** (5-minute lookback) — bound is mandatory, not optional
- **Writer dependency:** every trendable tag has a sample written at least every 60 seconds; the 5-min `prev` bound provides 5× safety margin
- **Connection pool:** max 10 (recommended size 20-30 for production trend-viewer concurrency)

---

## 2. Raw Hypertable Configuration

### 2.1 Settings (T001 + T004)

| Setting | Value | Origin |
|---|---|---|
| Hypertable | `tag_samples` | T001 |
| Value column type | `DOUBLE PRECISION` | T001 |
| Chunk interval | 1 hour | T004 |
| `compress_after` | 10 minutes | T004 |
| `schedule_interval` | 5 minutes | T004 |
| `compress_segmentby` | `tag_id` | T001 |
| `compress_orderby` | `ts DESC` | T001 |
| Retention | 14 days | T001 |

### 2.2 Observed compression and storage

- Per closed 1h chunk: ~1278 MB raw → ~82 MB compressed (≈ 15.6× ratio)
- Storage rate: ~82 MB/hour ≈ 2 GB/day ≈ 28 GB over 14-day retention
- At steady state: ~336 chunks (24 chunks/day × 14 days)

### 2.3 Why these values

The 1-hour chunk interval and 10-minute `compress_after` were chosen so that any chunk older than ~70 minutes is fully compressed and read-optimized. Combined with the bounded `prev` subquery (§5.2), the chunk count grows linearly with retention but planning cost stays flat at ~1.85 ms per query because chunk pruning is index-driven, not catalog-enumeration-driven.

---

## 3. Continuous Aggregates (CAGs)

### 3.1 The four CAGs

| CAG | Native Bucket | Window Range Served | Chunk Interval | `compress_after` | Retention |
|---|---|---|---|---|---|
| 1s CAG | 1 second | 16 min – 4 h | 24 h | 1 h | 14 days |
| 10s CAG | 10 seconds | 4 h – 32 h | 24 h | 1 h | 90 days |
| 1min CAG | 60 seconds | 32 h – 10 d | 24 h | 1 h | 1 year |
| 10min CAG | 600 seconds | 10 d – ∞ | 24 h | 1 h | indefinite |

### 3.2 Materialized aggregates

Each CAG materializes:

- `last(value ORDER BY ts)` — primary display value
- `null_count` — quality/gap signal
- `min(value)` — excursion detection
- `max(value)` — excursion detection

**`min` and `max` are not optional.** At 1-min native bucket × 10 Hz source rate, `last`-only collapses 600 samples into one and would hide transient excursions entirely. SCADA workflows depend on visible spikes. Storage cost of `min`/`max` is trivial.

### 3.3 CAG configuration rationale

CAGs are hypertables and inherit none of the raw `tag_samples` policy. Settings above reflect that CAG data has no late writes (so aggressive compression is safe), and that larger chunks (24h vs raw's 1h) reduce per-query chunk-open overhead. Retention scales with how far back operators realistically zoom on each CAG's window range.

### 3.4 `materialized_only`

All CAGs use `materialized_only = true`. Combined with watermark-aware dispatch (§4.3), this gives clean separation between "served from CAG" and "served from raw fall-through" rather than letting TimescaleDB make that decision implicitly.

### 3.5 Refresh policy

Each `cagg_refresh_policy` runs every 1 minute with the CAG's natural lookback. The 10min CAG's refresh lag is naturally larger (≥10 min of new raw data needed to fill a bucket), which the watermark-aware dispatch handles.

### 3.6 Why four CAGs, not fewer or more

The cheap-zone boundary (Div ≤ 16, measured) maps to roughly a decade-and-a-half of window coverage per CAG. That's the spacing this scheme uses. A two-CAG scheme (1s + 10min) would push Div past 100 in the gap region. A finer-grained scheme (e.g., adding a 1h CAG for > 85d windows) is deferred — measurement at 85d windows can be revisited if operators need sub-50ms responsiveness on 6-month views.

---

## 4. Dispatch Logic

### 4.1 Routing rule (canonical)

Dispatch is on `bucket_s = window_seconds / total_buckets`, where `total_buckets = N_tiles × 250` (so 500 at minimum, 1000 at maximum).

```
if bucket_s < 1.0:
    use raw
elif bucket_s < 16.0:
    use 1s CAG, outer time_bucket(bucket_s)
elif bucket_s < 160.0:
    use 10s CAG, outer time_bucket(bucket_s)
elif bucket_s < 1600.0:
    use 1min CAG, outer time_bucket(bucket_s)
else:
    use 10min CAG, outer time_bucket(bucket_s)
```

### 4.2 Window-range view (derived)

For reference; the window ranges below fall out of the dispatch rule above:

| Window | Source | Bucket_s | Div |
|---|---|---|---|
| 1 - 16 min | Raw | 0.12 - 0.96 s | n/a (raw, COV-driven) |
| 16 min - 4 h | 1s CAG | 1.92 - 14.4 s | 1.92 - 14.4 |
| 4 h - 32 h | 10s CAG | 28.8 - 115.2 s | 2.88 - 11.52 |
| 32 h - 10 d | 1min CAG | 230.4 - 921.6 s | 3.84 - 15.36 |
| 10 d - 170 d | 10min CAG | 1843 - 14746 s | 3.07 - 24.58 |

Worst-case Div across the table is 24.58 (10min CAG at 85-170d). Every other operating point stays inside the cheap zone (Div ≤ 16).

### 4.3 Watermark-aware fallthrough

Each CAG has a `watermark_ts` reflecting how far materialization has advanced. For any query where `range_end > watermark_ts`, the dispatcher splits the query at `watermark_ts`, serves the materialized portion from the CAG, and serves the trailing portion from the next-finer source (CAG or raw). Without this, the live edge of trend views would show a flat line until the next CAG refresh.

This is mandatory in the trends API — retrofitting later is painful.

---

## 5. Query Shape

### 5.1 Canonical gapfill+locf query

This is the single query template used for both raw and CAG paths, differing only in source table:

```sql
SELECT s.tag_id,
       time_bucket_gapfill(make_interval(secs => $1::float8 / 1000.0),
                           s.ts, $2::timestamptz, $3::timestamptz) AS bucket,
       locf(
         last(value, s.ts),
         prev => (SELECT value FROM <source_table>
                  WHERE tag_id = s.tag_id 
                    AND ts < $2::timestamptz
                    AND ts >= $2::timestamptz - INTERVAL '5 minutes'
                  ORDER BY ts DESC LIMIT 1)
       ) AS val
FROM <source_table> s
WHERE s.tag_id = ANY($4::int[]) 
  AND s.ts >= $2::timestamptz 
  AND s.ts < $3::timestamptz
GROUP BY s.tag_id, bucket
ORDER BY s.tag_id, bucket
```

`<source_table>` is one of: `tag_samples` (raw), `tag_samples_1s_cagg`, `tag_samples_10s_cagg`, `tag_samples_1min_cagg`, `tag_samples_10min_cagg`.

### 5.2 The bounded `prev` subquery is mandatory

The `AND ts >= $2 - INTERVAL '5 minutes'` clause is **not optional**. Without it, the planner cannot prune chunks at plan time — every query enumerates the entire chunk set in the `prev` subquery's `ChunkAppend`, costing ~14 ms planning per tile against the current 88-chunk table. At 14-day retention steady state (~336 chunks), this would project to ~56 ms planning per tile.

With the 5-min bound, the planner uses the index condition `_ts_meta_max >= tileStart − 5 min` to prune to ≤2 chunks at plan time, dropping planning to ~1.85 ms. **This is the difference between a design that ships and stays shipped, and one that degrades silently as the table ages.**

### 5.3 Why 5 minutes, not less

The writer guarantees every trendable tag has a sample written at least every 60 seconds. The 5-minute bound provides 5× safety margin against writer hiccups, deployment restarts, clock skew, or transient gaps. Validated empirically: 0 NULL `prev` results across 1,600,000 lookups in gate testing at the 1-min bound.

If the writer cadence ever changes, the bound should be revisited.

### 5.4 NULL `prev` semantics

When no prior value exists within the 5-minute window (e.g., a freshly-created tag, or the start of the data retention window), the `prev` subquery returns NULL. The chart will show a NULL left-edge until the first in-window sample. **This is the correct default** — operators should see gaps as gaps, not as fabricated continuations of stale values.

### 5.5 Prepared statements: do not use

PostgreSQL's generic plan regime (activated after the 5th prepared execution) cannot use bind values for chunk pruning at plan time. Prepared statements move chunk-enumeration cost from plan-time to execution-time without reducing it, and break the bounded-`prev` optimization for raw queries. Use standard `client.query(text, values)` form.

---

## 6. Tile Structure

### 6.1 Fixed tile size: 250 buckets

Three independent justifications:

1. **Test (d) measured outcome:** 4×250 beats 1×1000 by 51% on uncompressed (61 ms → 30 ms wall-clock).
2. **Direct measurement coverage:** the perf battery's BC=250 cell is the highest-confidence operating point.
3. **Cliff avoidance:** per-tile working set stays below the heap-scatter cliff across the operating range.

### 6.2 4 tiles per window in parallel

Initial render fires 4 tiles via `Promise.all`. Per-query mean is ~70-90% of wall-clock (parallelism factor 2.79× measured, vs theoretical max 4×). The remaining gap is connection-pool contention and last-tile straggler effects.

For pan/scroll, ±1 overfetch is added (so 6 tiles total cached, but only 4 are rendered).

### 6.3 Per-query tag cap: N ≤ 8

The heap-scatter cliff lives at N≈10-11 on uncompressed and produces measurable degradation past N=8 even on compressed paths. The trends API caps N at 8 per query and fans out to multiple parallel queries for charts with more tags.

A 16-tag chart over a single window becomes 4 time-tiles × 2 tag-groups = 8 parallel queries. Connection pool sizing must account for this.

### 6.4 Connection pool sizing

Current `max = 10`. One operator opening a 16-tag chart consumes 8 connections. Five operators doing the same simultaneously would queue heavily. **Recommended pool size for production: 20-30**, with monitoring on pool utilization.

---

## 7. Performance Validation

All values from `historian_perf_battery_2026-04-24.md` and the three subsequent gate reports.

### 7.1 The cliff

Heap-scatter cliff on uncompressed data is the dominant performance constraint. It manifests when `N × BS × BC` (working-set size) crosses a threshold and the planner flips scan strategy.

- Compressed paths damp the cliff by ~3-5× but don't eliminate it
- CAG path exhibits the same cliff shape, just shifted (working-set budget roughly doubles before falling off)
- Tile splitting (4×250 vs 1×1000) keeps per-tile working set below the cliff

### 7.2 CAG-vs-raw speedup

Measured at N=5/BS=8 cag-compressed vs raw-compressed: **2.21×**. Holds across the BS-grid.

### 7.3 Re-aggregation cost (cag-compressed, N=8)

| Div | Latency |
|---:|---:|
| 1 | 8.45 ms |
| 4 | 8.78 ms |
| 8 | 9.61 ms |
| 16 | 12.58 ms |
| 32 | 16.71 ms |
| 64 | 25.97 ms |
| 128 | 46.29 ms |

Cheap zone: Div ≤ 16. Cost roughly doubles per doubling of Div past 16. Usable up to Div ≈ 30.

### 7.4 Gate results

| Gate | Configuration | Result | Notes |
|---|---|---|---|
| Gate 1 (raw, 16 min) | N=8, 4×250, 5-min bound | **PASS** | 33.36 ms compressed / 37.04 ms uncompressed |
| Gate 2 (1s CAG, Div=24.58) | N=8, 4×250, 5-min bound | **PASS** | 32.62 ms compressed; tight distribution (std 3.13 ms) |
| Single-query control | 1×1000, 5-min bound | n/a | 90.90 ms — confirms 4-tile parallelism wins (2.79×) |
| N-sweep | N=1, 4, 8 | linear | 9.90 / 21.95 / 36.60 ms wall-clock; ~3.5 ms/tag |

Gate 1 N-scaling note: the perf battery's BS-grid predictions were ~2× optimistic for the gate's 31K-rows-per-tile working set. Future predictions should use rows-scanned-per-tile, not Div alone.

### 7.5 Bounded `prev` fix validation

| Configuration | Compressed mean | Uncompressed mean | Planning |
|---|---|---|---|
| Unbounded `prev` | 50.97 ms ❌ | 66.25 ms ❌ | 14.77 ms |
| 5-min bound | 33.36 ms ✓ | 37.04 ms ✓ | 1.85 ms |
| 1-min bound | 32.56 ms ✓ | 38.47 ms ✓ | 1.85 ms |

ChunkAppend reduction in `prev` SubPlan: 61 nodes → 1 node. Catalog buffer hits: 1255 → 54. NULL `prev` rate at 1-min bound: 0 / 1,600,000 (writer cadence empirically confirmed).

---

## 8. Operational Dependencies

These are external assumptions the design relies on. Changes to any of them require revisiting the corresponding piece of the design.

### 8.1 Writer cadence

**Assumption:** every trendable tag has a sample written at least every 60 seconds.

**Used by:** the 5-minute `prev` bound in §5.2. If cadence relaxes to >5 minutes, the bound must increase, with corresponding planning-cost impact.

**Validation:** measured 0 NULL `prev` across 1.6M lookups at 1-min bound.

**Monitoring recommendation:** add a periodic query (e.g., daily) that samples the NULL `prev` rate at the 1-min bound on a representative window. Any non-zero rate is an early warning that writer behavior has changed.

### 8.2 Chunk policy (T004)

**Assumption:** 1h chunks, 10-min `compress_after`. Chunks older than ~70 min are fully compressed.

**Used by:** the entire performance model. The bounded `prev` subquery at 5-min lookback assumes chunk boundaries are 1h, so the planner sees ≤2 chunks. If chunk interval changes, the bound should be reviewed.

### 8.3 Tag pool size

**Current:** ~504 trendable tags. Tested with random selection of N=8 from this pool.

**Sensitivity:** the design isn't materially sensitive to total tag count up to several thousand. Per-query cost is driven by N (per-query) and pool concurrency, not the total pool size.

### 8.4 Connection pool

**Current:** max 10. **Recommended:** 20-30 for production with multi-operator concurrency.

---

## 9. Build Order

1. **Trends API with bounded `prev` query shape, raw-only dispatch.** Validate against existing perf scripts. No CAGs yet — raw is sufficient for windows < 16 min and the API can stub the CAG paths.
2. **1s CAG.** Bread-and-butter operator workload (16 min – 4 h windows).
3. **Watermark-aware dispatch.** Must be in place before 1s CAG ships in production.
4. **Validation pass.** Confirm the 2.21× CAG-vs-raw speedup ratio holds at production-relevant N and window sizes.
5. **10min CAG.** Long-window views (diagnostic / report-oriented).
6. **10s CAG and 1min CAG.** Equivalent risk; build in either order.
7. **Pool resize and monitoring.** Bump connection pool to 20-30, add NULL `prev` rate monitoring, add per-CAG latency dashboards.

Each gate is measurement-driven. Resist building all four CAGs upfront.

---

## 10. Open Items

1. **Re-run Gate 1 at table age ≥ 7 days.** Confirms the bounded-`prev` planning cost (~1.85 ms) stays flat as chunk count grows toward the 14-day steady state of ~336 chunks. Predicted: stable. If planning cost grows, indicates index-pruning isn't fully effective at scale.
2. **Add NULL `prev` rate to platform monitoring.** Per §8.1.
3. **Re-measure 10min CAG at 85+ d window** once that much historical data accumulates. Confirms or refutes the only operating point with Div > 16. If actual latency exceeds budget, add a 1h CAG.
4. **End-to-end smoke test through the trends API.** All gates measured raw SQL latency only. The full API path adds ~10 ms pg-node serialization at N=8 × 250 buckets, which should be confirmed empirically once the API is built.
5. **Connection-pool sizing measurement.** Establish how many concurrent operator sessions the current pool supports before queueing dominates. Inform deployment sizing.

---

## 11. Reference Documents

| Document | Purpose |
|---|---|
| `Trend_CAGs_Structure.md` | Design narrative, full window-to-CAG mapping table |
| `historian_perf_battery_2026-04-24.md` | Original perf measurements (raw + gapfill grids, tile-split) |
| `perf_gates_2026-04-27.md` | Gate run 1 (N=20, FAIL on Gate 2) |
| `perf_gates_2026-04-27_v2.md` | Gate run 2 (N=8, prepared statement diagnostic) |
| `perf_gates_prepared_2026-04-XX.md` | Prepared-statement experiment (disproved) |
| `perf_gates_bounded_prev_2026-04-XX.md` | Bounded-`prev` validation (PASS) |
| `trend_viewer_tiling_discussion.pdf` | Design discussion 2026-04-24 |
| `hmi_trend_viewer_spec_3.md` | Trend viewer functional spec |

---

## 12. Change Log

| Date | Change |
|---|---|
| 2026-04-27 | Initial summary. Design validated by gate testing with bounded `prev` fix. Ready for trends API implementation. |
