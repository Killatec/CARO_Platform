# Trends Min/Max Band Upgrade

**Status:** Specified, not yet implemented
**Author:** Pablo + Claude (design conversation 2026-05-04)
**Branch target:** `feature/trends-min-max-bands` → `dev`
**Wire contract version:** v0.7 → v0.8 (additive, backward-compatible)

---

## 1. Purpose

Extend the aggregate trend tile response to carry per-bucket `min` and `max` arrays alongside the existing `value` (LOCF-filled `last`) array. This is the storage-side groundwork for rendering min/max bands on the trend chart. The CAG storage layer has materialized `min` and `max` columns since migrations T006–T009 specifically to enable this without a re-migration; this upgrade exposes them through the read path.

The raw path (`bucketS < 1.0`) is untouched — raw responses are COV samples with no bucket aggregation, so min/max do not apply.

---

## 2. Design Decisions

### 2.1 Three-Case Bucket Rule

The read layer classifies every bucket into one of three cases using the discriminator pair `(bucket_min, null_count)`:

| `null_count` | `bucket_min` | Case | Wire (`value`, `min`, `max`) | Renders as |
|---|---|---|---|---|
| `> 0` | (any) | **Mixed-null bucket** | `null, null, null` | Band gap |
| `0` | `not null` | **Normal bucket** (measured spread) | `last, bucket_min, bucket_max` | Band from min to max |
| `0` | `null` | **Empty bucket** (gapfilled, no source rows) | `LOCF'd last × 3` | Line (band collapsed) |

### 2.2 Why "empty bucket → collapse to last," not "carry forward last min/max"

The platform's writer is COV with a 60s snapshot floor and explicit watchdog nulls on telemetry loss. Therefore an empty bucket carries a strong contract: **the value provably did not change during this bucket.** Not "we don't know"; not "the previous variance continued." Min and max for an empty bucket equal the constant value, which is the LOCF'd `last`.

Rejected alternatives:

- **LOCF min and max independently.** Would carry the previous bucket's measured spread into empty buckets, asserting variance that COV explicitly tells us did not occur.
- **Leave min and max null in empty buckets.** Would create band gaps in regions that are guaranteed flat under COV semantics — visually dishonest in the opposite direction.

### 2.3 Null-as-Gap Contract is Preserved

Mixed-null buckets emit all three fields as null, exactly as the current `value`-only rule does. The band gaps when the line gaps. No coordination is required between the wire null and the render layer beyond what already exists for `value`.

### 2.4 LOCF Applies to `last` Only

In SQL, `last` keeps its `locf(..., prev => ...)` wrapper (carrying the line forward across empty buckets). `min` and `max` use plain `last(s.min, s.bucket)` / `last(s.max, s.bucket)` with **no** LOCF wrapper, so empty buckets surface as NULL and the JS post-pass can distinguish real-with-spread from gapfilled.

The "empty bucket → min/max = LOCF'd last" collapse happens in JS, not in SQL, because it's tied to the same `null_count` post-pass that already enforces null-as-gap. Keeping all three rules in one place keeps the semantics auditable.

### 2.5 Raw Path Unchanged

`getTrendTile()` for `bucketS < 1.0` returns COV samples (`ts`, `value`). No buckets, no aggregation, no min/max. The discriminated-union response keeps a clean split between raw and aggregate shapes.

---

## 3. Wire Contract (v0.8)

### 3.1 Aggregate Response — Before (v0.7)

```jsonc
{
  "ok": true,
  "data": {
    "source": "1s_cagg",
    "startTime": 1776864000000,
    "endTime":   1776864480000,
    "bucketSMs": 1920,
    "n": 250,
    "series": [
      { "tagId": 42, "value": [1.9, 1.8, null, 2.0, 2.0] }
    ]
  }
}
```

### 3.2 Aggregate Response — After (v0.8)

```jsonc
{
  "ok": true,
  "data": {
    "source": "1s_cagg",
    "startTime": 1776864000000,
    "endTime":   1776864480000,
    "bucketSMs": 1920,
    "n": 250,
    "series": [
      {
        "tagId": 42,
        "value": [1.9, 1.8, null, 2.0, 2.0],
        "min":   [1.7, 1.6, null, 2.0, 2.0],
        "max":   [2.1, 1.9, null, 2.0, 2.0]
      }
    ]
  }
}
```

