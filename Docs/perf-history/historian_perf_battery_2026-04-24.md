# Historian Performance Battery — 2026-04-24

**Date:** 2026-04-24
**Branch:** `dev`
**Hypertable:** `tag_samples` on `caro_timescale` (TimescaleDB, port 5433)
**Scripts:** `packages/db/scripts/perf-multi-tag.ts`, `perf-multi-tag-gapfill.ts`, `perf-multi-tag-gapfill-bucketcount.ts`, `perf-tile-split.ts`

This document captures four perf measurements taken in a single session to characterize TimescaleDB read latency under the new T004 chunk policy. Tests use the live HMI ingest path with the MQTT simulator running.

---

## 1. Database Configuration

| Setting | Value | Source |
|---|---|---|
| Hypertable | `tag_samples` | T001 |
| Value column type | `DOUBLE PRECISION` | T001 |
| Chunk interval | 1 hour | T004 |
| `compress_after` | 10 minutes | T004 |
| `schedule_interval` | 5 minutes | T004 |
| `compress_segmentby` | `tag_id` | T001 |
| `compress_orderby` | `ts DESC` | T001 |
| Retention | 14 days | T001 |

### Observed chunk compression

Per closed 1h chunk: ~1278 MB raw → ~82 MB compressed (≈ 15.6× ratio).
Storage rate: ~82 MB/hour ≈ 2 GB/day ≈ 28 GB over 14-day retention.

---

## 2. Test Environment

- HMI server publishing trendable tags every 250 ms (HmiTagSource).
- MQTT simulator running at 10 Hz per tag.
- Trendable tag pool: 504 tags.
- Probed sample cadence: ~110 ms median inter-sample delta (5 probe tags × 5 min window).
- TimescaleDB connection pool max: 10 connections.

---

## 3. Common Methodology

- **PRNG:** mulberry32, seeded `42`. Reproducible across runs.
- **Tag selection:** fresh random N tags per query (realistic mixed workload — each query arrives for a different tag set, as it would from independent operator sessions).
- **Per-case runs:** 100 timed iterations. Warmup of 10 queries on the first cell of each battery (excluded from stats).
- **Time ranges:**
  - **Compressed:** `MIN(range_start)` → `MAX(range_end)` across all chunks where `is_compressed = true`.
  - **Uncompressed:** latest chunk's `range_start` → `now` (the open chunk's tail).
- **Random window placement:** uniform within the range, aligned to bucket-interval boundaries where required (gapfill scripts).
- **Compromise guard:** snapshot of `chunk_compression_stats('tag_samples')` taken at startup and at end-of-run; chunks that flipped `false → true` mid-run are flagged. Affected uncompressed cells are not valid measurements.

---

## 4. Test (a) — Raw queries, N_tags 1..20

**Script:** `perf-multi-tag.ts`
**Window:** 1 minute random per query.
**Query:**

```sql
SELECT * FROM tag_samples
WHERE tag_id = ANY($1::int[])
  AND ts >= $2 AND ts < $3
```

### Full per-cell stats (latency in ms)

