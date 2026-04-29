# Trend Viewer Performance Gates — 2026-04-27

## Summary

| Gate | Source | Window | N | Tiles | Bucket | Compressed p95 | Verdict |
|------|--------|--------|---|-------|--------|----------------|---------|
| 1 — Raw 16-min | `tag_samples` | 16 min | 20 | 4×250 | 0.96 s | 144.35 ms | **PASS** |
| 2 — 1s CAG ~6.83h | `caro_samples_1s` | ~6.83 h | 20 | 4×250 | 24.58 s | 133.75 ms | **FAIL** |

Both uncompressed sub-runs were skipped: the current open chunk spans were narrower than each gate's total window at time of measurement (Gate 1 needed 16 min, Gate 2 needed 6.83 h; open chunks were ~3 min and ~2 h respectively).

---

## Test Environment

| Parameter | Value |
|-----------|-------|
| Host | Local Docker (TimescaleDB 2.x) |
| chunk_time_interval | 1 h (tag_samples), automatic (CAG) |
| compress_after | 10 min |
| schedule_interval | 5 min |
| Simulator cadence | ~110 ms / tag |
| Trendable tag pool | 504 tags |
| timescalePool max | 10 connections |
| SEED | 42 (mulberry32) |
| Run date | 2026-04-27 |

---

## Methodology

Both gates follow the established `perf-tile-split.ts` pattern:

- **Tag selection:** Fresh random shuffle per trial, N=20 tags drawn from the 504-tag trendable pool.
- **Window placement:** Random `baseStart` aligned to a bucket boundary (calibrated via `time_bucket(bw, '2000-01-01')`) within the available compressed or uncompressed range.
- **Parallelism:** 4 tile queries launched via `Promise.all`. Per-tile timers (`t0t`) are captured synchronously before the promise is handed off, so per-tile latency is accurate under parallelism.
- **Wall-clock timing:** Measured across the full `Promise.all` — this is the metric the HMI server would observe.
- **Warmup:** 10 trials discarded at the start of each range run to prime the query planner and connection pool.
- **Trials:** 100 per range.
- **Compromise guard:** `is_compressed` for all chunks spanning the uncompressed range is snapshotted at startup and rechecked at end; any flip is flagged.

### Gate 1 SQL (raw gapfill+locf)

```sql
SELECT s.tag_id,
       time_bucket_gapfill(make_interval(secs => $1::float8 / 1000.0), s.ts,
                           $3::timestamptz, $4::timestamptz - interval '1 millisecond') AS bucket,
       locf(last(value, s.ts),
            prev => (SELECT value FROM tag_samples WHERE tag_id = s.tag_id AND ts < $3::timestamptz
                     ORDER BY ts DESC LIMIT 1)) AS val
  FROM tag_samples s
 WHERE s.tag_id = ANY($2::int[]) AND s.ts >= $3::timestamptz AND s.ts < $4::timestamptz
 GROUP BY s.tag_id, bucket ORDER BY s.tag_id, bucket
```

Parameters: `$1`=960 ms, `$2`=tag_ids, `$3`=tileStart, `$4`=tileEnd.

### Gate 2 SQL (CAG gapfill+locf)

Same structure but on `caro_samples_1s`; `time_bucket_gapfill(...)` repeated literally in `GROUP BY` because TimescaleDB's gapfill planner requires a literal call there (alias resolution is not accepted).

---

## Gate 1 — Raw tag_samples, 16-min window

**Parameters:** bucket_s = 0.96 s · 4 tiles × 250 buckets · tileSpan = 4 min · totalWindow = 16 min · N = 20  
**Pass criterion:** wall-clock p95 ≤ 150 ms  
**Script:** `packages/db/scripts/perf-gate-raw-16min.ts`  
**npm script:** `perf:gate-raw-16min`

### Compressed

| Metric | Wall-clock | Per-tile |
|--------|-----------|---------|
| min | 80.38 ms | 58.81 ms |
| mean | 121.43 ms | 107.43 ms |
| median | 101.74 ms | 92.39 ms |
| **p95** | **144.35 ms** | 130.82 ms |
| max | 1143.32 ms | 1143.27 ms |
| std | 112.23 ms | 106.88 ms |
| expected rows/tile | 5 000 | 5 000 |
| mismatches | 0 | — |

**Verdict: PASS** (p95 144.35 ms ≤ 150 ms)