`min[i]` and `max[i]` are aligned 1:1 with `value[i]`. All three arrays have length `n`. Nulls are at the same indices in all three. For empty buckets, `min[i] === max[i] === value[i]`.

### 3.3 Raw Response — Unchanged

Raw response is unchanged. No `min` or `max` fields on raw series.

### 3.4 Backward Compatibility

The change is purely additive: existing clients that only read `series[].value` continue to work. The spec already calls this out (§6.5: "The response shape is extensible — additional optional fields per series do not break existing clients").

No version negotiation, feature flag, or query-param toggle. v0.8 is a strict superset of v0.7. Bump the version in the spec and the handoff status line.

---

## 4. Implementation — File-by-File

### 4.1 `packages/db/timescale/trends.ts`

#### 4.1.1 SQL — CAG branch (`querySegment`, around line 270)

Add `bucket_min` and `bucket_max` to the `WITH gapfilled` SELECT, propagate through the outer past-extent CASE:

```sql
WITH gapfilled AS (
  SELECT s.tag_id,
         time_bucket_gapfill(
           make_interval(secs => $1::float8),
           s.bucket,
           to_timestamp($2::bigint / 1000.0),
           to_timestamp($3::bigint / 1000.0)
         ) AS gf_bucket,
         locf(
           last(s.last, s.bucket),
           prev => (SELECT last FROM ${source}
                     WHERE tag_id = s.tag_id
                       AND bucket <  to_timestamp($2::bigint / 1000.0)
                       AND bucket >= to_timestamp($2::bigint / 1000.0) - INTERVAL '5 minutes'
                     ORDER BY bucket DESC
                     LIMIT 1)
         ) AS val,
         last(s.min, s.bucket) AS bucket_min,
         last(s.max, s.bucket) AS bucket_max,
         sum(s.null_count) AS bucket_null_count
  FROM ${source} s
  WHERE s.tag_id = ANY($4::int[])
    AND s.bucket >= to_timestamp($2::bigint / 1000.0)
    AND s.bucket <  to_timestamp($3::bigint / 1000.0)
  GROUP BY s.tag_id, gf_bucket
)
SELECT tag_id,
       gf_bucket,
       CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE val        END AS val,
       CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_min END AS bucket_min,
       CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_max END AS bucket_max,
       bucket_null_count
FROM gapfilled
ORDER BY tag_id, gf_bucket
```

Key points:
- `last(s.min, s.bucket)` — no `locf()` wrapper. Empty buckets stay NULL.
- The past-extent cutoff CASE applies to all three (`val`, `bucket_min`, `bucket_max`).
- The bounded `prev` correlated subquery is unchanged — only `last` needs LOCF carry-back. `min` and `max` for empty leading-edge buckets fall under the "empty bucket → collapse to LOCF'd last" rule, handled in the JS post-pass.

#### 4.1.2 SQL — Raw-as-aggregate branch (same function, around line 235)

Add inline aggregates. SQL `min(value)` / `max(value)` natively skip NULLs, which is the right behaviour — `null_count` separately captures null presence and the JS post-pass converts that to a band gap.

```sql
WITH gapfilled AS (
  SELECT s.tag_id,
         time_bucket_gapfill(
           make_interval(secs => $1::float8),
           s.ts,
           to_timestamp($2::bigint / 1000.0),
           to_timestamp($3::bigint / 1000.0)
         ) AS gf_bucket,
         locf(
           last(s.value, s.ts),
           prev => (SELECT value FROM tag_samples
                     WHERE tag_id = s.tag_id
                       AND ts <  to_timestamp($2::bigint / 1000.0)
                       AND ts >= to_timestamp($2::bigint / 1000.0) - INTERVAL '5 minutes'
                     ORDER BY ts DESC
                     LIMIT 1)
         ) AS val,
         min(s.value) AS bucket_min,
         max(s.value) AS bucket_max,
         count(*) FILTER (WHERE s.value IS NULL) AS bucket_null_count
  FROM tag_samples s
  WHERE s.tag_id = ANY($4::int[])
    AND s.ts >= to_timestamp($2::bigint / 1000.0)
    AND s.ts <  to_timestamp($3::bigint / 1000.0)
  GROUP BY s.tag_id, gf_bucket
)
SELECT tag_id,
       gf_bucket,
       CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE val        END AS val,
       CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_min END AS bucket_min,
       CASE WHEN gf_bucket > to_timestamp($5::bigint / 1000.0) THEN NULL ELSE bucket_max END AS bucket_max,
       bucket_null_count
FROM gapfilled
ORDER BY tag_id, gf_bucket
```