| N | C min | C mean | C med | C p95 | C max | C std | C rows | U min | U mean | U med | U p95 | U max | U std | U rows |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.75 | 4.30 | 3.30 | 12.19 | 37.90 | 4.40 | 341 | 1.46 | 3.79 | 3.76 | 5.68 | 22.49 | 2.23 | 417 |
| 2 | 1.71 | 4.30 | 4.29 | 6.14 | 23.63 | 2.34 | 703 | 1.37 | 3.83 | 4.05 | 5.50 | 5.97 | 1.21 | 698 |
| 3 | 1.72 | 5.03 | 4.72 | 7.04 | 20.71 | 2.61 | 979 | 1.91 | 5.17 | 5.00 | 7.08 | 9.13 | 1.20 | 1138 |
| 4 | 1.87 | 5.38 | 5.71 | 7.30 | 8.46 | 1.46 | 1352 | 1.61 | 5.80 | 5.83 | 7.55 | 9.42 | 1.34 | 1566 |
| 5 | 1.77 | 6.67 | 6.52 | 9.10 | 10.17 | 1.76 | 1857 | 3.18 | 6.50 | 6.68 | 9.09 | 10.51 | 1.61 | 1808 |
| 6 | 1.84 | 10.09 | 7.11 | 9.76 | 315.34 | 30.72 | 2089 | 4.28 | 8.31 | 8.22 | 11.87 | 15.38 | 2.23 | 2148 |
| 7 | 1.76 | 8.92 | 8.76 | 13.73 | 15.13 | 2.44 | 2522 | 4.69 | 8.70 | 8.29 | 12.73 | 16.40 | 2.16 | 2610 |
| 8 | 2.44 | 12.00 | 8.94 | 11.59 | 314.24 | 30.42 | 2896 | 3.63 | 9.00 | 9.10 | 12.05 | 16.83 | 2.06 | 2869 |
| 9 | 1.87 | 12.60 | 9.87 | 13.43 | 304.85 | 29.49 | 3110 | 5.57 | 10.23 | 10.33 | 13.69 | 14.95 | 1.97 | 3403 |
| 10 | 1.90 | 13.99 | 11.22 | 14.05 | 316.29 | 30.48 | 3791 | 4.91 | 11.62 | 11.11 | 14.50 | 74.10 | 6.60 | 3688 |
| 11 | 1.73 | 11.16 | 11.68 | 15.06 | 16.59 | 2.91 | 3939 | 8.34 | 68.07 | 68.93 | 75.78 | 78.74 | 9.00 | 4006 |
| 12 | 2.00 | 12.03 | 12.06 | 16.13 | 18.01 | 2.79 | 4269 | 33.29 | 69.65 | 70.44 | 78.27 | 85.25 | 8.02 | 4473 |
| 13 | 1.80 | 12.97 | 13.29 | 17.50 | 19.21 | 3.01 | 4523 | 38.24 | 71.79 | 72.10 | 81.64 | 142.10 | 10.75 | 4956 |
| 14 | 1.96 | 16.91 | 14.10 | 20.05 | 311.86 | 29.92 | 4880 | 38.80 | 70.85 | 71.70 | 79.42 | 84.02 | 8.12 | 5266 |
| 15 | 1.94 | 14.39 | 14.73 | 19.26 | 22.52 | 3.93 | 5258 | 35.59 | 70.60 | 73.23 | 81.65 | 87.26 | 10.79 | 5484 |
| 16 | 2.31 | 19.07 | 16.44 | 20.31 | 331.09 | 31.51 | 5767 | 37.19 | 72.58 | 73.56 | 81.98 | 89.69 | 8.68 | 5843 |
| 17 | 1.61 | 17.10 | 16.77 | 24.71 | 32.07 | 4.98 | 5989 | 36.63 | 72.22 | 74.85 | 83.52 | 86.90 | 11.44 | 6385 |
| 18 | 2.10 | 17.95 | 17.91 | 23.05 | 25.88 | 3.72 | 6521 | 38.76 | 74.22 | 75.23 | 82.14 | 88.59 | 8.01 | 6711 |
| 19 | 1.89 | 17.65 | 18.33 | 23.06 | 25.12 | 4.21 | 6626 | 39.50 | 80.63 | 78.74 | 92.01 | 385.18 | 32.62 | 7170 |
| 20 | 1.64 | 19.80 | 19.70 | 26.52 | 32.16 | 4.59 | 7169 | 39.65 | 75.74 | 77.12 | 86.57 | 97.45 | 10.20 | 7065 |

C = compressed; U = uncompressed. All times in ms.

### Findings

Sharp step change in uncompressed mean at **N=10 → N=11**: 11.62 ms → 68.07 ms (≈ 6×). Above N=10, the uncompressed path is *slower* than the compressed path. The shape — sharp cliff followed by a flat plateau — is the signature of a PostgreSQL planner strategy flip, most likely BitmapHeapScan → SeqScan when `tag_id = ANY(...)` selectivity crosses ~10 elements on the uncompressed chunk.

Compressed scales linearly with N (~1 ms/tag added). Compressed-side outliers at ~310–330 ms (N=6, 8, 9, 10, 14, 16) inflate the mean but leave the median clean — likely plan variance or vacuum/WAL activity.

