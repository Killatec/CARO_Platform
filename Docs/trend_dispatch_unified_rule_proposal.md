# Trend Dispatch — Unified Rule Proposal

**Status:** Implemented. See commit `trend-viewer: Phase 6 — unified dispatch rule (proposal validated)`.
**Date:** 2026-05-12 (proposal); validated 2026-05-15
**Author:** PM / Claude
**Related:** `Docs/hmi_trend_viewer_handoff.md`, `Docs/DB_Config_Usage_And_Perf.md`, `Docs/CARO_Trending_Reference.md`, `Docs/CARO_DB_Spec.md` §9.

---

## 1. Summary

Replace the current dual-axis dispatch logic (`bucket_s < 1.0 → raw COV` plus a separate window-range table) with a single static inequality driven by an assumed worst-case sample rate. The rule treats the **bucket count** as a hard ceiling on rendered points per tile and switches to bucketed output (with `min` / `max` / `null_count`) whenever the worst-case raw point count would exceed it.

```
if (window_s * sampleRateHz > bucketsPerWindow) → bucketed
else                                            → raw COV
```

With `sampleRateHz = 10` and `bucketsPerWindow = 1000` (current defaults), the crossover is at exactly **100 s**.

Below 100 s: serve raw COV samples from `tag_samples`.
Above 100 s: serve bucketed `{ last, min, max, null_count }` rows via `time_bucket_gapfill + locf`. The source table is chosen by the existing `bucket_s` dispatch (raw `tag_samples` for sub-1 s buckets, then 1 s / 10 s / 1 min / 10 min CAGs).

---

## 2. Current State

### 2.1 Tile and bucket geometry

From `packages/trend-chart/src/level.ts` (`TREND_VIEWER_DEFAULTS`):

- `bucketCount = 500` (per tile)
- `visibleTilesPerWindow = 2`
- `overfetchPerSide = 1`
- **Visible buckets per window = `2 × 500 = 1,000`**
- Cache holds 4 tiles (2,000 buckets) when overfetch is active; only 2 are rendered.

### 2.2 Current dispatch (`DB_Config_Usage_And_Perf.md` §4.1)

```
bucket_s = window_s / total_buckets

if bucket_s < 1.0   → raw tag_samples
elif < 16           → 1s CAG
elif < 160          → 10s CAG
elif < 1600         → 1min CAG
else                → 10min CAG
```

Two implicit decisions live in this rule:

1. "Anything finer than 1 s must be raw because the finest CAG bucket is 1 s."
2. "Raw is always COV, never bucketed."

The proposal challenges (2). The TimescaleDB `time_bucket_gapfill + locf` query template works against `tag_samples` exactly as it does against any CAG (see §4.2 below) — the source-table swap is the only difference. So sub-1 s buckets are achievable; we simply haven't been issuing them.

### 2.3 Resulting routing under the current rule, per preset

| Preset | Window | bucket_s | Source | Shape |
|---|---:|---:|---|---|
| 1m | 60 s | 0.06 s | Raw | COV samples |
| 5m | 300 s | 0.30 s | Raw | COV samples |
| 15m | 900 s | 0.90 s | Raw | COV samples |
| 1h | 3,600 s | 3.6 s | 1s CAG | Bucketed |
| 4h | 14,400 s | 14.4 s | 1s CAG | Bucketed |
| 24h | 86,400 s | 86.4 s | 10s CAG | Bucketed |
| 7d | 604,800 s | 604.8 s | 1min CAG | Bucketed |
| 14d | 1,209,600 s | 1,209.6 s | 1min CAG | Bucketed |

---

## 3. Motivation

Four problems with the current dispatch:

1. **Observed slowness at 5m / 15m presets.** Chart feels noticeably laggy at the 5m and 15m presets in production; fast at all other presets (1m, 1h, 4h, 24h, 7d, 14d). The cause is the raw-COV row count at those windows: 20–30k samples per visible window at ~5.7 Hz production activity (measured), well above the chart's pixel resolution (~1,200 px ≈ same number of meaningful points). The browser does linear work on samples that can't be visually distinguished anyway.
2. **Unbounded raw payload at high activity.** A 15 m window at 10 Hz worst-case COV produces 9,000 sample rows per tag (per visible window); at N = 8 that's 72,000 rows over the wire per render. The current rule has no upper bound.
3. **Inconsistent rendering shape across presets.** The raw COV path returns `{ ts, value }`; the CAG path returns `{ ts, value, min, max, null_count }`. UI code branches on the discriminant (`mergeTrendData`, `useLiveSubscription`, `TrendChart`). Short windows lose the `min` / `max` ribbon that operators rely on for excursion detection at longer windows.
4. **No clean rule for custom zoom.** Drag-zoom and End-picker can produce arbitrary windows. The current dispatch handles them correctly via `bucket_s`, but the COV-vs-bucketed shape flips silently at exactly 1,000 s (bucket_s = 1.0) under the current rule.

