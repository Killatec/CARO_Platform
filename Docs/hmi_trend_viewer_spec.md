# CARO_HMI Trend Viewer — Design Specification
**Date:** 2026-04-22
**Status:** Design — not yet implemented
**Companion Documents**

CARO_Trending_Reference | hmi_functional_spec | hmi_API_spec | hmi_widget_spec | CARO_DB_Spec | platform_handoff

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 2026-04-21 | PM / Claude | Initial design spec capturing full trend viewer decisions — architecture, API, CAG aggregation, client package structure, UX (tag picker / time range / saved views), cache strategy, mode model, error/loading policy, multi-client behavior, testing strategy, MVP scope. |
| 0.2 | 2026-04-22 | PM / Claude | Aggregation scheme revised to power-of-10 (5 levels: raw, 1s, 10s, 1min, 10min). API endpoint changed to tile-based (`GET /api/v1/trends/tile?tag_ids&bucket_ms&tile_index`). Resolution selection moved server→client. Single DB entry point `getTrendTile()` dispatches internally on `bucketMs`. Phase A drops all CAGs — every non-raw level computed on-the-fly via `time_bucket()` against raw hypertable; CAG migrations deferred until on-the-fly perf is measured and specific levels warrant promotion. Response shape is a discriminated union (raw returns `{ts[], value[]}`; aggregate returns `{tsStart, n, value[]}`). Removed `max_points`, `resolution=auto`, `WINDOW_TOO_LARGE`. |
| 0.3 | 2026-04-22 | PM / Claude | Pre-build design pass resolving nine pending questions. Booleans are first-class traces with default Y-scale `[-0.5, 1.5]` (§8.1.2). Numeric Y-scale defaults to Tag Registry `[engineering_min, engineering_max]`, autoscale fallback (§8.1.1). Units shown on Y axis and legend from Tag Registry `units` field (§8.1.3). Multi-tag batching: one DB round-trip per tile across all requested tag IDs, single-tag exception for tag-add operations (§4.1, §10.4). Per-tile perf observability: always-on client `console.info`, opt-in server `console.info` via `TIMESCALE_LOG_TILE_QUERIES` (§14.7). CAG promotion threshold: p95 > 300 ms at a given `bucket_ms` level, human-in-the-loop decision. Per-tag subscription lifecycle in tailing mode: subscribe-then-fetch on add, immediate unsubscribe on remove, in-flight fetches complete on mode transition (§10.7). Color palette: `schemeTableau10` × 2, theme-agnostic (§8.2). Tooltip timezone: fixed site timezone via `HMI_SITE_TIMEZONE` (§8.5). Test data uses a pre-2000 sandbox window written per-test via `writeTestSamples()`; no monolithic seed file (§16.5). Added recommended Phase A build order with landable checkpoints (§17.1.1). |

---

## 1. Introduction

