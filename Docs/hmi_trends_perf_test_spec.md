# CARO HMI — Trends API Performance Test Page Specification

**Revision History**

| Date | Note |
|---|---|
| 2026-04-29 | Initial markdown version. Wire contract aligned to hmi_trend_viewer_spec v0.5+ (start_time/end_time/bucket_count). PDF design doc was the original source. |

---

## 1. Purpose

The Trends API Performance Test page (`/dev/trends-perf`) is a developer-facing measurement tool that sweeps all nine CAG dispatch zones and reports client-observed wall-clock latency for each. It exists to:

- Validate that each dispatch zone returns results within acceptable bounds before production rollout.
- Provide the empirical data needed for the pool-sizing decision (spec §15, deferred to Phase B).
- Supersede the one-shot EXPLAIN-plan gate (spec §5.5, deferred to Phase B) as the primary Phase A performance gate.
- Produce a shareable run-stamp line that can be pasted directly into a `Docs/perf/` markdown log.

This is **not** a chart rendering page. No uPlot, no time-series plots, no export. It is a table of numbers.

---

## 2. Access

Route: `#dev-trends-perf` (hash-based navigation, matching the existing HMI shell router pattern).

Navigation: The route appears as **"Dev: Trends Perf"** at the bottom of the left sidebar `NavTree`. No authentication gate — the HMI is already dev-mode-only.

---

## 3. Preconditions

- Trends API at v0.7+ with full test coverage.
- HMI server reachable on port 3003; Vite dev server proxying `/api` to port 3003.
- At least one trendable tag writing live data (for the Live column).
- Timescale DB reachable (for extent query and tile fetches).

---

## 4. DB Dependency: `getTrendExtent()`

New function in `packages/db/timescale/trends.ts`:

```typescript
export async function getTrendExtent(): Promise<{
  oldestMs: bigint | null;
  newestMs: bigint | null;
}>;
```

SQL:
```sql
SELECT (extract(epoch from min(ts)) * 1000)::bigint AS oldest_ms,
       (extract(epoch from max(ts)) * 1000)::bigint AS newest_ms
FROM tag_samples;
```

TimescaleDB resolves `min`/`max` via chunk metadata — no full scan.

Returns `{ oldestMs: null, newestMs: null }` when the hypertable is empty.

Exported from `packages/db/index.ts` alongside existing trends exports.

---

## 5. REST Endpoint: `GET /api/v1/trends/extent`

Added to `apps/caro-hmi/server/src/routes/trends.ts` alongside the existing `/tile` handler.

No query parameters.

Response envelope:
```json
{
  "ok": true,
  "data": {
    "oldestTs": 1745000000000,
    "newestTs": 1777489680000
  }
}
```

Both fields are `number | null`. BigInt → Number conversion happens at the wire boundary (same pattern as `serializeTile()`). `null` stays `null`.

No new error codes; standard 5xx via existing error-handler middleware on DB failure.

---

## 6. REST Endpoint: `GET /api/v1/tags/trendable`

Added to `apps/caro-hmi/server/src/routes/tags.ts`.

No query parameters.

Response envelope:
```json
{
  "ok": true,
  "data": {
    "tags": [
      { "tag_id": 101, "tag_path": "Beam_Current.Gun.Current" },
      ...
    ]
  }
}
```

The server already builds `trendableTagIds: Set<number>` at startup in `loadTagMap()`. The new endpoint filters `tagMap` by that set and returns `{ tag_id, tag_path }` pairs.

Signature change: `createTagsRouter(tagMap, cmdController, trendableTagIds)` — `trendableTagIds` added as third parameter, threaded through `createApp()` and `index.ts`.

---

## 7. Row Definitions

The page sweeps nine dispatch zones. `bucketS` is the per-bucket duration in seconds:

| Row | bucket_s | CAG | Div | window (pointsPerWindow=1000) |
|---|---|---|---|---|
| Raw | 0.5 | tag_samples | — | 500 s |
| 1s CAG, Div=1 | 1 | 1s_cagg | 1 | 1000 s |
| 1s CAG, Div=8 | 8 | 1s_cagg | 8 | ≈2.2 h |
| 10s CAG, Div=1 | 10 | 10s_cagg | 1 | ≈2.8 h |
| 10s CAG, Div=8 | 80 | 10s_cagg | 8 | ≈22.2 h |
| 1min CAG, Div=1 | 60 | 1min_cagg | 1 | ≈16.7 h |
| 1min CAG, Div=8 | 480 | 1min_cagg | 8 | ≈5.6 d |
| 10min CAG, Div=1 | 600 | 10min_cagg | 1 | ≈6.9 d |
| 10min CAG, Div=8 | 4800 | 10min_cagg | 8 | ≈55.6 d |