---

## 5. Test (b) — Gapfill, bucket-size × N_tags

**Script:** `perf-multi-tag-gapfill.ts`
**Fixed:** `BUCKET_COUNT = 250`.
**Sweep:** `BS ∈ {2, 4, 6, 8, 10, 12, 14, 16, 18, 20}` samples/bucket; `N ∈ {1..20}`.
**Query span per call:** `250 × BS × SAMPLE_INTERVAL_MS`.
**Query:**

```sql
SELECT s.tag_id,
       time_bucket_gapfill(make_interval(secs => $1::float8 / 1000.0),
                           s.ts, $start, $finish) AS bucket,
       locf(
         last(value, s.ts),
         prev => (SELECT value FROM tag_samples
                  WHERE tag_id = s.tag_id AND ts < $start
                  ORDER BY ts DESC LIMIT 1)
       ) AS val
FROM tag_samples s
WHERE s.tag_id = ANY($2::int[]) AND s.ts >= $start AND s.ts < $finish
GROUP BY s.tag_id, bucket
ORDER BY s.tag_id, bucket
```

### Compressed mean latency (ms)

| N\BS | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7.02 | 6.64 | 7.13 | 6.57 | 6.18 | 6.93 | 6.57 | 6.50 | 6.89 | 6.46 |
| 2 | 6.40 | 6.71 | 6.86 | 6.70 | 6.67 | 8.02 | 7.41 | 7.87 | 9.59 | 7.72 |
| 3 | 6.97 | 7.48 | 7.40 | 7.62 | 7.62 | 7.83 | 8.47 | 8.60 | 8.70 | 8.77 |
| 4 | 7.67 | 8.29 | 7.91 | 8.44 | 8.75 | 8.85 | 9.25 | 9.19 | 10.02 | 10.43 |
| 5 | 8.38 | 8.81 | 8.95 | 9.24 | 9.79 | 9.84 | 10.29 | 10.01 | 10.75 | 11.50 |
| 6 | 9.09 | 9.48 | 9.44 | 10.01 | 10.79 | 10.99 | 11.49 | 11.56 | 12.57 | 12.41 |
| 7 | 9.81 | 9.86 | 10.43 | 11.20 | 11.04 | 11.58 | 11.99 | 12.27 | 12.87 | 14.46 |
| 8 | 10.20 | 10.65 | 10.72 | 11.42 | 12.30 | 12.67 | 12.67 | 13.63 | 14.49 | 15.26 |
| 9 | 11.07 | 10.99 | 11.52 | 12.33 | 12.82 | 13.19 | 15.37 | 14.79 | 14.74 | 16.27 |
| 10 | 11.64 | 11.77 | 12.88 | 14.08 | 13.15 | 14.54 | 14.04 | 15.52 | 17.72 | 18.83 |
| 11 | 12.67 | 12.50 | 13.20 | 13.37 | 14.80 | 15.42 | 16.64 | 17.10 | 17.26 | 18.46 |
| 12 | 12.81 | 13.15 | 13.89 | 14.54 | 15.55 | 16.30 | 16.91 | 18.33 | 18.80 | 19.68 |
| 13 | 13.07 | 13.65 | 14.82 | 15.20 | 15.68 | 16.38 | 18.95 | 18.55 | 20.78 | 20.14 |
| 14 | 13.94 | 14.59 | 15.07 | 15.85 | 17.01 | 18.30 | 19.22 | 20.06 | 20.53 | 21.57 |
| 15 | 17.69 | 15.39 | 15.96 | 17.08 | 19.52 | 19.01 | 19.63 | 20.56 | 23.05 | 23.05 |
| 16 | 14.84 | 17.13 | 17.01 | 18.12 | 19.21 | 20.06 | 21.16 | 23.86 | 23.17 | 24.37 |
| 17 | 15.93 | 16.63 | 16.76 | 18.01 | 19.92 | 21.73 | 22.08 | 22.71 | 26.26 | 26.63 |
| 18 | 17.36 | 20.12 | 19.19 | 17.82 | 20.71 | 21.17 | 23.73 | 24.86 | 27.82 | 26.53 |
| 19 | 18.30 | 18.70 | 19.19 | 23.17 | 22.91 | 24.39 | 26.74 | 26.27 | 27.53 | 28.79 |
| 20 | 18.05 | 18.93 | 18.97 | 20.89 | 21.97 | 23.97 | 25.17 | 27.70 | 27.54 | 28.57 |