This document specifies the design of the CARO_HMI Trend Viewer: the operator-facing component for visualizing historical and live time-series data from tags captured in the `tag_samples` TimescaleDB hypertable. It complements `CARO_Trending_Reference.md` (which defines the trending subsystem's storage contract and pipeline) by defining the read side — the REST API, the client package, and the user experience.

The trend viewer is an HMI-level feature, not a SCADA widget. It occupies a dedicated view within the HMI shell and is instantiated once per HMI client session. Operators use it to inspect process behavior over time, compare multiple tags, pan and zoom through history, and watch values update live.

Intended audience: frontend developers implementing the viewer, backend developers implementing the trends API, QA, and reviewers validating the null-as-gap contract end-to-end.

Document owner: Product Manager.

---

## 2. Scope

The trend viewer provides: a single chart displaying up to 20 overlaid traces; live (tailing) and historical (fixed) viewing modes; pan, zoom, and tag selection interactions; a tag picker; quick-preset and custom time range selection; saved views (deferred to Phase B); correct null rendering as visual gaps (never bridged); and multi-client independence.

Out of scope for MVP: saved views, min/max aggregate bands, shared views, mobile/touch optimization, keyboard accessibility polish, CSV export, statistical annotations, threshold overlays, cursor measurement mode, and a second Y axis. These are enumerated in §18 and allocated to later phases.

---

## 3. Technology Stack

Stack choices inherit from the platform (see `platform_handoff.md` §Stack). New dependencies introduced by this feature:

| Component | Technology | Rationale |
|---|---|---|
| Chart rendering | uPlot | Canvas-2D renderer, ~40 KB bundle, handles 20 × high-density traces at 60 fps without React reconciliation overhead. Supports stepped interpolation and `spanGaps: false` which is required for the null-as-gap contract. Lower overhead than Recharts (SVG, re-renders with React) or Chart.js (canvas but heavier and less ergonomic for time-series). |
| Aggregation (Phase A) | TimescaleDB on-the-fly bucketing | `time_bucket()` + `time_bucket_gapfill()` + `locf()` executed per-tile against the raw `tag_samples` hypertable. No materialized views in MVP. Keeps the server surface small and defers CAG operational overhead until measured perf demands it. |
| Aggregation (later) | TimescaleDB continuous aggregates | When a specific level's on-the-fly perf becomes a bottleneck, that level is promoted to a CAG via a Timescale migration. Same `time_bucket_gapfill` + `locf` read semantics; only the underlying source table changes. |

All other layers (Node/Express, WebSocket, `@caro/db`, `@caro/hmi-context`, `@caro/ui`, React/Vite, TypeScript) are reused unchanged.

---

## 4. Architecture

### 4.1 Components

| Component | Location | Role |
|---|---|---|
| Trends REST endpoint | `apps/caro-hmi/server/src/routes/trends.ts` | Serves `GET /api/v1/trends/tile`. Validates `tag_ids`, `bucket_ms`, `tile_index`. Delegates to `getTrendTile()` from `@caro/db`. Returns the standard platform envelope. Stateless — no resolution selection, no window math. |
| SnapshotEmitter | `apps/caro-hmi/server/src/snapshot-emitter.ts` | Periodically enqueues a full LKV snapshot into `DbPipeline`. Runs once per server, 5-minute interval by default. Ensures all trendable tags have at least one sample every snapshot interval regardless of COV activity. |
| `getTrendTile()` | `packages/db/src/timescale/trends.ts` (new file) | Single named function: `getTrendTile(tagIds, bucketMs, tileIndex, tileSpanMs)`. Internal dispatch: `bucketMs === 0` → raw hypertable query; `bucketMs > 0` → on-the-fly `time_bucket()` against raw. When a level is later promoted to a CAG, the dispatch adds a third branch that reads from the CAG for matching `bucketMs` values. **Multi-tag batching:** each invocation is one DB round-trip across all requested tag IDs using `WHERE tag_id = ANY($tagIds)` and `GROUP BY tag_id, bucket`; the server never issues one query per tag. Results are split by `tag_id` into the `series` array. Platform rule forbids raw SQL in apps — all queries live here. |
| `packages/trend-chart/` | New workspace package | Full client-side feature: chart component, data hooks, cache, tag picker, time range bar, legend, saved-views dropdown (Phase B). Owns all window/level math. |

**Phase A migrations:** none beyond `T001_create_tag_samples.sql` (already applied). No CAG migrations in MVP. CAG migrations (`T002+`) land per-level in later phases when measured on-the-fly latency justifies the operational cost.

### 4.2 Request Flow — Historical Fetch (one tile)

```
Client                                           Server                           DB
  │  computes: windowMs → bucketMs → tileSpanMs      │                              │
  │            from/to  → [firstTileIndex, lastTileIndex]                           │
  │                                                  │                              │
  │ GET /api/v1/trends/tile?tag_ids=&bucket_ms=&tile_index=                         │
  ├─────────────────────────────────────────────────▶│                              │
  │                                                  │  dispatch on bucketMs        │
  │                                                  │    0  → queryRaw()           │
  │                                                  │    >0 → queryOnTheFly()      │
  │                                                  ├─── @caro/db.getTrendTile()─▶ │
  │                                                  │◀───────────────rows──────────┤
  │                                                  │  merge null_count>0 → null   │
  │                                                  │  shape response              │
  │  {ok:true, data:{bucketMs, tileIndex,            │                              │
  │   tileSpanMs, tsStart?, n?, series:[...]}}       │                              │
  │◀─────────────────────────────────────────────────┤                              │
```

The client fetches `(lastTileIndex - firstTileIndex + 1)` tiles, plus ±1 tile for overfetch, in parallel. Each request returns exactly one tile.

### 4.3 Request Flow — Live Tail

```
Client (tailing mode)                              Server
  │                                                  │
  │   WS subscribe (existing @caro/hmi-context)      │
  ├─────────────────────────────────────────────────▶│
  │                                                  │
  │                                                  │   LKV update (MQTT or tick)
  │   {tagId, ts, value}  (live value event)         │◀───
  │◀─────────────────────────────────────────────────┤
  │  if ts > responseTailTs: feed                    │
  │  client-side bucket accumulator                  │
```

The WebSocket subscription model is unchanged from `hmi_functional_spec.md` §10.2. Trend live tail reuses `useLiveValue(tagId)` and does not introduce a separate WS channel.

---

## 5. Data Pipeline — Why Gap-Fill, Why Snapshots

### 5.1 Change-of-Value Storage

The trending subsystem stores samples on change of value (COV). A tag that stays at `1.0` for eight hours produces one sample at the start of that period and no further samples until it changes. This is defined in `CARO_Trending_Reference.md` §1.4 as the storage contract.

### 5.2 The Empty-Bucket Problem

Both on-the-fly bucketing (Phase A) and continuous aggregates (later) materialize a row for a bucket only when the underlying query finds at least one sample in that interval. A tag flatlining through a 1-minute bucket — or a 1-hour bucket — produces no row for that bucket. A naive read returns fewer rows than expected, creating apparent gaps where data in fact exists: the tag was simply stable.

Two mechanisms together solve this, and they apply identically to on-the-fly queries and CAG reads — only the source relation differs:

**Gap-fill at read time.** TimescaleDB's `time_bucket_gapfill()` emits one row per requested bucket even when the underlying query returns nothing for that bucket. Combined with `locf()` (last observation carried forward), missing buckets are populated with the last known value. This wraps both `time_bucket()` on the raw hypertable (Phase A on-the-fly path) and later CAG reads (post-promotion path).

**Periodic full snapshots.** `LOCF` needs a prior value to carry forward. If the query window starts during a long flatline with no sample at all, `LOCF` has nothing to carry. Snapshots solve this by guaranteeing at least one sample per tag within any window ≥ 5 minutes.

### 5.3 Decision: Periodic Snapshots at 5-Minute Interval

Snapshots run via `SnapshotEmitter`, a server-side component that iterates the LKV cache on a fixed interval and enqueues every trendable tag's current value through the existing `DbPipeline`. Interval is controlled by `HMI_SNAPSHOT_INTERVAL_MS` (default 300000 = 5 minutes) and gated by `HMI_SNAPSHOT_ENABLED` (default true).

**Rationale for choosing periodic snapshots over alternative approaches:**

- *Force-publish on flatline.* Tracking a per-tag "last written timestamp" and emitting a synthetic sample when it exceeds a threshold is conceptually purer but more complex: requires a per-tag timer or scan, must be reset on every actual write, and introduces a second code path that must be tested. Periodic snapshots are stateless (no per-tag tracking) and require one interval timer.
- *COV purity.* A snapshot is equivalent to a "time-since-last-COV" event and does not violate the COV principle — it simply shortens the maximum interval between samples to a bounded value. Booleans that flatline for hours of operation are common; snapshots ensure the historian always has recent evidence the tag exists.
- *Storage cost.* Negligible. At 5-minute intervals across a few hundred trendable tags, snapshots contribute a few thousand rows per day to a hypertable sized for tens of millions.
- *Interval choice.* 5 minutes bounds LOCF lookback to 5 minutes. A longer interval (e.g., 1 hour) is viable and halves storage again, but increases the worst-case first-pixel latency when opening a long historical window. 5 minutes is a reasonable default; operators may tune via env.

### 5.4 Null-as-Gap Contract

Null sample values indicate bad quality — sensor fault, communication timeout, stale PLC data. They must never be interpolated, smoothed, or bridged. A null marks a boundary: data before the null is valid, data after the null is valid, and the span containing the null is visually empty on the chart.

This contract is preserved at every pipeline stage:

| Stage | Preservation Mechanism |
|---|---|
| Sample write | `tag_samples.value` is `DOUBLE PRECISION NULL`; nulls are stored, not dropped. |
| Bucket aggregation (on-the-fly and CAG) | Each bucket row carries a computed `null_count` (`count(*) FILTER (WHERE value IS NULL)` for on-the-fly; materialized column for CAGs). Both sources expose the same `(last, null_count)` pair per bucket. |
| Read query | Server inspects `null_count`: if `null_count > 0` for a bucket, the bucket's value is emitted as `null` in the response regardless of `last`. |
| API response | `series[].value` is a `(number \| null)[]` array; nulls are inline, not sidelined into a separate array. |
| Client rendering | uPlot is configured with `spanGaps: false`, rendering null as a visual break in the line. |

The decision to merge `hasNull` into the `value` array at the server (rather than returning separate `last[]` and `hasNull[]` arrays) was deliberate: the client never needs to distinguish "value was this but there were nulls" from "value is null." Both render identically. Merging at the server halves the per-series array count in the response and simplifies client code.

---

## 6. API — `GET /api/v1/trends/tile`

### 6.1 Request

```
GET /api/v1/trends/tile
  ?tag_ids=42,87,93           # comma-separated int list, required, max 20
  &bucket_s=1                 # 0 = raw; otherwise bucket size in seconds (level-defined)
  &tile_index=27396           # integer tile index; tsStart = tile_index * tileSpanMs
```

One request = one tile for up to 20 tags. The client selects `bucket_s`, computes `tile_index(es)` for the visible window, and issues one request per tile per batch of tags. Tile span is a function of `bucket_s` and is part of the contract (see §10.2).

No `from`/`to`, no `max_points`, no `resolution=auto`. All window→level→tile math lives on the client.

### 6.2 Response

The response shape is a discriminated union on `bucketS`:

**Raw tile (`bucket_s = 0`):**

```jsonc
{
  "ok": true,
  "data": {
    "bucketS": 0,
    "tileIndex": 27396,
    "tileSpanMs": 3600000,
    "series": [
      { "tagId": 42, "ts": [1776864001234, 1776864003445, ...], "value": [1.9, 1.8, null, ...] },
      { "tagId": 87, "ts": [...],                                "value": [...] }
    ]
  }
}
```

Raw tiles carry per-sample timestamps (COV samples are irregular). `ts[]` and `value[]` are parallel arrays of equal length.

**Aggregate tile (`bucket_s > 0`):**

```jsonc
{
  "ok": true,
  "data": {
    "bucketS": 1,
    "tileIndex": 27396,
    "tileSpanMs": 600000,
    "tsStart": 1776864000000,
    "n": 600,
    "series": [
      { "tagId": 42, "value": [1.9, 1.8, null, 2.0, 2.0, ...] },
      { "tagId": 87, "value": [0.0, 0.0, 0.0, 0.1, ...] }
    ]
  }
}
```

Row count for each `value` array is exactly `n`. Timestamp for bucket index `i` is `tsStart + i * bucketS * 1000`. No per-bucket timestamps are transmitted — this is the primary payload savings at aggregate levels.

Error envelope is the standard platform shape per `platform_handoff.md`:

```jsonc
{ "ok": false, "error": { "code": "INVALID_TAG_IDS", "message": "..." } }
```

Validation errors: `INVALID_TAG_IDS` (empty, > 20, non-integer), `INVALID_BUCKET_S` (not in the allowed set `{0, 1, 10, 60, 600}`), `INVALID_TILE_INDEX` (non-integer or negative).

### 6.3 Level Selection (Client-Side)

Level selection is a pure client-side function of the visible window. The server has no view of the window and performs no level decisions.

| L | Bucket | Window range | Source (Phase A) | Source (later) |
|---|---|---|---|---|
| 0 | COV (raw) | < 3 min | raw hypertable | raw hypertable |
| 1 | 1 s | 3 min – 30 min | on-the-fly from raw | on-the-fly (or CAG if promoted) |
| 2 | 10 s | 30 min – 5 h | on-the-fly from raw | on-the-fly (or CAG if promoted) |
| 3 | 1 min | 5 h – 33 h | on-the-fly from raw | on-the-fly (or CAG if promoted) |
| 4 | 10 min | 33 h – 14 d | on-the-fly from raw | on-the-fly (or CAG if promoted) |

The client targets roughly 500–2400 buckets per visible window. The ranges above are the natural zoom thresholds for a 500-bucket floor at the coarser end of each range and a 2400-bucket ceiling at the finer end. Crossing a threshold triggers a level change; tiles at the new level are fetched and the chart bridges from the old-level tiles until they arrive (see §10.5).

Each bucket size has a fixed tile span (see §10.2), chosen so that one tile contains a uniform bucket count regardless of level. Tile spans are part of the client-server contract, not a query parameter.

### 6.4 Retention Behavior

The server applies **no clamping**. The DB returns whatever data is available for the tile's span — if the tile spans a region older than the 14-day retention horizon, fewer rows come back and gap-fill produces no row for unmaterialized buckets. The client renders missing buckets as a gap — visually identical to any other null region. This keeps the server simple and honest: the response is a function of `(tag_ids, bucket_ms, tile_index)` alone.

The client emits a `console.info` when a tile's `tsStart + tileSpanMs` falls before `now - 14d`, purely for developer visibility.

### 6.5 Shape Decision — Why Not Include min/max/first/count/null_count?

An earlier draft returned six fields per bucket (`last`, `min`, `max`, `first`, `count`, `null_count`). This was trimmed to `value` only for MVP on the grounds that:

- Min/max bands are a Phase B feature. Shipping them in the API before the client renders them bloats the payload for every fetch.
- `first` and `count` have no proposed consumer.
- `null_count` is consumed at the server (to decide whether to emit null) and does not need to reach the client.

Phase B will add `min` and `max` to the aggregate tile response when bands are implemented. The response shape is extensible — additional optional fields per series do not break existing clients.

### 6.6 Max Tag Count

The API caps `tag_ids` at 20. This is a hard limit driven by client UX (20 traces is the visual ceiling for comprehensibility) and a soft limit driven by payload size — 20 × 2400 buckets × 8 bytes ≈ 384 KB per aggregate tile, small enough to fetch on pan but large enough to discourage unbounded fan-out. Raw tiles are bounded by the tile span × expected COV rate; with the 1-hour raw tile span and typical COV rates, payloads stay comparable or smaller than aggregate tiles at L=1.

---

## 7. Client Package Structure

Single workspace package `packages/trend-chart/`. Rationale against splitting into separate data and rendering packages:

- Only one consumer (the trend viewer) exists today. Splitting for speculative reuse is premature abstraction — another `package.json`, another `tsconfig`, another workspace edge, for zero current benefit.
- Internal boundaries already model the split. `cache/` and `hooks/useTrendData.ts` are the data layer; `TrendChart.tsx` and `render/` are the presentation layer. If a second consumer emerges (e.g., a "24h mini-trend" SCADA widget), lifting the data layer into `@caro/trend-data` is a mechanical refactor.
- Platform precedent. Existing packages are named for what you import when you want the feature, not for how the feature is built internally — `@caro/widgets` (SCADA widgets), `@caro/hmi-context` (live-value plumbing). `@caro/trend-chart` fits this pattern.

### 7.1 Layout

```
packages/trend-chart/
  src/
    TrendChart.tsx                # main component, wraps uPlot
    TrendChartProvider.tsx        # internal state: mode, window, tags, cache
    hooks/
      useTrendData.ts             # REST fetch orchestration + tile cache
      useLiveSubscription.ts      # WS tail (tailing mode only)
      useTrendViews.ts            # load/save saved views (Phase B)
    cache/
      tileCache.ts                # LRU, keyed by (tagId, bucketMs, tileIndex)
      level.ts                    # windowMs → bucketMs; bucketMs → tileSpanMs; tile math
    panel/
      Legend.tsx
      TagPickerDrawer.tsx
      TimeRangeBar.tsx
      SavedViewDropdown.tsx       # Phase B
    render/
      downsample.ts               # MinMax / LTTB if needed past coarsest level
      colorAssign.ts              # deterministic color from tag ID
    types.ts
  package.json
  tsconfig.json
```

### 7.2 Dependencies

- `@caro/ui` — apiClient, tokens, primitives
- `@caro/hmi-context` — `useLiveValue(tagId)` for live tail, `useTagMap()` for tag metadata
- `uplot` — external, new dependency

Not a dependency of `@caro/widgets`. Trend chart is an HMI-level component, not a SCADA widget.

---

## 8. Chart Rendering

### 8.1 Layout

One chart, up to 20 overlaid traces. Single visible Y axis on the left of the plot area, whose scale, units, and color correspond to the **selected trace**. Each trace nonetheless has its own internal Y-scale so that all 20 traces are visible simultaneously without being crushed into a single shared Y range.

### 8.1.1 Default Y-Scale per Trace

When a tag is first added to the chart, its Y-scale initializes as follows:

| Tag type | Default Y-scale |
|---|---|
| Numeric, `engineering_min` and `engineering_max` both present in Tag Registry | `[engineering_min, engineering_max]` |
| Numeric, engineering range missing | Autoscale over visible data (initial fetch fills in min/max) |
| Boolean | `[-0.5, 1.5]` |

After initialization, the operator can pan and zoom each trace's Y-scale independently (§9.1). Scale overrides are sticky per trace for the session. Saved Views do not persist Y-scale overrides (§13.1).

### 8.1.2 Boolean Traces

Boolean tags are treated identically to numeric tags — same trace model, same legend row, same selection behavior, same pan/zoom interactions. The only difference is the default Y-scale above.

Rationale: industrial trend viewers (Rockwell, Ignition, Wonderware) typically isolate booleans to a dedicated strip. Unifying them into the main plot area keeps the implementation simple and lets operators freely overlay a valve-open state on top of a flow-rate numeric without learning a second interaction model. The `[-0.5, 1.5]` default keeps the stepped line visually centered rather than hugging a plot edge.

### 8.1.3 Units on the Y Axis and Legend

The Y axis label shows the units of the selected trace, sourced from the Tag Registry's `units` field (e.g., `°C`, `bar`, `%`). Boolean traces display no unit (blank Y-axis label). The legend shows each trace's current value with its units appended (`78.3 °C`, `1` for booleans). If a tag's `units` field is empty, the axis and legend show the bare number.

### 8.2 Trace Colors

Deterministic assignment from tag ID via `colorAssign(tagId) = PALETTE[tagId % 20]`. Two operators who add tag 42 to a chart see it in the same color across any client and any session.

**Palette.** Single theme-agnostic 20-entry palette built from D3's `schemeTableau10` concatenated with itself (`[...schemeTableau10, ...schemeTableau10]`). Tableau's 10-color categorical set is legible on both light and dark backgrounds, widely battle-tested, and available via the `d3-scale-chromatic` package (no custom curation needed). Repeating the 10-color set for indices 10–19 accepts a modest collision risk (tags 0 and 10 share the same hue) in exchange for zero palette-design work — colors are only aliased at ≥ 10 plotted tags, and operators adding that many usually differentiate by legend position anyway.

**Out of scope for MVP.** Theme-aware palette switching (separate light/dark sets), colorblind-safe variant (Okabe-Ito base + extensions), operator color overrides. All trivially swappable behind the `colorAssign()` function signature if Phase B demands it.

### 8.3 Line Style

Stepped interpolation between samples (not linear). A recorded value of `2.0` at `t1` followed by `2.5` at `t2` is rendered as a constant at `2.0` until `t2`, then a step to `2.5`. This matches the COV storage semantics — no inference of smooth transitions between unrecorded moments.

`spanGaps: false` in uPlot config. Any `null` in a `value` array renders as a break in the line at that bucket.

### 8.4 Legend

Horizontal strip below the chart. Each entry shows:

- Color swatch (2px square matching trace color)
- Tag name (truncated with tooltip on hover)
- Current value (live in tailing mode, cursor value in fixed mode)
- Remove (×) button

Click on a legend entry selects that trace. Selected trace is highlighted (e.g., bold text, colored swatch border), Y axis adopts its color and scale, and non-selected traces dim slightly.

### 8.5 Hover Tooltip

On hover anywhere in the plot area, a tooltip displays:

- Timestamp at cursor position, rendered in the **fixed site timezone** (not the operator's browser timezone). Source: `HMI_SITE_TIMEZONE` env var (e.g., `America/Chicago`), rendered via `Intl.DateTimeFormat` with the `timeZone` option. Industrial-SCADA convention — timestamps describe the plant, not the viewer. A remote engineer VPNed in from another region sees the same wall-clock values an on-site operator sees. Falls back to browser-local time if the env var is unset.
- One row per trace: color swatch, tag name, value at that timestamp (or "—" if null)

Tooltip follows the cursor, positioned to avoid the chart edges.

### 8.6 Resolution Indicator

Small gray text in the chart header: `raw` / `1 s buckets` / `10 s buckets` / `1 min buckets` / `10 min buckets`. Tells operators when they are looking at aggregated data versus raw samples. Low real estate cost, high diagnostic value — especially once min/max bands ship in Phase B and are only meaningful at aggregate levels.

---

## 9. Interaction Model

### 9.1 Pan

- **Horizontal pan.** Drag left/right (mouse) or swipe (touch, Phase B). All traces share the X axis. The visible window `[from, to]` shifts by the drag distance. Pan triggers a mode transition: if the chart was tailing and the user drags backward (left), mode becomes `fixed` with the window frozen at its new position.
- **Vertical pan.** Drag up/down with modifier (e.g., shift-drag, TBD) adjusts the **selected trace's** Y-scale only. Non-selected traces retain their existing Y-scales — they are sticky per-trace. Unselected traces do not move vertically when the selected trace pans.

### 9.2 Zoom

- **Horizontal zoom.** Mouse wheel (or pinch, Phase B). Expands or contracts the visible window around the cursor position. A zoom that moves `to` away from `now` transitions to `fixed`; a zoom that keeps `to` at `now` stays in `tailing`.
- **Vertical zoom.** Modifier + wheel zooms the selected trace's Y-scale around the cursor value. Other traces unaffected.

### 9.3 Mode State Machine

Two modes only. No explicit Pause or Resume buttons.

```
                   pan left / custom range w/ to < now
                   zoom that moves `to` away from now
         tailing ───────────────────────────────────▶ fixed
                                                       │
                   click preset / click "Live" /       │
                   custom range with to ≈ now          │
                 ◀──────────────────────────────────── ┘
```

Transitions are implicit. Any pan, zoom, or range change that makes `to < now` enters `fixed`. Any preset click, Live button click, or custom range with `to` within ~1 minute of `now` enters `tailing`.

Tailing enables the WebSocket subscription; fixed disables it. One WebSocket connection, lifecycle managed by mode.

### 9.4 Selected Trace

Exactly one trace is "selected" at any time. Selection is:

- Set on tag add: first tag added becomes selected.
- Changed by legend click.
- Changed by keyboard (Phase B).
- Persisted in saved views (Phase B).

The Y axis on the left of the plot area displays the selected trace's scale and color.

---

## 10. Cache Strategy — Tile-Based (Option C)

### 10.1 Model

The client cache is keyed by `(tagId, bucketMs, tileIndex)`. Tiles are fixed-size, epoch-aligned segments of the time axis. Given `tileSpanMs` (a function of `bucketMs`, see §10.2), the tile covering timestamp `t` has `tileIndex = floor(t / tileSpanMs)` and spans `[tileIndex * tileSpanMs, (tileIndex + 1) * tileSpanMs)`. Every fetch is for one tile; no client request ever spans a partial tile.

Tile keys form three disjoint namespaces per tag, one per `bucketMs` value. Raw tiles (`bucketMs = 0`) never collide with aggregate tiles. Level transitions discard nothing — zooming out fetches new tiles at the new level while old-level tiles remain cached until evicted by LRU.

### 10.2 Tile Sizes

| L | Bucket | Bucket Size (s) | Tile Span | Buckets / Tile |
|---|---|---|---|---|
| 0 | raw (COV) | 0 | 1 hour | variable |
| 1 | 1 s | 1 | 10 minutes | 600 |
| 2 | 10 s | 10 | 100 minutes | 600 |
| 3 | 1 min | 60 | 10 hours | 600 |
| 4 | 10 min | 600 | 100 hours | 600 |

All aggregate levels carry a uniform **600 buckets per tile**. This keeps server-side query cost uniform across levels, makes payload size predictable (20 tags × 600 buckets × 8 B ≈ 96 KB), and means typical windows straddle a small number of tiles (a screen-wide visible window at any level is 1–4 tiles). Raw tiles use a 1-hour span regardless of COV rate; a bursty tag may produce a larger raw tile, but typical COV rates keep raw tile payloads comparable to aggregate tiles.

### 10.3 LRU Eviction

Total cache size capped at **50 MB**. Eviction by least-recently-used tile. Tiles currently on screen are exempt from eviction regardless of age.

Rationale for tile-based over alternatives:

- *Per-request raw slices.* Simpler but wastes bandwidth on overlapping fetches and prevents any reuse across pan operations. Rejected.
- *Full-window streaming.* Keeps everything in memory. Unbounded. Rejected.
- *Tiles.* Fixed-size cache units with predictable math. Pan by half a tile → one tile fetch (neighbor). Zoom across levels → distinct cache namespaces, no invalidation required. LRU is trivial.

### 10.4 Tile-Aligned Fetches

Given the visible window `[from, to]` and the chosen `bucketMs`, the client computes:

```
tileSpanMs = tileSpanFor(bucketMs)
firstTileIndex = floor(from / tileSpanMs)
lastTileIndex  = floor((to - 1) / tileSpanMs)
```

Then issues one request per tile in `[firstTileIndex, lastTileIndex]` that is not already cached. This ensures:

- Tiles are uniform and cacheable.
- Adjacent viewport pans hit the cache when they land within already-fetched tiles.
- The server never sees jagged non-aligned windows; the cache layer is the only query planner.

**Multi-tag batching.** Each tile request carries the full set of currently-plotted tag IDs that share a cache miss for that tile. Tile requests are batched by tile, not fanned out per tag. This turns a chart with N tags × M tile misses into M HTTP requests and M DB round-trips, not N×M. The server-side query uses `WHERE tag_id = ANY($tagIds)` and splits results by `tag_id` on return (§4.1).

**Single-tag exception.** When the operator adds one new tag to a chart whose already-plotted tags have the required tile(s) cached, the client issues a single-tag tile request for just the new tag — refetching the existing tags would be wasted bandwidth. This is the only case in which a tile request carries fewer than all currently-plotted tag IDs.

### 10.5 Overfetch and Prefetch

- **Overfetch.** Beyond the visible window, the client fetches 1 additional tile on each side, never extending past `now`. Smooths out small pans and prevents flash-of-empty at edges.
- **Prefetch.** When the visible window crosses 50% of the outermost cached tile (a hysteresis threshold), prefetch the next tile in the direction of travel.
- **Debounce.** Pan events debounce at ~100 ms to avoid issuing a new fetch on every frame of a drag.
- **Bridge render.** When the level changes (e.g., user zooms from a 24h view into a 30min view, crossing the L=2→L=1 boundary), render the old level's data scaled into the new pixels until the new level's fetches resolve. Avoids blank chart during zoom.

### 10.6 Live Tail Stitching

In tailing mode, the trailing tile for each tag at the active level is the "open" tile — new live data lands here as buckets close. REST provides data up to `responseTailTs` (the timestamp of the last bucket returned in the last tile fetch). WebSocket delivers live values for `ts > responseTailTs`. These are fed into a **client-side bucket accumulator**: a rolling buffer per tag that mirrors the server's bucketing rules for the active `bucketMs`. The accumulator emits bucketed values into the open tile as buckets close, matching what the server would have materialized.

When the open tile fills (tile span elapses), the accumulator commits the tile to the LRU cache, opens the next tile, and the live tail continues. If the chart is panned back and the tail is later re-approached, the open tile is invalidated and re-fetched from REST to pick up any samples that arrived after eviction.

### 10.7 Per-Tag Subscription Lifecycle

Within tailing mode, tag add and remove operations mutate the WebSocket subscription set without tearing down the single underlying connection. The subscription channel reuses the `@caro/hmi-context` model (per-tag subscribe/unsubscribe messages on the shared WS).

**Add tag while tailing.** Ordering is: subscribe WS for the new `tag_id` first, then fire the single-tag REST tile fetch (§10.4 single-tag exception). Any live values that arrive on the WS before the REST response returns are held in the bucket accumulator keyed by `tag_id` and stitched at `responseTailTs` once the REST data lands. This reuses the cold-start stitching logic per newly-added tag — no special case.

**Remove tag while tailing.** Send the WS unsubscribe for that `tag_id` immediately. Cached tiles for the removed tag are not evicted explicitly; they age out via LRU (§10.3) and remain available if the operator re-adds the same tag within the cache window.

**Tailing → fixed during an in-flight fetch.** On mode transition, the client unsubscribes the WS immediately. Any REST tile fetches already in flight are allowed to complete, and their results are committed to the LRU cache — the tiles are valid historical data regardless of mode. They just aren't used for live rendering because the chart no longer has an open-tile concept in fixed mode.

---

## 11. Tag Picker

### 11.1 Entry Point

"Add tag" button above the legend. Click opens a **side drawer** (right-side panel, does not cover the chart). Drawer dismisses via an X button, Esc key, or click outside. Keeping the chart visible while picking was preferred over a modal because operators often use visible tag values to decide which additional tags are relevant.

### 11.2 Browse Model

Both tree and search:

- **Tree.** Mirrors the module hierarchy from the Tag Registry. Each module node expands to show its tags. Tree state (expanded/collapsed) persists within a session.
- **Search box** at the top of the drawer. Type-ahead fuzzy match against tag path (`Tank_01.Level`, `Pump_03.Speed.Feedback`). Matches filter the tree in-place — branches with no matches collapse; branches with matches auto-expand and highlight matching leaves.

Power users type. New operators browse. Both paths end at the same selection model.

### 11.3 Selection Model

Checkboxes on tree/list entries. Multi-select permitted. Commit with "Add N tags" button at the bottom of the drawer. Committing issues a single tile fetch for all newly added tags.

Rationale: adding five tags one-at-a-time is tedious and triggers five separate render cycles. Batch commit is both UX-nicer and performance-nicer.

### 11.4 Trendable Filter

Non-trendable tags are hidden from the tree and search results. The Tag Registry flags trendable tags explicitly; non-trendable tags have no `tag_samples` data and cannot be plotted.

Footer hint: when a search term matches non-trendable tags that are otherwise hidden, a small text note appears: *"3 matching tags are not trendable."* Prevents operator confusion when a known tag doesn't appear in results.

---

## 12. Time Range UX

### 12.1 Preset Buttons

Six presets in a horizontal strip: **15m · 1h · 4h · 24h · 7d · 14d**. Click on a preset:

1. Sets window size to the preset duration.
2. Sets `to = now`, `from = now - size`.
3. Enters `tailing` mode.

### 12.2 Custom Range

"Custom…" button opens a date/time picker with `from` and `to` fields. Committing:

- If `to` is within ~1 minute of `now`: enters `tailing` with window = `to - from`.
- Otherwise: enters `fixed` with the exact `[from, to]` as committed.

### 12.3 Live Button

Small "Live" (or "Go to now") button adjacent to the presets. Click:

- Keeps the current window size.
- Sets `to = now`.
- Enters `tailing`.

### 12.4 Return-to-Tailing Paths

From `fixed` mode, the operator returns to `tailing` by: clicking any preset, clicking Live, or committing a custom range whose `to` is near `now`. There is no explicit Pause or Resume control. Panning the chart backward is the implicit "pause"; clicking a preset or Live is the implicit "resume."

---

## 13. Saved Views (Phase B)

### 13.1 View Contents

A saved view captures:

- Tag list (array of tag IDs)
- Time configuration: either a preset name (`"1h"`, `"24h"`, …) OR a custom `(from, to)`; plus a `tailing` boolean
- Selected trace tag ID

**Not saved:**

- Y-scale overrides (per-trace zoom state) — transient interaction state; saving would make views feel stale and surprising.
- Colors — deterministic from tag ID, no need to persist.

### 13.2 Scope

Personal and shared sections in the view dropdown. MVP of saved views ships personal-only; shared views defer until HMI auth/role work lands.

Same user across multiple clients shares the same personal views. Last-write-wins on concurrent edits — no optimistic locking in MVP. Collisions are rare (same operator editing the same view from two clients simultaneously) and the cost of the complexity outweighs the benefit for the expected usage pattern.

### 13.3 Storage

New Postgres migration introduces `hmi_trend_views`:

```sql
CREATE TABLE hmi_trend_views (
  id              SERIAL PRIMARY KEY,
  user_id         INT NULL REFERENCES users(id) ON DELETE CASCADE,
                  -- NULL = shared view
  name            TEXT NOT NULL,
  tag_ids         INT[] NOT NULL,
  time_preset     TEXT NULL,
  time_from       BIGINT NULL,
  time_to         BIGINT NULL,
  tailing         BOOLEAN NOT NULL,
  selected_tag_id INT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Access via `@caro/db` named functions: `getTrendViews(userId)`, `saveTrendView(view)`, `deleteTrendView(id)`. No raw SQL in the app per platform rules.

### 13.4 UX

Dropdown at the top-left of the chart header showing the current view name (or "Untitled" if no view is loaded / the current state has diverged from a loaded view). Click opens a list with sections:

- **My views** (user-scoped)
- **Shared views** (site-wide)

Each row has edit and delete icons. Bottom of the dropdown: "Save current as…" always visible; "Save changes" visible only when a loaded view is dirty.

### 13.5 Default State

No default view. First-time open shows a blank chart with an empty-state prompt in the plot area: large "Add tags" button that opens the tag picker drawer.

---

## 14. Error and Loading Policy

Operator-visible UI is minimized. Errors surface to developers via console logging; operators see a consistent visual representation — gaps for missing data regardless of cause.

### 14.1 Initial Load

Skeleton chart on first paint: axes and legend structure visible, plot area empty, thin progress bar at the top. Resolves to data as tiles arrive.

### 14.2 Re-fetch While Visible

No operator-visible indicator. If a re-fetch exceeds 500 ms, `console.warn` with tile key and elapsed time. Purely for developer diagnostics.

### 14.3 Fetch Failure

Tile request fails (network error, 5xx, timeout): the tile's span renders as nulls (visually indistinguishable from real gaps). `console.error` with tile key and error detail.

**Not cached.** Failed tiles are marked as "fetch-failed, treat as miss" so that the next pan or zoom that crosses the range naturally re-requests. No explicit retry loop — operator interaction drives re-fetch.

Rationale for matching fetch-failure visual to null-gap visual: in earlier design discussion we considered a distinct "hatched" render to preserve the null-as-gap semantic contract. The user chose simplicity — both failure and data-absence render as gap — on the grounds that repeat operator interaction naturally triggers re-fetches and operator-visible differentiation would add UI weight for a transient condition.

### 14.4 WebSocket Disconnect (Tailing Mode)

Tail stops advancing. The gap between disconnect time and reconnect time renders as nulls. Client auto-reconnects with exponential backoff (500 ms → 1 s → 2 s → 4 s → 8 s cap, forever while in tailing). On reconnect, subscription resumes normally. `console.warn` on disconnect, `console.info` on reconnect.

No bridge-fetch on reconnect. If the operator wants the real data in the gap, any pan/zoom triggers a REST refetch that fills it in.

### 14.5 Retention Clamping

No client UI. `console.info` when the client submits a tile request whose `[tsStart, tsStart + tileSpanMs)` overlaps the region older than `now - 14d`. The DB returns what it has; the client renders gaps for buckets older than retention.

### 14.6 Summary

| Condition | Operator sees | Developer sees |
|---|---|---|
| Initial load | Skeleton + progress bar | — |
| Re-fetch | No indicator | `console.warn` if >500 ms |
| Fetch failure | Gap (null span) | `console.error` with tile key |
| WS disconnect | Gap, tail frozen | `console.warn` |
| WS reconnect | Tail resumes | `console.info` |
| Retention edge | Gap at left edge | `console.info` |
| Every tile fetch | — | `console.info` with `bucket_ms`, `tile_index`, `tag_count`, `rows`, `elapsed_ms` (§14.7) |

### 14.7 Performance Observability

Every Phase A tile is computed on-the-fly, so end-to-end tile latency is the key signal for deciding whether to promote a level to a continuous aggregate (§17.2).

**Client-side (primary).** `useTrendData` brackets each `fetch()` call with `performance.now()` and logs one structured line on response:

```
[trend-chart] tile fetched  bucket_ms=1000  tile_index=27396  tag_count=8  rows=600  elapsed_ms=124
```

Captures DB + server + network + JSON parse — closest to what the operator experiences. Always on. The existing §14.2 threshold (`console.warn` on fetches >500 ms) stays.

**Server-side (secondary, opt-in).** `getTrendTile()` in `@caro/db` logs a parallel line at Node level when env var `TIMESCALE_LOG_TILE_QUERIES=true` (default off):

```
[db] getTrendTile  bucket_ms=1000  tile_index=27396  tag_count=8  rows=600  db_elapsed_ms=92
```

Captures DB time only. Used for attribution ("is the slow tile DB or network?") when a client-side warning points to a specific level. Off by default to avoid log spam in normal operation.

**Promotion threshold.** A `bucket_ms` level is a candidate for CAG promotion when its client-observed p95 latency consistently exceeds **300 ms** during realistic operator usage. The decision is made by a human eyeballing the console — no automated aggregation in MVP. 300 ms leaves room above pan debounce (~100 ms) plus chart repaint (~16 ms) for tile arrival to still feel instant; above that, operators start to perceive lag. The threshold is a rule of thumb, not a hard gate — the maintainer calling the promotion decision is free to adjust.

**Not tracked in MVP.** Per-level rolling p95 as a `Trend_Info` tag, `trend_query_perf` table, automated alerts. These are re-openable if console eyeballing becomes painful.

---

## 15. Multi-Client Behavior

Every HMI client instance is fully independent:

- **Tile cache** is in-memory per browser. Two clients fetching overlapping windows maintain separate caches.
- **WebSocket subscription.** Each client opens its own WS connection to the HMI server. Existing infrastructure (`@caro/hmi-context`) handles N concurrent clients.
- **REST endpoint.** Stateless. Every request is self-contained `(tag_ids, bucket_ms, tile_index)` and the response is a deterministic function of those inputs. Identical requests from different clients are cacheable at any shared layer (query cache, CDN, future server LRU). Scales with normal web concerns.
- **Chart state** (mode, window, selected trace, zoom) lives in client-local `TrendChartProvider`. No cross-client synchronization.

Server-side load considerations: N clients = N× DB read load on `tag_samples`. In Phase A, every non-raw tile is an on-the-fly `time_bucket()` query against the raw hypertable — the dominant cost — but each tile is a single grouped query across all requested tag IDs (§4.1, §10.4), so per-client query rate is bounded by tile misses, not tag count. A typical pan fires 1–4 DB round-trips per client regardless of whether 1 or 20 tags are plotted. TimescaleDB's query cache absorbs identical repeated requests from different clients. A server-side LRU keyed on `(tag_ids, bucket_ms, tile_index)` is a natural future optimization if on-the-fly latency becomes the bottleneck before any CAG is promoted. At expected concurrency (a handful to a dozen operators), no intermediate cache is required for MVP.

Saved views are server-persisted and user-scoped. Two clients signed in as the same user share personal views; a save on one is visible on the other on next read. Last-write-wins on concurrent edits.

---

## 16. Testing Strategy

### 16.1 Server Unit Tests (Vitest)

- `/api/v1/trends/tile` handler: request validation (`tag_ids` count/shape, `bucket_ms` in allowed set, `tile_index` non-negative integer), envelope format, raw vs aggregate response shape, error cases
- `SnapshotEmitter`: interval fires, skips when LKV is empty, filters non-scalar values, stops cleanly
- `getTrendTile` dispatch: `bucketMs === 0` → raw branch; `bucketMs > 0` → on-the-fly branch; argument validation

### 16.2 Server Integration Tests (Real TimescaleDB)

This is the highest-value test layer. The null-as-gap contract lives here and is hard to get right.

- `T001_create_tag_samples.sql` applies cleanly on empty DB (no CAG migrations in MVP)
- `writeTagSamples` round-trip: write → read via raw tile → observe sample
- On-the-fly bucket queries at each level (1 s, 10 s, 1 min, 10 min) return correct `time_bucket_gapfill` + `locf` results over per-test samples written via `writeTestSamples()` covering known null rows and flatlines (§16.5)
- Server correctly emits `null` in the bucket's `value` when `null_count > 0` for that bucket
- End-to-end: POST samples via DbPipeline → GET `/api/v1/trends/tile` at raw and each aggregate level → shapes and null placement match expectations

### 16.3 Client Unit Tests (Vitest + jsdom)

- `tileCache`: LRU eviction, tile key derivation `(tagId, bucketMs, tileIndex)`, size accounting
- `level.ts`: `windowMs → bucketMs` selection at threshold boundaries; `bucketMs → tileSpanMs`; `(from, to, bucketMs) → [firstTileIndex, lastTileIndex]`
- `useTrendData`: tile-aligned fetch math, overfetch boundaries, level transitions, stitch at `responseTailTs`
- `colorAssign`: deterministic output for a given tag ID
- Mode transitions: window change / preset / pan → correct mode

### 16.4 Deferred

Component tests (React Testing Library) and E2E tests (Playwright) are deferred to Phase B. Component-level UI behavior is catchable in development; correctness-critical concerns (API contract, null contract, cache math) are covered by layers 16.1–16.3.

### 16.5 Test Data

No monolithic seeded fixture. The platform already has live trended data in `tag_samples` from normal operation, and the purpose of integration test data is not to "simulate trended data" but to provide deterministic inputs for value-level assertions. Tests that need determinism write their own samples on demand into an isolated time sandbox.

**Approach.**

- **Test sandbox window.** `TEST_RANGE_START = 1970-01-01T00:00:00Z`, `TEST_RANGE_END = 1999-12-31T23:59:59Z`. All integration-test samples are written inside this range. The pre-2000 window is guaranteed not to collide with real operational data (which begins after platform deployment) and is visually obvious in a DB inspector.
- **Helper module `packages/db/test/helpers/trends-test-range.ts`** exports:
  - `TEST_RANGE_START`, `TEST_RANGE_END` — bounds.
  - `writeTestSamples(samples: TagSample[])` — thin wrapper over `writeTagSamples()` that asserts every `ts` falls inside the sandbox window and fails loudly otherwise.
  - `resetTestRange()` — `DELETE FROM tag_samples WHERE ts >= TEST_RANGE_START AND ts <= TEST_RANGE_END`. Safe to run against a dev DB with real data — the WHERE clause never touches the live window.
- **No seed file, no full-table truncate.** Tests that need data write it themselves in `beforeEach` and clean up with `resetTestRange()` in `afterEach`. Tests are self-documenting: the samples they depend on live right next to their assertions.
- **CI.** Runs against an empty Timescale container. Same tests, same setup code, no fixture dependency.

**Why this over a seed file.** The monolithic seed forced every test case to share one pre-engineered dataset; adding a new scenario meant amending the seed and chasing the cascading effects on existing tests. Per-test writes decouple scenarios. They also match the platform's existing write path (`writeTagSamples()` via `@caro/db`) rather than bypassing it with raw SQL.

**Ownership.** The helper module lives with `@caro/db` because it depends on the schema and the typed write function. Test-scenario semantics live in each consumer's test files. A test that needs "tag 42 has a null at `TEST_RANGE_START + 1h`" writes exactly that in its own `beforeEach`.

### 16.6 Coverage Target

No formal percentage target. Every public function in `cache/` and `hooks/` has at least one test. Every server endpoint has a handler test plus at least one integration test covering its happy path.

---

## 17. MVP Scope

### 17.1 Phase A — MVP (Must Ship)

**Server**

- `GET /api/v1/trends/tile` endpoint — tile-based, stateless
- `SnapshotEmitter` at 5-minute interval
- Single `getTrendTile(tagIds, bucketMs, tileIndex, tileSpanMs)` entry point in `@caro/db`, dispatching internally: `bucketMs === 0` → raw hypertable; `bucketMs > 0` → on-the-fly `time_bucket()` + `time_bucket_gapfill` + `locf` against raw
- No CAG migrations in Phase A (beyond `T001_create_tag_samples.sql` already applied)
- Server-side `null_count > 0 → null` merge for aggregate levels

**Client**

- `packages/trend-chart/` single-package
- Client-side level selection: `windowMs → bucketMs` per §6.3
- Client-side tile math: `(from, to, bucketMs) → [firstTileIndex, lastTileIndex]`
- `TrendChart` component: single chart, up to 20 overlay traces, single Y axis tied to selected trace
- Tile cache keyed by `(tagId, bucketMs, tileIndex)`, tile sizes per §10.2, LRU at 50 MB
- Tailing / fixed modes with implicit transitions
- Preset buttons + custom range + Live button
- Tag picker drawer (tree + search, multi-select commit)
- Legend (name, color, current value, click to select trace, remove button)
- Hover tooltip (timestamp, all tag values at cursor)
- Null-as-gap rendering (uPlot `spanGaps: false`)
- WebSocket live tail with gap-on-disconnect, silent resume on reconnect
- Client-side bucket accumulator for live tail stitching at the active level
- Failed fetch → null span + `console.error`
- Resolution indicator in header
- Per-tile perf logging (client `console.info` always on; server logging gated by `TIMESCALE_LOG_TILE_QUERIES`, §14.7)

**Testing**

- Server unit + integration tests (16.1, 16.2)
- Client unit tests for cache, level math, and hooks (16.3)

### 17.1.1 Phase A Build Order (Recommended)

Non-binding, but each step is landable independently and its tests pass in isolation. Dependency order minimizes the amount of code that sits un-exercised before the next layer is built.

| # | Step | Builds on | Proves |
|---|---|---|---|
| 1 | `@caro/db` raw path: `getTrendTile()` with `bucketMs === 0` branch only, plus `writeTestSamples()` / `resetTestRange()` helpers (§16.5). Integration test: write raw samples into the sandbox window, read back via `getTrendTile(..., 0, ...)`, assert shape and values. | existing `@caro/db` Timescale infrastructure | DB round-trip, envelope shape, test sandbox pattern |
| 2 | `@caro/db` aggregate path: extend `getTrendTile()` dispatch for the four non-raw levels (on-the-fly `time_bucket()` + `time_bucket_gapfill()` + `locf()`). Multi-tag batching via `WHERE tag_id = ANY($1)`. Integration tests for each level covering null emission and flatline LOCF. | 1 | gap-fill contract, null-as-gap contract, multi-tag batching |
| 3 | REST endpoint `/api/v1/trends/tile`: thin handler, validation (`INVALID_TAG_IDS`, `INVALID_BUCKET_MS`, `INVALID_TILE_INDEX`), envelope, perf log (§14.7). Unit tests for validation; integration test for end-to-end round-trip. | 2 | API surface, validation, perf observability |
| 4 | `packages/trend-chart/` scaffold: workspace package, `level.ts` (window→bucketMs→tileSpanMs), `tileCache.ts` (LRU keyed by `(tagId, bucketMs, tileIndex)`, 50 MB cap), `colorAssign.ts`. Pure unit tests, no React. | 3 (only for types) | client-side tile math, cache eviction, palette determinism |
| 5 | `useTrendData` hook: tile-aligned fetch orchestration, multi-tag batching, single-tag exception for tag-add (§10.4), overfetch (+1 tile each side). Mocked server for tests. | 4 | fetch coordination, cache population, batching correctness |
| 6 | `TrendChart` static rendering: uPlot wrapper, `spanGaps: false`, stepped interpolation, per-trace Y-scale defaults (§8.1.1), legend with units (§8.1.3), hover tooltip with site timezone (§8.5), resolution indicator (§8.6). Hardcoded test data or storybook — no live tail yet. | 5 | render path, null-as-gap, color/legend/tooltip |
| 7 | Mode state machine + time range UI: tailing / fixed transitions (§9.3), preset strip (§12.1), custom range picker (§12.2), Live button (§12.3), pan/zoom interactions (§9.1–9.2). Still no WS. | 6 | interaction model, mode correctness |
| 8 | Live tail: WS subscription wiring via `@caro/hmi-context`, client-side bucket accumulator (§10.6), per-tag subscription lifecycle (§10.7), reconnect/backoff (§14.4). | 7 | live stitching, subscription correctness |
| 9 | Tag picker drawer: tree + search (§11.2), multi-select commit (§11.3), trendable filter (§11.4). | 8 | picker UX, trendable filtering |
| 10 | `SnapshotEmitter`: 5-minute periodic write of LKV through `DbPipeline`, env gating (`HMI_SNAPSHOT_ENABLED`, `HMI_SNAPSHOT_INTERVAL_MS`). Handler unit tests; long-flatline LOCF correctness validated against real data. | runs alongside; useful for production correctness but not blocking for earlier steps | bounded LOCF lookback |

**Landable checkpoints.** Step 3 gives you a working API with no UI — demoable via curl. Step 6 gives you a working historical chart — demoable with a hardcoded tag list. Step 8 gives you live tail. Step 9 completes the operator-facing Phase A surface.

**Skippable-but-discouraged reorderings.** Steps 1–3 must come before 4. Step 10 can slot anywhere after step 2 (it only depends on `@caro/db` + the existing DbPipeline and LKV cache). Steps 4–9 are roughly in dependency order but 9 (tag picker) could be built in parallel with 7/8 by a second developer.

### 17.2 Phase B — v1.1 (After MVP)

- **CAG promotion (as needed).** Once on-the-fly perf is measured under realistic load, individual levels may be promoted to continuous aggregates via new migrations (`T002+`). `getTrendTile` grows a third dispatch branch (`bucketMs === promoted ? queryCag() : queryOnTheFly()`). API surface unchanged.
- Saved views (personal only, `hmi_trend_views` table, dropdown UX)
- Min/max aggregate bands (API `min`+`max` fields; render as shaded region around the line)
- Shared views with role-based edit (waits on HMI auth/role work)
- Mobile/touch optimization (pinch zoom, touch pan, drawer gesture)
- Keyboard shortcuts and accessibility pass
- CSV export of current view
- Client component tests (React Testing Library)

### 17.3 Phase C — v1.2+ (Future)

- Second Y axis, if a concrete use case emerges (current design is single-axis)
- Statistical annotations (mean line, std-dev bands)
- Threshold / alarm overlays
- Cursor measurement mode (click two points → Δt, Δvalue)
- E2E tests (Playwright)

---

## 18. Open Questions

None outstanding at spec approval. Questions that arose during design and were resolved:

| Question | Resolution |
|---|---|
| Multiple panels per tag, or overlay in one chart? | Overlay. Single chart, 20 traces. |
| Dual Y axis or single? | Single, tied to selected trace. |
| uPlot vs Recharts vs Chart.js? | uPlot. Canvas rendering, minimal bundle, native stepped + gap support. |
| Return 6 fields per bucket or just `value`? | Just `value` for MVP. Add `min`/`max` in Phase B. |
| Server merges null or sends separate `hasNull` array? | Server merges. |
| Force-publish on flatline vs periodic snapshots? | Periodic snapshots at 5-minute interval. |
| Server-side retention clamp? | No. DB returns what it has; client logs info. |
| Hatched region vs null span for fetch failure? | Null span. Matches gap visual, re-fetches on interaction. |
| WS reconnect bridge-fetch? | No. Gap until pan/zoom. |
| Tile cache vs per-request vs full-window? | Tile cache. Option C. |
| Single package or split data/rendering? | Single. YAGNI. |
| Saved views in MVP? | Deferred to Phase B. |
| Default view on first open? | Blank chart with "Add tags" empty state. |
| Max concurrent clients? | Unlimited in design; tested at handful-to-dozen concurrency. Not a constraint. |
| Aggregation scheme — 1min/1hour/1day tiers, factor-of-4 uniform, or power-of-10? | Power-of-10 with five levels (raw, 1 s, 10 s, 1 min, 10 min). Factor-of-4 was rejected as over-engineered; the human-meaningful boundaries of power-of-10 carry their weight in debuggability (operators and devs think in seconds/minutes, not 400-ms/1.6-s buckets). |
| CAGs in Phase A, or compute on-the-fly first? | On-the-fly first. Defer CAG migrations until measured perf justifies promotion for a specific level. Same read semantics (`time_bucket_gapfill` + `locf`); promoting a level is a local DB change and a dispatch-branch addition. |
| Split `getTrendsRaw` and `getTrendsAggregated`, or one entry point? | One entry point, `getTrendTile(tagIds, bucketMs, tileIndex, tileSpanMs)`, dispatching on `bucketMs`. Keeps the `@caro/db` surface tight and puts all tile semantics in one place. |
| Client computes level + tile math, or server does? | Client. The server becomes a pure `(tag_ids, bucket_ms, tile_index)` → tile function — easy to cache, easy to test, no hidden state. |
| Separate `ts[]`/`value[]` arrays vs `(ts, value)[]` pairs? | Separate arrays. Matches uPlot's expected shape and halves JSON overhead (no repeated object keys). Aggregate tiles drop `ts[]` entirely since timestamps are derivable from `tsStart + i * bucketMs`. |
| `max_points` request param? | Removed. The bucket size for a given level is fixed; the client is responsible for choosing the level. |
| Raw tile span? | 1 hour. Produces comparable payloads to aggregate tiles at typical COV rates. |

**Open (Phase A):**

- Aggregate tile response shape: should the server ship the dense grid (`values: (number|null)[]` of length N) or a sparse representation (`{bucketIndex, lastVal}[]` + seed) and let the client do LOCF expansion? Dense is the Phase A shape. Sparse halves+ the payload at L1 (~1.7% bucket coverage with 1-min snapshot + COV) and makes server-side gzip mostly redundant, but changes the API contract and pushes a small amount of work to the client. Revisit when perf data from Phase A is available.
- Aggregate LOCF is currently implemented in JS, not via TimescaleDB's `locf()`. Two queries run in parallel per tile: a per-tag seed query (last sample before the tile window start) and a per-(tag, bucket) `last(value, ts)` query inside the tile. A JS walk carries the seed forward across empty buckets. Whether to push this into the DB via `time_bucket_gapfill() + locf()` should be reconsidered after the L4 × 20 tags re-measurement (pending as of 2026-04-23). The JS path is simpler to test and avoids a Timescale `locf()` version dependency, but adds two round-trips per tile request.
- Aggregate edge-case semantics (Phase A): no seed → null seed; no in-tile samples for a tag → `values` array filled with the seed (which may itself be null). Every requested tag always returns a `values` array of length `tileSpanMs / (bucketS * 1000)` in request order. There is no empty `value: []` case.
- Phase A aggregate emits one value per bucket (`last(value, ts)` + JS LOCF carry). No `min`, `max`, or `count` fields. Value spikes within a bucket are lost unless they happen to be that bucket's last sample. Revisit when per-bucket band rendering is added in a later phase.

---

## 19. Glossary

| Term | Meaning |
|---|---|
| Bucket size | The width of one aggregate bucket, in milliseconds (`bucketMs`). Allowed MVP values: `0` (raw sentinel), `1000`, `10000`, `60000`, `600000`. |
| CAG | Continuous aggregate. TimescaleDB's materialized rollup over a hypertable. Not used in Phase A; reserved for later promotion of specific levels. |
| COV | Change of value. The storage convention where samples are written only when a tag's value changes. |
| Fixed | Historical mode. Chart window is a static `[from, to]`; no live updates. |
| Level | One of five aggregation levels (L=0 raw, L=1 1 s, L=2 10 s, L=3 1 min, L=4 10 min). Each level has a fixed `bucketMs` and a fixed `tileSpanMs` (see §6.3 and §10.2). |
| LKV | Last known value. The HMI server's in-memory cache of the most recent value per tag. |
| LOCF | Last observation carried forward. Gap-fill mode that repeats the last seen value into missing buckets. |
| Null-as-gap | The contract that null sample values render as visual gaps in the chart, never interpolated. |
| On-the-fly bucketing | A read-time `time_bucket()` aggregation over the raw hypertable. Phase A source for all non-raw levels. |
| Tailing | Live mode. Chart window tracks `now`; WebSocket delivers updates. |
| Tile | A fixed-size, epoch-aligned segment of the time axis scoped to a single `bucketMs`. Unit of fetch and unit of cache. |
| Tile index | Integer identifier of a tile: `tileIndex = floor(t / tileSpanMs)`. Tiles at different levels are in disjoint namespaces. |
| Tile span | The duration of one tile in milliseconds (`tileSpanMs`), a function of `bucketMs` (see §10.2). |
| Trendable | Tag Registry flag indicating a tag's values are written to `tag_samples`. |