#### 4.1.3 `AggRow` type (around line 206)

```ts
type AggRow = {
  tag_id: number;
  gf_bucket: Date;
  val: number | null;
  bucket_min: number | null;
  bucket_max: number | null;
  bucket_null_count: string | number | null;
};
```

#### 4.1.4 `SegmentResult` (around line 197)

```ts
interface SegmentResult {
  servedStart: number;
  servedEnd: number;
  n: number;
  valuesByTag: Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>;
}
```

#### 4.1.5 JS post-pass — the three-case rule (replaces lines 314–329)

```ts
const valuesByTag = new Map<number, {
  value: (number | null)[];
  min:   (number | null)[];
  max:   (number | null)[];
}>();
for (const id of tagIds) valuesByTag.set(id, { value: [], min: [], max: [] });

let firstBucketMs: number | null = null;
let lastBucketMs:  number | null = null;

for (const row of result.rows as AggRow[]) {
  const arrs = valuesByTag.get(row.tag_id);
  if (!arrs) continue;
  const bucketMs = row.gf_bucket.getTime();
  if (firstBucketMs === null || bucketMs < firstBucketMs) firstBucketMs = bucketMs;
  if (lastBucketMs  === null || bucketMs > lastBucketMs)  lastBucketMs  = bucketMs;

  const nullCount = row.bucket_null_count != null ? Number(row.bucket_null_count) : 0;

  if (nullCount > 0) {
    // Mixed-null bucket — null-as-gap rule.
    arrs.value.push(null);
    arrs.min.push(null);
    arrs.max.push(null);
  } else if (row.bucket_min === null) {
    // Empty (gapfilled) bucket — COV semantics: value held constant.
    // Band collapses to the LOCF'd last. May itself be null at the leading
    // edge if the bounded `prev` lookup returned NULL; that's correct.
    arrs.value.push(row.val);
    arrs.min.push(row.val);
    arrs.max.push(row.val);
  } else {
    // Normal bucket — measured spread.
    arrs.value.push(row.val);
    arrs.min.push(row.bucket_min);
    arrs.max.push(row.bucket_max);
  }
}
```

The all-absent fallback (around line 358) needs updating to fill all three arrays with null × n. The n-mismatch invariant check should validate `arrs.value.length === n` (the three arrays are built in lockstep, so checking one suffices).

#### 4.1.6 Public type — `AggregateTrendSeries` (line 13)

```ts
export interface AggregateTrendSeries {
  tagId: number;
  value: (number | null)[];
  min:   (number | null)[];
  max:   (number | null)[];
}
```

#### 4.1.7 Segment merge (`getTrendTile`, around line 528)

```ts
const series: AggregateTrendSeries[] = tagIds.map(id => {
  const value: (number | null)[] = [];
  const min:   (number | null)[] = [];
  const max:   (number | null)[] = [];
  for (const seg of segments) {
    const segArrs = seg.valuesByTag.get(id);
    if (segArrs) {
      value.push(...segArrs.value);
      min.push(...segArrs.min);
      max.push(...segArrs.max);
    } else {
      value.push(...new Array<number | null>(seg.n).fill(null));
      min.push(...new Array<number | null>(seg.n).fill(null));
      max.push(...new Array<number | null>(seg.n).fill(null));
    }
  }
  return { tagId: id, value, min, max };
});
```

### 4.2 `apps/caro-hmi/server/src/routes/trends.ts`

#### 4.2.1 `serializeTile()` aggregate branch