### Uncompressed mean latency (ms)

Cells flagged `*` are compromised: either by mid-run compression of the targeted chunk or by the heap-scatter cliff manifesting naturally. See findings below.

| N\BS | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 9.18 | 9.54 | 10.03 | 9.37 | 10.19 | 10.24 | 10.32 | 10.92 | 11.65 | 11.96 |
| 2 | 8.96 | 9.60 | 10.48 | 11.19 | 13.65 | 14.25 | 14.60 | 16.80 | 16.36 | 16.00 |
| 3 | 10.53 | 10.87 | 12.33 | 12.88 | 14.13 | 15.62 | 16.61 | 17.26 | 18.63 | 20.00 |
| 4 | 10.55 | 11.95 | 13.52 | 15.85 | 16.79 | 18.06 | 19.27 | 22.21 | 21.96 | 25.11 |
| 5 | 11.29 | 12.66 | 15.33 | 16.93 | 20.15 | 20.92 | 22.95 | 24.41 | 26.49 | 29.40 |
| 6 | 11.80 | 14.00 | 16.91 | 18.34 | 21.64 | 24.16 | 25.48 | 27.65 | 30.13 | 32.82 |
| 7 | 12.64 | 15.47 | 18.25 | 21.17 | 24.20 | 25.55 | 28.73 | 30.65 | 35.21 | 37.42 |
| 8 | 14.30 | 16.60 | 19.66 | 21.81 | 26.37 | 28.95 | 30.82 | 36.90 | 38.80 | 41.35 |
| 9 | 14.09 | 17.34 | 21.28 | 24.53 | 28.28 | 30.69 | 35.47 | 38.56 | 41.47 | 44.33 |
| 10 | 15.58 | 22.99 | 78.80\* | 99.66\* | 63.32\* | 67.52\* | 118.63\* | 80.38\* | 52.18\* | 52.16\* |
| 11 | 57.99 | 76.23 | 90.77 | 97.51 | 108.10 | 116.07 | 130.05 | 135.74 | 142.81 | 117.09 |
| 12 | 75.07 | 78.52 | 89.48 | 97.79 | 107.51 | 117.43 | 129.71 | 137.06 | 144.77 | 154.46 |
| 13 | 77.66 | 77.60 | 90.43 | 99.79 | 116.36 | 118.09 | 130.64 | 137.61 | 146.72 | 155.96 |
| 14 | 75.40 | 81.26 | 92.48 | 100.82 | 112.11 | 120.58 | 137.01 | 141.05 | 149.87 | 157.16 |
| 15 | 77.42 | 80.32 | 92.74 | 101.59 | 109.33 | 120.11 | 132.76 | 143.17 | 149.54 | 158.96 |
| 16 | 80.54 | 80.57 | 94.56 | 103.50 | 112.03 | 122.53 | 134.02 | 141.99 | 150.85 | 161.99 |
| 17 | 78.78 | 81.26 | 94.41 | 106.57 | 114.37 | 126.59 | 137.77 | 146.84 | 155.02 | 164.18 |
| 18 | 78.79 | 82.98 | 96.31 | 104.69 | 116.03 | 125.20 | 140.41 | 149.27 | 157.11 | 171.55 |
| 19 | 81.06 | 85.39 | 104.83 | 114.83 | 27.62\* | 26.07\* | 26.75\* | 29.91\* | 31.26\* | 31.37\* |
| 20 | 22.25\* | 21.76\* | 22.41\* | 23.77\* | 24.99\* | 26.46\* | 28.58\* | 29.16\* | 29.96\* | 30.89\* |

### Findings

Compressed gapfill is flat and fast across the entire 20×10 grid. Maximum cell: 28.79 ms (N=19, BS=20). Compression eliminates bucket-span cost entirely — latency is almost purely a function of N.