The proposal addresses (1), (2), and (3) directly and replaces (4)'s silent flip with a deterministic single-inequality threshold at 100 s.

---

## 4. The Proposal

### 4.1 Dispatch rule

A single inequality, evaluated client-side from the requested window size:

```typescript
const SAMPLE_RATE_HZ = 10;  // worst-case assumption
const bucketsPerWindow = visibleTilesPerWindow * bucketCount;  // 1000 at defaults

function shape(windowMs: bigint): 'raw' | 'bucketed' {
  const expectedPoints = Number(windowMs) / 1000 * SAMPLE_RATE_HZ;
  return expectedPoints > bucketsPerWindow ? 'bucketed' : 'raw';
}
```

Source-table selection inside the bucketed branch follows the existing `bucket_s` rule unchanged. The only new entry is the `tag_samples` raw-source bucketed path for `bucket_s < 1.0`.

### 4.2 Source-table dispatch (bucketed branch)

```
bucket_s < 1.0     → tag_samples (raw, aggregated at query time)
1.0 ≤ bucket_s < 16  → tag_samples_1s_cagg
16 ≤ bucket_s < 160  → tag_samples_10s_cagg
160 ≤ bucket_s < 1600 → tag_samples_1min_cagg
bucket_s ≥ 1600     → tag_samples_10min_cagg
```

The bottom row of this table is new. Everything else is unchanged.

### 4.3 Resulting routing, per preset

| Preset | Window | Worst-case points @ 10 Hz | Buckets / Window | Shape | Source |
|---|---:|---:|---:|---|---|
| 1m | 60 s | 600 | 1,000 | Raw COV | `tag_samples` |
| 5m | 300 s | 3,000 | 1,000 | Bucketed | `tag_samples` (raw-source) |
| 15m | 900 s | 9,000 | 1,000 | Bucketed | `tag_samples` (raw-source) |
| 1h | 3,600 s | 36,000 | 1,000 | Bucketed | 1s CAG |
| 4h | 14,400 s | 144,000 | 1,000 | Bucketed | 1s CAG |
| 24h | 86,400 s | 864,000 | 1,000 | Bucketed | 10s CAG |
| 7d | 604,800 s | 6,048,000 | 1,000 | Bucketed | 1min CAG |
| 14d | 1,209,600 s | 12,096,000 | 1,000 | Bucketed | 1min CAG |

The only changes from current behavior: **5m and 15m flip from raw COV to bucketed (raw-source)**. Custom zoom windows now flip at exactly 100 s.

---

## 5. SQL Implementation

### 5.1 No new TimescaleDB primitives required

The raw-source bucketed query uses the same TimescaleDB functions as the existing CAG queries:

| Operation | Function | Notes |
|---|---|---|
| Time bucketing | `time_bucket_gapfill()` | Emits empty buckets for the gapfill grid |
| LOCF carry-forward | `locf(..., prev => bounded_subquery)` | 5-min `prev` bound unchanged |
| Last value | `last(value, ts)` | TimescaleDB aggregate |
| Min / Max | `min()`, `max()` | Standard SQL |
| Null count | `count(*) FILTER (WHERE value IS NULL)` | Standard SQL |

No JS-side aggregation. No new functions, materialized views, or compression policies.

### 5.2 Canonical raw-source bucketed query

```sql
SELECT s.tag_id,
       time_bucket_gapfill(make_interval(secs => $1::float8 / 1000.0),
                           s.ts, $2::timestamptz, $3::timestamptz) AS bucket,
       locf(
         last(value, s.ts),
         prev => (SELECT value FROM tag_samples
                  WHERE tag_id = s.tag_id
                    AND ts < $2::timestamptz
                    AND ts >= $2::timestamptz - INTERVAL '5 minutes'
                  ORDER BY ts DESC LIMIT 1)
       ) AS val,
       min(value) AS bucket_min,
       max(value) AS bucket_max,
       count(*) FILTER (WHERE value IS NULL) AS null_count
FROM tag_samples s
WHERE s.tag_id = ANY($4::int[])
  AND s.ts >= $2::timestamptz
  AND s.ts < $3::timestamptz
GROUP BY s.tag_id, bucket
ORDER BY s.tag_id, bucket
```