```ts
return {
  source:    tile.source,
  startTime: Number(tile.startTime),
  endTime:   Number(tile.endTime),
  bucketSMs: tile.bucketSMs,
  n:         tile.n,
  series: tile.series.map(s => ({
    tagId: s.tagId,
    value: s.value,
    min:   s.min,
    max:   s.max,
  })),
};
```

Raw branch unchanged.

### 4.3 `packages/trend-chart/src/api.ts`

`TileApiResponse` aggregate variant gains `min` and `max`:

```ts
| {
    source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'mixed';
    startTime: number;
    endTime: number;
    bucketSMs: number;
    n: number;
    series: Array<{
      tagId: number;
      value: (number | null)[];
      min:   (number | null)[];
      max:   (number | null)[];
    }>;
  };
```

### 4.4 `packages/trend-chart/src/types.ts`

`AggregateSeriesData.series` becomes a Map of structs:

```ts
export interface AggregateSeriesData {
  type: 'aggregate';
  source: '1s_cagg' | '10s_cagg' | '1min_cagg' | '10min_cagg' | 'mixed';
  startTime: bigint;
  endTime: bigint;
  n: number;
  bucketSMs: number;
  series: Map<number, {
    value: (number | null)[];
    min:   (number | null)[];
    max:   (number | null)[];
  }>;
}
```

### 4.5 `packages/trend-chart/src/useTrendData.ts`

#### 4.5.1 `CachedEntry`

```ts
interface CachedEntry {
  source: TileSource;
  // Aggregate fields
  bucketSMs?: number;
  n?: number;
  value?:    (number | null)[];
  min?:      (number | null)[];
  max?:      (number | null)[];
  // Raw fields
  ts?:       bigint[];
  valueRaw?: (number | null)[];
}
```

#### 4.5.2 `estimateCachedEntrySize()`

Aggregate entries now carry roughly 3× the per-bucket payload (value + min + max). Update the size estimate so the LRU cap is honoured:

```ts
function estimateCachedEntrySize(entry: CachedEntry): number {
  const valueLen = entry.value?.length ?? 0;
  const minLen   = entry.min?.length   ?? 0;
  const maxLen   = entry.max?.length   ?? 0;
  const tsLen    = entry.ts?.length    ?? 0;
  const rawLen   = entry.valueRaw?.length ?? 0;
  return (valueLen + minLen + maxLen + tsLen + rawLen) * 8 + 100;
}
```

The default cache cap stays at 50 MB. With the 3× size growth, the cap now holds ~2M sample-trios vs the previous ~6M values. Acceptable for the trend viewer's working set (8 active tiles × 250 buckets × 8 tags ≈ 16K sample-trios). If perf testing shows pressure, raise `DEFAULT_CACHE_CAPACITY` rather than dropping fields.

#### 4.5.3 `storeTileResult()` aggregate branch

```ts
for (const s of res.series) {
  const key = makeTileCacheKey({
    tagId: s.tagId,
    startTime: tile.startTime,
    endTime:   tile.endTime,
    bucketCount: tile.bucketCount,
  });
  cache.set(key, {
    source:    res.source,
    bucketSMs: res.bucketSMs,
    n:         res.n,
    value:     s.value,
    min:       s.min,
    max:       s.max,
  });
}
```

#### 4.5.4 `assembleData()` aggregate branch

Replace the `Map<number, (number|null)[]>` with `Map<number, { value, min, max }>` and concatenate all three arrays in lockstep across tiles. Mirror the existing per-tile loop — the structure stays identical, only the inner fields multiply.

### 4.6 Render layer — `packages/trend-chart/src/render/`

This is the only step where new design is required. The data flow above is mechanical; how to render the band is a uPlot integration choice.

Two viable approaches; pick one in a separate design pass before implementing:

1. **Two extra series per tag, drawn first** — register `min` and `max` as auxiliary uPlot series with `points: { show: false }`, fill region between them with a translucent variant of the tag colour, then draw the main `value` series on top. Pros: uses uPlot's existing series machinery; minimal custom code. Cons: triples the series count, which may bump uPlot redraw cost.

2. **Custom paths builder** — implement a single `paths` function per tag that draws fill + stroke in one pass. Pros: O(1) series per tag, tightest perf. Cons: more code; loses some uPlot tooltip/legend automation.