Uncompressed shows a two-dimensional cliff. The N=11 cliff from raw queries is preserved, and BS amplifies it: at N=11 the latency rises from 58 ms (BS=2) to 117 ms (BS=20). For N ≥ 11 the entire row is in the 75–170 ms band. The N=10 BS≥6 cells appear to enter the cliff early (78 ms at BS=6) rather than being post-compression artifacts.

Compromise guard fired during this run: chunk targeted as "uncompressed" was compressed mid-test. Cells in N=19 BS≥10 and all of N=20 reflect the post-compression warm path, not uncompressed performance.

`prev` correlated subquery overhead vs. a prev-less variant: ~3 ms at N=1, ~8 ms at N=20, scaling with N and nearly independent of BS — consistent with the planner hoisting the subquery to once per tag group (not once per (tag, bucket) group).

---

## 6. Test (c) — Gapfill, bucket-count × N_tags

**Script:** `perf-multi-tag-gapfill-bucketcount.ts`
**Fixed:** `BS = 16` samples/bucket.
**Sweep:** `BC ∈ {100, 200, 300, 400, 500, 600, 700, 800, 900, 1000}`; `N ∈ {1..20}`.
**Query span per call:** `BC × 16 × SAMPLE_INTERVAL_MS` (≈ 29 min at BC=1000).

### Compressed mean latency (ms)

| N\BC | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7.92 | 8.81 | 8.18 | 8.57 | 10.14 | 10.71 | 9.08 | 9.60 | 9.62 | 10.48 |
| 2 | 6.93 | 7.11 | 8.17 | 8.88 | 10.31 | 10.93 | 11.47 | 13.51 | 13.68 | 14.56 |
| 3 | 7.10 | 7.86 | 9.68 | 11.64 | 11.94 | 13.19 | 14.34 | 16.58 | 18.04 | 18.55 |
| 4 | 7.96 | 9.06 | 10.49 | 12.46 | 13.69 | 15.24 | 18.07 | 18.97 | 20.39 | 23.83 |
| 5 | 8.03 | 9.96 | 11.92 | 13.83 | 15.87 | 18.71 | 20.23 | 22.21 | 25.25 | 25.90 |
| 6 | 8.62 | 10.56 | 13.29 | 15.63 | 17.69 | 21.17 | 22.33 | 25.02 | 28.34 | 29.45 |
| 7 | 8.88 | 11.27 | 14.16 | 17.75 | 20.42 | 26.35 | 25.44 | 28.34 | 31.10 | 33.99 |
| 8 | 8.94 | 12.22 | 15.38 | 18.23 | 20.90 | 25.85 | 29.23 | 31.42 | 35.75 | 38.51 |
| 9 | 9.27 | 12.68 | 16.39 | 20.07 | 23.56 | 25.74 | 30.45 | 34.99 | 37.92 | 41.19 |
| 10 | 10.11 | 13.95 | 17.95 | 23.79 | 26.51 | 29.33 | 33.92 | 37.63 | 40.60 | 45.99 |
| 11 | 10.34 | 14.00 | 18.51 | 23.79 | 27.24 | 32.56 | 35.43 | 40.75 | 44.61 | 48.79 |
| 12 | 10.61 | 15.62 | 20.21 | 25.25 | 30.68 | 35.85 | 39.33 | 47.68 | 48.81 | 53.24 |
| 13 | 11.68 | 15.84 | 21.87 | 26.40 | 32.06 | 36.41 | 40.09 | 46.83 | 53.02 | 57.45 |
| 14 | 11.46 | 17.06 | 21.88 | 28.31 | 33.98 | 37.27 | 45.06 | 49.70 | 56.08 | 61.54 |
| 15 | 11.95 | 18.03 | 23.33 | 29.30 | 40.23 | 44.39 | 47.13 | 53.70 | 60.70 | 65.06 |
| 16 | 12.36 | 18.02 | 23.77 | 30.99 | 37.38 | 48.68 | 49.38 | 57.61 | 61.95 | 69.89 |
| 17 | 12.87 | 20.70 | 25.72 | 33.62 | 39.77 | 47.63 | 51.88 | 59.90 | 71.90 | 74.87 |
| 18 | 12.78 | 20.01 | 27.03 | 37.56 | 42.00 | 51.45 | 61.05 | 66.00 | 70.07 | 78.92 |
| 19 | 14.38 | 20.88 | 27.47 | 34.65 | 43.78 | 50.22 | 58.97 | 66.39 | 73.61 | 83.27 |
| 20 | 14.62 | 22.47 | 29.01 | 36.86 | 44.98 | 53.33 | 60.29 | 70.48 | 78.90 | 85.46 |