### 5.3 Differences vs. existing CAG outer queries

Column references only:

- **CAG path:** `min(s.min)`, `max(s.max)`, `last(s.last, s.bucket)`, `sum(s.null_count)` — aggregating CAG-materialized columns.
- **Raw-source path:** `min(value)`, `max(value)`, `last(value, ts)`, `count(*) FILTER (WHERE value IS NULL)` — aggregating individual samples.

Same envelope, same `prev` subquery, same return columns to the client. The response decoder in `packages/db/timescale/trends.ts` does not change.

### 5.4 Bounded `prev` subquery — mandatory

The 5-minute `prev` bound (`DB_Config_Usage_And_Perf.md` §5.2) applies unchanged. At 1-hour `tag_samples` chunks, the planner prunes to ≤ 2 chunks for the `prev` lookup. Without the bound, planning regresses to ~14 ms per tile and worsens with table age. Already validated empirically: 0 NULL `prev` results across 1,600,000 lookups at the 1-min bound.

---

## 6. Live Tail Compatibility

`useLiveSubscription` already supports both shapes:

- **Raw buffer path** (`rawBuffersRef`) — used when the visible chart is in raw mode.
- **FIFO + bucket accumulator path** — used when the visible chart is in bucketed mode.

The 100 s threshold selects between them automatically: tail at 1m uses the raw buffer; tail at 5m or longer uses the accumulator. Both paths are already in production via Step 11. No changes to the live-tail subsystem are required.

`commitAndDrain` and `mergeTrendData` continue to operate as today; the merge logic forks on the data shape, which is now uniformly derived from the dispatch rule.

---

## 7. Performance Considerations

### 7.1 Empirical validation (2026-05-15)

Both paths measured with `EXPLAIN (ANALYZE, BUFFERS)` against production-state `tag_samples` data. One tile of a 15m visible window (7.5min span, 8 tags, 500 buckets per tile, 0.9 s bucket width), warm cache, active write chunk (uncompressed live-edge tier).

| Metric | Q1 (current raw COV) | Q2 (proposed bucketed) | Delta |
|---|---:|---:|---:|
| Planning Time | 21.1 ms | 1.8 ms (warm) | Q1 +19 ms slower |
| Execution Time | 53.5 ms | 46.8 ms | Q1 +7 ms slower |
| **Total** | **74.6 ms** | **48.7 ms** | **Q1 35% slower** |
| Heap buffer hits | 20,822 | 20,862 | Essentially identical |
| Rows scanned from heap | 20,629 | 20,654 | Essentially identical |
| Rows returned to client | 20,629 | 4,008 | Q2 5.1× fewer |
| Row width on wire | 28 bytes | 44 bytes | Q2 wider per row |
| Approx wire bytes | ~578 KB | ~176 KB | **Q2 3.3× smaller** |

**Key findings:**

1. **Heap I/O is identical.** Both queries hit the same chunks via the same `(tag_id, ts)` index. The "uncompressed-tile / heap-scatter cliff" concern from earlier drafts of this proposal is **disproven** — there is no cliff to avoid.

2. **Aggregation is a net optimization, not a cost.** Q2's `GroupAggregate` reduces 20,654 rows to 2,524 before downstream nodes process them; Q1 carries all 20,629 rows through every node. The aggregation work (~7 ms) is more than offset by reduced materialization/sort/output cost on the smaller dataset.

3. **Production activity rate measured: ~5.7 Hz per tag** (20,654 rows / 8 tags / 450 sec). This is well above the "low activity" regime, and below the worst-case 10 Hz assumption. The bucketed path's wire-size bound is most valuable exactly at this activity rate.

4. **Total user-perceived latency improvement** combines DB-side savings (~26 ms) with client-side savings (5.1× fewer points to JSON-parse, materialize, and render through uPlot). At 20k→4k row reduction, client-side savings are typically 50–200 ms. Expected end-to-end improvement: **80–225 ms per render at this activity level**, directly addressing the currently-observed slowness at 5m/15m presets.

5. **Cold-plan-cache shows ~30 ms planning** on first execution (warm drops to ~2 ms). Both paths share this characteristic; not proposal-specific.