Recommend (1) for the first pass — gate on perf measurements before considering (2).

Helper function to add (`render/seriesFromTrendData.ts` or a new sibling file):

```ts
export interface BandArrays {
  /** xs in seconds (uPlot convention). Empty for raw. */
  xs: number[];
  /** Per-tag min arrays, same length as xs, in tagIds order. */
  mins: Array<(number | null)[]>;
  /** Per-tag max arrays, same length as xs, in tagIds order. */
  maxs: Array<(number | null)[]>;
}

/**
 * Returns null for the raw path (no bands on COV samples).
 * For aggregate, xs match seriesFromTrendData() exactly so the band traces
 * align with the line trace.
 */
export function bandsFromTrendData(data: TrendData, tagIds: number[]): BandArrays | null;
```

Existing `seriesFromTrendData()` is unchanged — band data is consumed alongside line data, not in place of it.

---

## 5. Test Plan

### 5.1 `packages/db/__tests__/timescale/trends.test.ts`

Extend with explicit cases per the three-case rule. Use the existing `trends-test-range.ts` sandbox helpers (`writeTestSamples`, `refreshTestCagg`).

Required cases (per CAG and per raw-as-aggregate):

1. **Normal bucket — measured spread.** Write samples `[1.0, 3.0, 2.0]` into one bucket. Refresh CAG. Read the tile. Assert `value === 2.0` (last), `min === 1.0`, `max === 3.0`.
2. **Normal bucket — single sample.** Write `[5.0]`. Assert `value === min === max === 5.0` (degenerate band — line render).
3. **Empty bucket — collapse to LOCF.** Write a normal bucket at T0, leave T0+1 through T0+5 empty. Assert empty buckets have `value === min === max === <T0's last>`.
4. **Mixed-null bucket — band gap.** Write `[1.0, null, 2.0]`. Assert `value === min === max === null`.
5. **Past-extent cutoff.** Query a range extending past `MAX(ts)`. Assert all three fields are null in the past-extent region (not just `value`).
6. **Leading edge with NULL `prev`.** Tag whose first sample lands inside the query window. Assert leading empty buckets are `value === min === max === null` (LOCF returned null).
7. **Watermark fall-through (CAG → finer source → raw).** Existing test scaffolding for `__test_watermarkOverride`; assert min/max stitch correctly across the seam.

Existing tests that assert response shape need updating to expect the new fields.

### 5.2 REST integration test (`apps/caro-hmi/server/__tests__`)

End-to-end: write samples, hit `/api/v1/trends/tile`, decode JSON, assert `series[i]` carries `value`, `min`, `max` arrays of equal length `n`, with the three-case invariants holding.

Add one negative case: raw path response (`bucketS < 1.0`) MUST NOT contain `min`/`max` fields on series — confirms the discriminated union didn't leak.

### 5.3 `packages/trend-chart/__tests__`

- `api.test.ts` — extend `TileApiResponse` round-trip tests.
- `useTrendData.test.ts` — assert `assembleData()` builds the per-tag struct correctly, including across tile boundaries.
- New: `bandsFromTrendData.test.ts` — covers the helper from §4.6.
- Render tests for the band trace (whichever rendering approach is chosen).

### 5.4 Perf gate

Re-run the existing `#dev-trends-perf` sweep across all 9 CAG dispatch zones after the SQL change. Min/max columns are already in the materialized views, so additional cost is two extra `last()` aggregates per row in the gapfill CTE. Expected delta: low single-digit ms per tile. If perf regresses materially, investigate before merging.

---

## 6. Documentation Updates

To be made in the same PR (§17.2 standard delta-file discipline applies — note divergences in `Docs/hmi_trends_deltas.md` during implementation, then propagate at session end).

### 6.1 `Docs/hmi_trend_viewer_spec.md`

- §6.2 Response — replace the v0.7 aggregate example with v0.8.
- §6.5 Shape Decision — rewrite. The "Why Not Include min/max" section becomes "Min/Max Bands — v0.8" describing the three-case rule and the COV rationale. Move the deferred-feature language out.
- §17 — move "Min/max aggregate bands" from the future-work list to the current-feature list. Add the "draw band only, no separate line" rendering note, or "draw band + line" if the chosen approach renders both.