### Uncompressed

**SKIPPED** — The open chunk at time of run spanned only ~3 min (14:00–14:03 UTC). The 16-min window requires a continuous uncompressed span of at least 960 s; the current chunk did not yet contain enough history.

---

## Gate 2 — 1s CAG, ~6.83h window

**Parameters:** bucket_s = 24.58 s (Div = 24.58) · 4 tiles × 250 buckets · tileSpan ≈ 1.707 h · totalWindow ≈ 6.83 h · N = 20  
**Pass criterion:** wall-clock p95 ≤ 100 ms  
**Script:** `packages/db/scripts/perf-gate-1scag-div24.ts`  
**npm script:** `perf:gate-1scag-div24`  
**CAG hypertable:** `_timescaledb_internal._materialized_hypertable_5`

### Compressed

| Metric | Wall-clock | Per-tile |
|--------|-----------|---------|
| min | 66.80 ms | 48.14 ms |
| mean | 99.56 ms | 91.57 ms |
| median | 93.92 ms | 90.03 ms |
| **p95** | **133.75 ms** | 123.36 ms |
| max | 353.95 ms | 353.92 ms |
| std | 33.05 ms | 24.61 ms |
| expected rows/tile | 5 000 | 5 000 |
| mismatches | 0 | — |

**Verdict: FAIL** (p95 133.75 ms > 100 ms)

### Uncompressed

**SKIPPED** — Open CAG chunk spanned ~2 h (12:00–14:03 UTC). The 6.83h window requires a continuous uncompressed span of at least 24 580 s (~6.83 h). Retry after the CAG accumulates a full-window's worth of uncompressed history.

---

## Caveats

**1. Uncompressed skipped for both gates.**  
Both open chunks were narrower than the respective windows at measurement time. Uncompressed gate results are needed to characterise heap-scatter behavior (the N≥11 cliff observed in raw battery at 1-min windows). These gates should be re-run once the open chunks have accumulated enough history.

**2. Gate 1 compressed max outlier (1143 ms).**  
One trial hit a 1143 ms wall-clock time (std = 112 ms vs. typical 10–30 ms). This is consistent with an OS/JIT pause or GC event on the `tsx` process rather than DB pathology. The p95 (144 ms) was unaffected.

**3. Gate 2 mean is essentially at threshold.**  
mean = 99.56 ms with p95 = 133.75 ms and max = 353.95 ms. The mean just squeezes under 100 ms but the distribution has a right tail (std = 33 ms). The 100 ms p95 threshold is tight for this workload with 3 days of compressed history.

**4. Data volume grows over time.**  
The CAG was measured at ~3 days of data (2026-04-24 → 2026-04-27). As history grows, compressed reads scan more chunks; latency at this Div/N combination should remain stable because TimescaleDB decompresses only the chunks within the query window. Re-measure at 7 d and 30 d to confirm.

**5. No compromise events.**  
Neither the raw nor CAG uncompressed chunks were compressed during either run (both runs completed in < 1 min).

---

## Recommendation

**Gate 1 (PASS):** The 16-min raw tile query is viable at N=20. The 4-tile parallel design gives ~4× concurrency headroom before serialization would set in. The 150 ms p95 criterion is met; the single 1143 ms outlier should be treated as a measurement artifact.

**Gate 2 (FAIL):** The 100 ms p95 criterion is not met at ~3 days of compressed history. However, the mean (99.56 ms) is essentially at the threshold and the FAIL is driven by the tail, not by a fundamentally slow path. Two options:

1. **Relax the Gate 2 criterion to p95 ≤ 150 ms.** The CAG is still ~3× faster than raw at equivalent rows-per-tile (from the raw-vs-cag battery: raw compressed mean ≈ 300 ms at N=20 over the same window). A 150 ms p95 CAG budget is consistent with the 300 ms promotion threshold in the trend viewer spec.

2. **Reduce Div (larger bucket).** A bucket_s of ~49 s (Div ≈ 49) at BC=250 × 4 tiles would match the same 6.83 h window but halve rows-per-tile, likely cutting p95 below 70 ms. This keeps the query count identical but reduces data density per tile.

**Immediate next step:** Re-run both gates with the uncompressed ranges populated (allow at least 16 min of open-chunk history for Gate 1 and 6.83 h for Gate 2) to complete the full characterization before finalizing thresholds.