### 7.2 Bounded payload

The rule caps per-tag points per window at `max(window_s × 10, 1000)`. Above 100 s, payload is flat at 1,000 bucketed rows. Below 100 s, payload is bounded by actual COV activity at ≤ 1,000 samples.

| Regime | Worst-case points/tag/window | Numbers/tag (cols × rows) |
|---|---:|---:|
| Raw COV (< 100 s) | ≤ 1,000 | ≤ 2,000 (ts + value) |
| Bucketed (≥ 100 s) | 1,000 | 4,000 (ts + value + min + max) plus `null_count` |

`null_count` is small-integer and gzip-friendly.

### 7.3 Over-bucketing at low actual activity

A 1-change-per-minute setpoint over a 15 m window produces ~15 real samples (~30 bytes raw). The bucketed path emits 1,000 mostly-LOCF-filled rows. HTTP gzip absorbs most of the repetition on the wire, but the browser working set is larger than necessary at idle.

This is the cost of using worst-case rate as the dispatch input rather than an estimator. Acceptable trade-off given the bounded-payload and uniform-shape benefits.

### 7.4 Loss of sub-bucket COV timestamps

A spike at 12:34:56.473 becomes `{ ts: 12:34:56.4, max: spike_value }` in a 5m bucketed view (300 ms buckets). Value preserved in `max`; sub-bucket ms-precision is gone.

**Not user-perceptible at chart resolution.** At a typical ~1200 px chart width, 1 pixel ≈ 250 ms at 5m. The cursor can resolve to ~1 pixel, i.e., ~250 ms — already coarser than the proposed bucket width (300 ms). The "1 ms exact timestamp" precision today is data the operator cannot access through the UI; reading the cursor display, the answer is pixel-bounded regardless of source-data precision.

Forensic / CSV-export workflows that need exact COV timestamps for post-processing remain available via:
- Drag-zoom to a window < 100 s (returns raw COV automatically).
- 1m preset (60 s window, always returns raw COV).
- Future dedicated raw-export endpoint if a real need emerges.

---

## 8. Implementation Surface

Estimated work:

| Component | Change |
|---|---|
| `packages/db/timescale/trends.ts` | Add `tag_samples` source-table variant to the existing aggregate template. Add the dispatch inequality in `getTrendTile` before the `bucket_s` switch. |
| `packages/trend-chart/src/level.ts` | Update `deriveBucketSMs` / dispatch helpers to consult the new threshold. |
| `packages/trend-chart/src/api.ts` | No change (response shape is already discriminated). |
| `packages/trend-chart/src/useTrendData.ts` | No change (response decoder already handles both shapes). |
| `packages/trend-chart/src/useLiveSubscription.ts` | No change (both paths already implemented). |
| `packages/trend-chart/src/mergeTrendData.ts` | No change (already forks on shape). |
| `apps/caro-hmi/server/...` | No change. |
| **Migrations** | None — no schema or CAG changes. |
| **Tests** | New unit tests for the dispatch inequality. New integration test for the raw-source bucketed SQL path. Update preset routing tests in `level.test.ts`. |

Net code delta: a handful of lines plus the new SQL template. No new infrastructure.

---

## 9. Considered and Rejected: `aggregate=raw` Override Flag

Earlier drafts proposed an optional `aggregate=raw` parameter on `getTrendTile` to let callers force raw COV on windows the §4.1 inequality would dispatch as bucketed. Use case: forensic / diagnostic workflows needing exact sub-bucket COV timestamps on 5m or 15m views.

**Rejected** because the natural zoom-in workflow already covers it. An operator who needs exact sample timestamps drag-zooms or clicks the 1m preset; the resulting window is below the 100 s threshold and automatically returns raw COV. Adding an override creates a parallel path to the same outcome with extra API surface, UI control decisions (toggle placement, persistence in saved views, mid-tail toggle behavior), and clutter for a workflow operators already have.

A non-viewer API consumer (analytics script, headless export) wanting raw data over a long range would need to issue multiple short-window requests and stitch — acceptable trade-off. Speculative tooling can add a dedicated endpoint when a real need surfaces.

---

## 10. Open Items Before Shipping

Perf gate retired (§7.1 measured and passed). Remaining items are operational watchlist or implementation polish, not shipping blockers.