### 6.2 `Docs/platform_handoff.md`

HMI app status line: bump "Trends API v0.7" → "Trends API v0.8 (min/max bands)" and add a sentence about the three-case rule.

### 6.3 `apps/caro-hmi/CLAUDE.md`

Update the "Trends REST Endpoint" row in the Server Architecture table to mention the three-array aggregate response.

Update the "Trends REST wire contract" entry in Key Design Decisions — bump the version reference.

### 6.4 `Docs/CARO_DB_Spec.md`

§9 (TimescaleDB) — note that `getTrendTile()` now returns min/max alongside `last`/`null_count` from the four CAGs.

### 6.5 `Docs/hmi_trends_deltas.md`

One-line entry per change at the time it lands; clear at session end after propagation.

---

## 7. Risk and Edge Cases

### 7.1 Watermark fall-through stitching

`queryRecursive()` doesn't care what columns the per-segment payload contains. The merge step in `getTrendTile()` (§4.1.7) extends to all three arrays in lockstep. Mixed-source tiles (`source: 'mixed'`) carry min/max from each contributing source — no special handling required.

### 7.2 NULL `prev` at the leading edge

When the bounded 5-minute `prev` lookup returns NULL (freshly-created tag, retention edge), `val` is null. Empty buckets with null `val` produce `value === min === max === null` per the §4.1.5 rule. Renders as a band gap until the first in-window real bucket. Already correct.

### 7.3 Raw path leakage

The discriminated union must keep raw responses pure. Code review checklist: any `if (tile.source === 'raw')` branch must NOT touch min/max; any aggregate branch must include all three.

### 7.4 Cache size growth

3× per-bucket bytes shrinks the LRU's effective tile capacity by ~3×. The default 50 MB cap holds the trend viewer's working set comfortably (§4.5.2 math), but consumers configuring smaller caches need to be aware. Document in the trend-chart package README if one exists.

### 7.5 Old clients hitting v0.8 server

Additive change; pre-upgrade clients ignore the new fields. No runtime error, no shape break. Confirmed by re-reading `useTrendData.ts` `assembleData()` — it reads only `value` from cached entries. Clients on v0.7 will continue to plot the line trace correctly without bands.

### 7.6 New clients hitting v0.7 server

If a v0.8 client is deployed before the v0.8 server: `min` and `max` fields are missing → `undefined` reaches the band renderer. Either guard the band layer (`if (entry.min) ...`) or coordinate the rollout server-first. Recommend server-first, since the server change is purely additive and cannot break existing v0.7 clients.

---

## 8. Implementation Order

1. **DB layer** — §4.1 SQL + types + post-pass + tests in `@caro/db`. Self-contained; merge first.
2. **REST layer** — §4.2 serializer + integration test. Server-side complete after this step.
3. **Wire types** — §4.3 client `api.ts` + cache + `assembleData()` + `useTrendData` tests. Client now consumes the data.
4. **Render layer** — §4.6 band rendering (after a separate design pass on uPlot integration approach). Visual feature complete after this step.
5. **Documentation** — §6 spec/handoff/anchor updates. Done at session end per delta-file discipline.

Steps 1–3 ship behind no flag; the band render in step 4 is the user-visible change.

---

## 9. References

- Current implementation: `packages/db/timescale/trends.ts`, `apps/caro-hmi/server/src/routes/trends.ts`, `packages/trend-chart/src/{api,useTrendData,types}.ts`, `packages/trend-chart/src/render/seriesFromTrendData.ts`.
- CAG storage: `db/timescale/migrations/T006_replace_1s_cagg.sql` and T007–T009 (already materialize `min`, `max`).
- Spec sections: `Docs/hmi_trend_viewer_spec.md` §5.3 (writer cadence), §5.4 (null-as-gap), §5.5 (canonical SQL), §6.2 (response), §6.5 (shape decision — currently states bands are deferred; this upgrade revises that), §17 (future work).
- Design conversation: 2026-05-04 — three-case rule + COV-empty-bucket collapse + min/max-not-LOCF'd-in-SQL.