### Uncompressed mean latency (ms)

`—` = SKIPPED (query span exceeded the uncompressed range).
`*` = compromised (mid-run compression of targeted chunk).

| N\BC | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 12.53 | 13.27 | 15.04 | 17.34 | 18.85 | 21.03 | 23.30 | 26.05 | 29.54 | — |
| 2 | 11.03 | 14.04 | 16.71 | 23.24 | 28.77 | 32.38 | 39.48 | 41.71 | 47.01 | — |
| 3 | 12.44 | 17.20 | 25.04 | 30.59 | 36.05 | 41.00 | 48.44 | 53.30 | 58.69 | — |
| 4 | 13.93 | 19.47 | 28.51 | 35.88 | 42.03 | 51.66 | 57.92 | 62.80 | 73.24 | — |
| 5 | 14.62 | 24.27 | 32.73 | 38.27 | 49.77 | 59.10 | 70.99 | 78.14 | 100.11 | — |
| 6 | 16.05 | 24.49 | 36.14 | 45.70 | 57.51 | 66.30 | 78.61 | 122.44 | 275.10 | — |
| 7 | 17.38 | 28.08 | 38.64 | 51.20 | 63.60 | 83.09 | 182.39 | 236.76 | 324.02 | — |
| 8 | 18.51 | 30.21 | 42.95 | 57.13 | 66.19 | 100.02 | 258.62 | 332.55 | 369.28 | — |
| 9 | 19.33 | 33.16 | 43.57 | 58.41 | 71.92 | 136.40 | 287.55 | 380.45 | 437.68 | — |
| 10 | 27.32 | 33.89 | 46.84 | 63.96 | 88.79 | 293.54 | 349.93 | 425.73 | 506.78 | — |
| 11 | 87.51\* | 66.52\* | 52.34\* | 67.36\* | 118.59\* | 315.05\* | 372.25\* | 474.67\* | 554.29\* | — |
| 12 | 87.17\* | 120.84\* | 138.34\* | 80.86\* | 289.09\* | 341.64\* | 430.71\* | 543.75\* | 590.94\* | — |
| 13 | 88.98\* | 122.45\* | 153.74\* | 124.72\* | 308.71\* | 383.60\* | 470.09\* | 579.75\* | 651.94\* | — |
| 14 | 90.89\* | 124.43\* | 154.81\* | 184.70\* | 330.59\* | 452.44\* | 540.79\* | 640.48\* | 690.56\* | — |
| 15 | 92.26\* | 129.51\* | 156.76\* | 185.70\* | 352.36\* | 473.39\* | 564.91\* | 670.66\* | 724.09\* | — |
| 16 | 90.30\* | 127.98\* | 156.33\* | 188.94\* | 274.05\* | 174.16\* | 51.94\* | 57.38\* | 63.88\* | — |
| 17 | 15.97\* | 22.74\* | 29.17\* | 35.17\* | 41.50\* | 48.18\* | 56.17\* | 61.51\* | 68.69\* | — |
| 18 | 16.63\* | 22.98\* | 30.73\* | 39.44\* | 46.17\* | 56.52\* | 66.43\* | 64.05\* | 71.86\* | — |
| 19 | 16.68\* | 23.85\* | 31.61\* | 38.41\* | 45.63\* | 52.12\* | 61.31\* | 67.50\* | 75.51\* | — |
| 20 | 17.29\* | 24.89\* | 31.99\* | 39.92\* | 47.53\* | 55.45\* | 64.14\* | 70.83\* | 78.59\* | — |

### Findings

Compressed scales smoothly and approximately proportional to `N × BC`. Max valid cell: 85.46 ms at N=20, BC=1000 (≈ 20,000 rows).