1. **Tail-mode transition test (low risk, easy add).** Confirm `useLiveSubscription.commitAndDrain` cleanly transitions a tail at 5m (bucket accumulator) to a fixed-mode refetch (raw-source bucketed) without rendering gaps. Existing test coverage exercises the aggregate path against CAGs; a new test should cover the raw-source case. Bundle with the implementation PR.

2. **Multi-tag pool sizing (already a watchlist item).** A 16-tag chart at 5m or 15m produces `visibleTilesPerWindow × ⌈N/8⌉` = 4 parallel queries against the raw hypertable. Pool ceiling currently at 10; tracked in `platform_todo.md` as "Pool sizing watchlist." Empirical perf-page testing has not surfaced pool exhaustion as a bottleneck; bump to 20–30 only if observed in multi-operator load.

3. **NULL `prev` rate monitoring (already a watchlist item).** Tracked in `platform_todo.md`. Extending the raw-source bucketed path to 5m / 15m increases the surface area where a NULL `prev` would render as a visible flat start, so monitoring becomes more useful (not strictly required).

4. **`SAMPLE_RATE_HZ` default value (10).** Hardcoded in the implementation. Fine for current device population; if future modules publish at meaningfully different rates, the constant becomes per-deployment configuration. Defer until needed.

---

## 11. Decision Log

| Decision | Rationale |
|---|---|
| Single inequality dispatch | Removes the dual-axis rule. Deterministic from window size alone. Cleanly handles custom zoom. |
| Worst-case 10 Hz assumption | No estimator, no probe, no UI flag. Trades over-bucketing at low activity for a closed-form rule. |
| Same TimescaleDB functions | No new server-side aggregation code. The CAGs are themselves pre-materialized instances of the same pattern; running it against raw at query time is just a source-table swap. |
| Keep existing CAG dispatch unchanged | All windows ≥ 16 min already route correctly. No reason to revisit. |
| Add raw-source bucketed path only | Adds one SQL template. No new CAG materialization, no new compression policy, no new retention. |
| Crossover at 100 s | Falls out of `window_s × 10 = bucketsPerWindow`. Not tuned; defined by geometry. |
| No `aggregate=raw` override | Considered as a diagnostic escape hatch. Rejected — operators already drill into precision via drag-zoom or the 1m preset (windows < 100 s automatically return raw COV). Adding the override creates parallel UI/API surface for a workflow that's already available. See §9. |
| No estimator-based dispatch | Considered (Option 2 in design discussion). Adds state and edge cases for marginal benefit over the static rule. |
| No probe-then-dispatch | Considered (Option 1). 2× round-trip cost not justified at this dispatch resolution. |
| No speculative parallel | Considered (Option 3). Wastes 50% of DB cycles, requires pool resize before viability. |
| No universal bucketed (delete raw) | Considered (Option 4). Loses 1m raw-COV use case for diagnostic precision. Keeping the 1m raw band is cheap; deleting it has no architectural benefit. |
| Skip the additional perf gate before shipping | EXPLAIN ANALYZE on production-state data (2026-05-15) showed Q2 bucketed is 35% faster on the DB side and 3.3× smaller on the wire vs Q1 raw COV at production activity (~5.7 Hz). The "heap-scatter cliff on uncompressed live-edge" concern is disproven — heap I/O is identical between paths. Re-measuring the same regime is unnecessary. |

---

## 12. Out of Scope

- New CAG layers (e.g., sub-second). Not needed for the current rule. Possible future work if 5m / 15m perf gate fails on uncompressed tiles.
- Per-tag sample-rate classes. Worst-case 10 Hz is the deployment-wide assumption; per-tag tuning would only matter if the dispatch is later upgraded to an estimator.
- Changing `bucketCount` or `visibleTilesPerWindow`. Geometry constants stay at 500 / 2. The crossover threshold scales linearly with `bucketsPerWindow`; reasonable future adjustments don't change the architecture.
- Changes to the live-tail WS channel, FIFO discipline, or `commitAndDrain` semantics. All existing.

---

## 13. References

- `Docs/CARO_DB_Spec.md` §9 — formal schema, `getTrendTile` entry point.
- `Docs/CARO_Trending_Reference.md` — write-path operational narrative.
- `Docs/hmi_trend_viewer_spec.md` — trend viewer functional spec.
- `Docs/hmi_trend_viewer_handoff.md` — Phase A Steps 1–11 implementation handoff; divergences list.
- `Docs/DB_Config_Usage_And_Perf.md` — performance validation, dispatch rule, gate results.