Div = `bucketS / CAG_bucket_s` (e.g., bucketS=8 against 1s CAG = Div 8).

---

## 8. Inputs

| Input | Default | Constraints |
|---|---|---|
| `pointsPerTile` | 250 | positive integer; warn if ≠ 250 (client policy) |
| `pointsPerWindow` | 1000 | positive integer ≥ `pointsPerTile` |
| `tagCount` | 8 | integer in [1, tagList.length] |

Computed labels (displayed below inputs):
- `n_tiles = ceil(pointsPerWindow / pointsPerTile)`
- `n_tag_groups = ceil(tagCount / 8)`
- `reqs/cell = n_tiles × n_tag_groups`

DB Extent is displayed as ISO strings from the `GET /api/v1/trends/extent` response.

---

## 9. Tile Window Math

Wire contract: v0.5+ `?tag_ids=&start_time=&end_time=&bucket_count=`. No `bucket_s` or `tile_index` on the wire.

```
tileSpanMs = bucketS * pointsPerTile * 1000
windowMs   = nTiles * tileSpanMs
```

**Live windows** (exercises watermark fall-through):
```
lastTileIndex = floor(nowMs / tileSpanMs)
tile[i] = [i * tileSpanMs, (i+1) * tileSpanMs)
          for i in [lastTileIndex - nTiles + 1 .. lastTileIndex]
```

**Historical windows** (strictly past the watermark region):
```
earliestEnd = oldestMs + windowMs
latestEnd   = newestMs - 3_600_000    // 1-hour exclusion
if latestEnd <= earliestEnd → insufficientHistory
rangeEnd    = random in [earliestEnd, latestEnd]
rangeStart  = rangeEnd - windowMs
firstIdx    = floor(rangeStart / tileSpanMs)
tile[i]     = [i * tileSpanMs, (i+1) * tileSpanMs)
              for i in [firstIdx .. firstIdx + nTiles - 1]
```

Tile boundary values are rounded to nearest integer millisecond before converting to `BigInt` for the URL.

---

## 10. Measurement

**`measureCell(tileWindows, tagIds, pointsPerTile)`**

1. Split `tagIds` into groups of ≤ 8 (server N cap).
2. For each `(tileWindow, tagGroup)` pair, call `timedFetch()`.
3. `Promise.all` all requests concurrently.
4. Wall-clock the enclosing Promise.
5. Return `{ totalMs, n, slowestMs, fastestMs }` on success; `{ error: code }` on first fetch failure.

`timedFetch` times `fetch()` + `JSON.parse()` (both contribute to user-observable latency). Throws on non-2xx, passing the error envelope code to `measureCell`.

**Sweep order:** Sequential across rows; within each row, live cell first, then historical. Results appear as the table fills in — the operator sees progress in real time.

---

## 11. Cell Display States

| State | Display |
|---|---|
| idle | `—` (grey) |
| running | `⋯` (blue) |
| done | `Xms` bold + secondary line: `N reqs · slow Xms · fast Yms` |
| error | error code (red) |
| insufficientHistory | `n/a — insufficient history` (grey, historical column only) |

---

## 12. Run Stamp

When any cell has completed, a selectable single-line summary appears above the table:

```
Run @ <ISO timestamp> · git=<VITE_GIT_SHA or "unknown"> · extent=<iso oldest> → <iso newest> · n_tiles=<n> · n_tag_groups=<n> · tag_count=<N>
```

`VITE_GIT_SHA` is an optional Vite build-time env injection. If absent (no build step added), the stamp shows `git=unknown`. The stamp is `user-select: all` so the operator can copy-paste it directly into a `Docs/perf/` markdown log entry.

---

## 13. Test Coverage

### Server (unit, mocked)
- `GET /api/v1/trends/extent` — 200 with numeric fields, 200 with null fields, 500 on DB failure.

### `@caro/db` (integration, guarded by `TIMESCALE_HOST`)
- `getTrendExtent` returns non-null bigints with `oldestMs ≤ newestMs` when table has data.

### Client (pure-function unit tests, no DOM)
- `formatDuration`: table-driven across all 9 row window values.
- `computeLiveTileWindows`: count, consecutiveness, span, last-window covers `nowMs`.
- `computeHistoricalTileWindows`: `insufficientHistory` case, valid window count, consecutiveness, bounds.

---

## 14. What This Step Is Not

- Not chart rendering (no uPlot).
- Not cross-run aggregation, persistence, or CSV export.
- Not any change to the existing `/tile` handler or `getTrendTile()`.
- Not Step 7 (`packages/trend-chart/`) — this page is self-contained and comes first.