Uncompressed shows the heap-scatter cliff explicitly as a function of working-set size. Through N=10 the cliff is observable in the data: latency stays modest at low BC and climbs sharply once the random window pulls enough heap pages. Examples at N=10: BC=500 = 88.79 ms, BC=600 = 293.54 ms, BC=900 = 506.78 ms.

Mid-run compression invalidated rows N=11..20. The compromise guard caught it. The pattern is unmistakable: rows N=11..15 show the post-compression cold path (very high latencies as the decompressor warmed), then rows N=16..20 collapse to fast values once decompressor caches were warm.

`BC=1000` was SKIPPED across the entire uncompressed column because the 29-min span exceeded the open chunk's `[range_start, now]` window at run start.

---

## 7. Test (d) — Single tile vs 4 parallel tiles

**Script:** `perf-tile-split.ts`
**Fixed:** `N = 5`, `BS = 8` samples/bucket, `BC_total = 1000` (≈ 872 sec span).
**Mode A:** one query × 1000 buckets.
**Mode B:** four parallel queries × 250 buckets each, time-offset by 250 buckets, launched via `Promise.all`.
Same 5 random tags and same `baseStart` used by both modes within a trial. 100 trials per range.

### Wall-clock comparison

| Range | Mode | Mean (ms) | p95 (ms) | Δ vs Mode A |
|---|---|---:|---:|---:|
| Compressed | A (1×1000) | 24.14 | 32.82 | — |
| Compressed | B (4×250) | 21.82 | 25.36 | −10% mean / −23% p95 |
| Uncompressed | A (1×1000) | 61.29 | 76.12 | — |
| Uncompressed | B (4×250) | 29.84 | 35.57 | −51% mean / −53% p95 |

### Mode B per-query (individual tile latency)

| Range | Per-query mean | Per-query p95 |
|---|---:|---:|
| Compressed | 18.47 | 24.20 |
| Uncompressed | 27.55 | 33.86 |

### Findings

Compressed split: marginal win (~10% mean / 23% p95). The per-query mean (18.5 ms) is 85% of the wall-clock (21.8 ms), confirming genuine parallel execution; the gap is the last-tile straggler.

Uncompressed split: 2× speedup wall-clock. Per-query mean (27.6 ms) is ~92% of the wall-clock (29.8 ms) — the four tiles run almost perfectly in parallel. The mechanism is straightforward: each 250-bucket tile's working set is small enough to stay below the heap-scatter threshold that punishes the single 1000-bucket query.

Tile split is only meaningful for the uncompressed-tail portion of any tile request. Compressed-side gains do not justify the added complexity on their own.

---

## 8. Cross-cutting Observations

The dominant performance constraint for the trends API is the heap-scatter cliff on uncompressed data. It manifests at:

- **N≈11** in raw queries (one-minute window).
- **N≈10 with BS≥6** in 250-bucket gapfill queries.
- **High BC** at any N in 16-sample-bucket gapfill queries (working-set size, not tag count, drives the cliff in this axis).

Compression eliminates the cliff entirely. Compressed-side measurements scale predictably with row count regardless of axis (N, BS, BC). The compressed path is always faster than uncompressed once N ≥ 11 — compression is helping, not hurting, read latency at production-relevant query sizes.

For the trends tile endpoint (capped at 20 tags), the open-chunk tail is the worst case. Tile splitting (Test d) cuts uncompressed wall-clock latency in half by both reducing per-tile working set and overlapping I/O across the connection pool. This is the most direct mitigation for the cliff that does not require changing chunk policy.

---

## 9. Caveats

- All measurements are means/p95 over 100 trials per case. Outlier effects from concurrent compression jobs, vacuum, or WAL checkpoints are visible in some compressed-side cells (300+ ms maxes inflating the mean while leaving the median clean).
- The "uncompressed range" is whatever was open at script start. Test (b) and Test (c) both saw mid-run compression; the compromise guard correctly flagged affected cells.
- Sample interval (~110 ms) is empirical, derived from a 5-min × 5-tag probe at startup. It varies modestly with simulator load.
- Results here are single-machine, single-database benchmarks against a populated but not heavily contested instance. Production behavior under concurrent operator sessions has not been measured.
