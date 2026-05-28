# CARO_HMI Trend Viewer — Design Specification
**Date:** 2026-05-05
**Status:** Phase A Steps 1–12 complete.
**Companion Documents**

hmi_trend_viewer_reference | hmi_functional_spec | hmi_API_spec | hmi_widget_spec | CARO_DB_Spec | DB_Config_Usage_And_Perf | platform_handoff

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 2.4 | 2026-05-27 | PM / Claude | 2026-05-27 audit propagation pass (Issues 2–10). §7 client package structure: `useSessionPersistence.ts` added to the file map; `useTrendMode.ts` description expanded for `onTransition`; `TrendChartContainer.tsx` description updated to "thin wiring layer" with the actual line count (~440) and hook-composition list; `SpanBucketIndicator.tsx` removed (file deleted); §7.1 closing "hooks pending" line updated. §19 glossary: `latestSampleTs` simplified to `sessionHighWaterMark` with a historical note about the prior `max(...)` formula; `Live Mode` entry expanded to enumerate the three semantic uses of "live" in the codebase (mode predicate / `isLive` prop / tile-level live-edge per terminal-cache rule). §6.1 INVALID_TAG_IDS row clarified to explicitly include "non-positive integer (`id ≤ 0`)"; request param description tightened to "positive integers (>0)". §7.1 axisInteractions file-map line corrected (9 → 7 exported functions). |
| 2.3 | 2026-05-27 | PM / Claude | §4.4 brought into line with as-built per-ingest WS trend listener: signature is `(moduleTs, moduleId)` not `(moduleTs, tagId, value)`; `handleTrendDelta` snapshots LKV for every trendable tag in the module on every ingest; synthetic-on-flush is the rare fallback for tags whose module did not ingest in the flush window (not the documented common branch). Outbox sizing re-justified under per-ingest at the current HMI publish tick. Per-ingest-vs-per-COV design intent captured: revisit when `module_ingest_rate > TREND_FLUSH_HZ` or when subscriber counts exceed the picker cap. Closes the audit Issue 1 / `platform_todo.md` open item. |
| 2.2 | 2026-05-27 | PM / Claude | §13.6 Session Persistence added. localStorage-backed restoration of tagIds, Y-scale overrides, selectedTagId, sizeMs, mode, and toMs across HMI page navigation and browser refresh. Live-fixed→live-trailing reconciliation when now ≥ savedToMs. Opt-in via `persistKey` prop on `TrendChartContainer`. |
| 2.1 | 2026-05-27 | PM / Claude | Post-Step-12 fix propagation. `commitTagIds` single-mutation contract: all `tagIds` mutations route through `commitTagIds`, which calls `invalidateNonTerminalTiles()` before `setTagIds()` — §10.7 Add/Remove tag paragraphs updated; §11.3 OK-commit updated to reference `commitTagIds`. Empty-tagIds layout: `tagIds=[]` renders full layout (blank plot at normal height + Signals header + gear icon) instead of a large "Add tags" button — §13.5 rewritten. |
| 2.0 | 2026-05-27 | PM / Claude | Step 12 (Tag Picker) complete. §11 rewritten: gear icon in Legend `<thead><th>` opens modal (supersedes drawer); flat trendable list (supersedes tree); click-to-stage (supersedes checkbox + Add N); trendable filter; modal sizing formula; 16-tag cap. Spec status bumped to Steps 1–12 complete. |
| 1.9 | 2026-05-26 | PM / Claude | Session-end propagation pass. `responseTailTs` renamed `committedThroughTs` throughout (wire type, `ActiveTileEntry`, `needsFetch`, merge seam). `needsFetch` live branch collapsed to `return false` — WS tail + `invalidateNonTerminalTiles` + `REFETCH_LAG_MS` cover all live-mode cases (§10.6). `invalidateNonTerminalTiles` added to `dispatchModeAction` Fixed→Live edge (§10.6/§10.7). `mergeTrendData` `totalN` cap added (§10.6). `querySegment` absent-tag bounded-prev fallback documented (§5.5). `seamResponseTailTs` renamed `seamCommittedThroughTs`. |
| 1.8 | 2026-05-24 | PM / Claude | Unified-viewport + storm-fix arc. `dataViewport` removed from `useZoomState`; `useTrendData` now driven by `modeViewport` + explicit `bucketSMs` — fetch coverage follows display viewport directly, closing the blank-tile-on-zoom-out regression (§9.3/§10.5). `tilesForViewport` contract updated: explicit `tileSpanMs` parameter; left-anchor grid strategy; variable visible-tile count (typically 2–4) covering the full viewport; `MAX_VISIBLE_TILES = 16` defense-in-depth cap (§10.5). `useZoomState` rewritten: `currentBucketSMs` derived at render time for non-zoom intents (`derivedBucketSMs = modeViewportSpan / buckets`), eliminating the one-render transient that fired a tile storm on wide preset clicks; sticky `gestureBucketSMs` state only during `lastIntent === 'zoom'` (§9.3). `mergeAggregate` gained a `liveStartIndex >= 0` guard: when `live.startMs < cached.startTime`, cached data outside live's actual output coverage is preserved (§10.6). |
| 1.7 | 2026-05-19 | PM / Claude | Docs-only pass for Phases 1–4 (three-state mode machine) with refinements. §9.3 replaced with three-state machine (`fixed`/`live-trailing`/`live-fixed`), symmetric window-vs-live-edge classification rule (supersedes proposal D6/D7), auto-promote, `latestSampleTs === null` fallback. §10.6 updated for unified Live buffer (`spineRef`, `seedFromSpineFetch`, `getBufferSnapshot`, generation counter, `latestSampleTs` semantics, right-`overfetch=0` asymmetric pattern). §10.7 clarifies bucketing gates on `isLive(mode)` predicate. §10.8 expands `evictAll` triggers (all `fixed → live-*` and `live-* → live-trailing` via preset/Live). §12.1 documents preset-from-Live full teardown. §12.2 updated with symmetric endPicker rule (future-end → `live-fixed` from any state). §12.3 updated with three-state button (default / highlighted / orange). §13.1 adds `live-fixed` "Not saved" entry. §14.4 expands WS backoff scope and adds disconnect-duration to reconnect log. §19 adds Live Mode, Trailing, Unified Live Buffer, Auto-promote, `latestSampleTs`, `sessionHighWaterMark`, Generation counter, `liveEdgeBehindWindow` glossary entries. |
| 1.6 | 2026-05-11 | PM / Claude | Step 11 (live tail) complete. §4.4 rewritten: dedicated trend WS channel (`SUBSCRIBE_TREND`/`UNSUBSCRIBE_TREND`/`TREND_DELTA`), per-client outbox, `TREND_FLUSH_HZ` flush cadence (default 4 Hz), flat `samples[]` payload, synthetic-on-flush events. §6.2 aggregate response gains `responseTailTs` field. §9.3 cleaned: `viewportChanged` action removed (never shipped), `NEAR_NOW_MS` and `LIVE_MODE_ENABLED` constants removed. §10.6 rewritten: `useLiveSubscription` hook, bucket accumulator (aggregate) + raw buffer (raw mode), `isTailing` tile-fetch suppression in `useTrendData`, `rawBuffersRef` NOT trimmed on threshold, `mergeTrendData` with live-wins overlap logic. §10.7 updated: per-tag subscription lifecycle via `useLiveSubscription` tagIds prop. §17.1.1 Step 11 marked done (542 `@caro/trend-chart`, 67 `@caro/hmi-context` tests). |
| 1.5 | 2026-05-07 | PM / Claude | Watermark memoization (§4.3): `getWatermarkMs` now caches per-source with 30s TTL + in-flight dedup; cold `cagg_watermark()` cost (130–300 ms) absorbed into one call per source per 30s. Raw path unified into a single SQL query (UNION ALL with `is_in_window` discriminant, one connection per tile). Server-side perf log `prev=N` field added to raw log lines (§14.7). Diagnostic logs removed; `TIMESCALE_LOG_TILE_QUERIES` default set to off. |
| 1.4 | 2026-05-07 | PM / Claude | Mode rule: `zoomApplied` always → fixed (was: tailing if `to ≥ nowMs − NEAR_NOW_MS`). Zoom is exploratory; tailing now requires deliberate `liveClicked` or `presetClicked`-from-tailing. §9.3 transition diagram and action table updated. `NEAR_NOW_MS` retained for `viewportChanged` (Step 11). |
| 1.3 | 2026-05-07 | PM / Claude | Removed LOCF cutoff query (`MAX(ts)`) and past-extent CASE wrapper from `getTrendTile`. §5.5 updated: LOCF now runs unbounded past MAX(ts); dead-tag detection deferred (TODO in handoff). CAG perf restored to 100-200ms baseline (814ms planning regression from the cutoff query on 251-chunk production table eliminated). |
| 1.2 | 2026-05-05 | PM / Claude | v0.8 min/max bands complete. §6.2 aggregate response gains `min`/`max` arrays per-series (v0.8 example). §6.5 rewritten: three-case rule (mixed-null → null; empty-bucket → collapse to LOCF'd last × 3; normal → `last`/`bucket_min`/`bucket_max`). §8.7 added: always-band 2-series render architecture (2 series per tag + `bands[]`; raw mode passes `mins[i] === maxs[i]` for zero-area band; no uPlot rebuild on mode flip; `width: 0` regression guard). §9.5 added: defensive guards (`bucketSMs === 0n` in `level.ts`; `newStart >= 1n` clamp in `useZoomState.ts`). §17.1 step A.5 added; §17.2 bands item removed. Divergences from upgrade doc: 2-series always-band (not 3-series with rebuild); CAG uses `min(s.min)`/`max(s.max)` (not `last()`); DB interval uses integer-ms syntax. SpanBucketIndicator gains `lastFetchMs` prop (Last Fetch timing line); `formatFetchMs` helper added. |
| 1.1 | 2026-05-01 | PM / Claude | Phase A.5 UI refinements: `TrendChartContainer` mode-state tightening; `bucketSMs` invariant enforcement; `SpanBucketIndicator` renamed from `ResolutionIndicator`; footer layout consolidated. |
| 1.0 | 2026-05-01 | PM / Claude | Phase A Steps 1–10 complete. Inline amendments: §7.1 (actual file layout, TrendChartContainer rename); §8.5 (cursor-time in Legend, no floating tooltip); §9.1/9.2 (hit-zone gating replaces shift-key modifier; X-pan visual-only; drag-zoom on plot area; zoom-level threshold 1.5×); §9.3 (pan/zoom no longer trigger mode transitions — time-range-bar actions only); §9.4 added sizeMs note; §10.4 (TS_BUCKET_ORIGIN_MS alignment); §10.5 (ensureCovered edge-anchoring); §5.5 (MAX(ts) LOCF cutoff); §12.2 (Intl.DateTimeFormat); §17.1.1 (Step 10 marked done). Feature-flag note updated (INTERACTIONS_ENABLED + TOOLTIP_ENABLED deleted; LIVE_MODE_ENABLED dormant). |
| 0.9.1 | 2026-04-29 | PM / Claude | Editorial: align Tag Registry field references to actual `TagDef` type — `engineering_min`/`engineering_max`/`units` → `eng_min`/`eng_max`/`unit` in §8.1.1 and §8.1.3. No contract change. |
| 0.9 | 2026-04-29 | PM / Claude | Tile geometry pivot. Visible tiles per window 4→2, bucket_count per tile 250→500, plus 1 prefetch tile each side fired async (not render-blocking). Empirically driven by perf-page sweep showing "4×250 vs 1×1000" perf gap was ~0–10% with high variance, not the 51% the spec previously claimed. New justification is time-to-first-render (slowest-of-2 vs slowest-of-4) plus halved DB concurrency pressure plus decoupled prefetch. Trend viewer client locks to bucketCount=500, visibleTilesPerWindow=2, overfetchPerSide=1; server still accepts 1..2500. Cache reuse during pan/zoom unchanged. `packages/trend-chart/` scaffold (Step 7) ships with these defaults. Section §10 rewritten to match. |
| 0.8 | 2026-04-29 | PM / Claude | Phase A scope tightened. Per-tile perf log polish (§14.7), connection-pool sizing (§15), and EXPLAIN-plan validation (§5.5) deferred from Phase A to Phase B. API functional work and test coverage are complete; deferred items are observability/operational/perf-gate, not contract-level. Existing v0.3-era LOG_TILE_QUERIES gate remains in place; will be polished when revisited. |
| 0.7 | 2026-04-29 | PM / Claude | Watermark-aware fall-through implemented (§4.3). Recursive descent through 10min_cagg → 1min_cagg → 10s_cagg → 1s_cagg → raw. Split point rounded DOWN to the nearest requested-`bucketSMs` boundary at-or-below each level's watermark (not at watermark_ts exactly) — ensures clean bucket alignment across the stitch. `source: 'mixed'` set when any fall-through occurred. Raw dispatch (`bucketS < 1.0`) bypasses watermark logic entirely. Watermark read via `_timescaledb_internal.cagg_watermark(mat_hypertable_id)` joining `_timescaledb_catalog.continuous_agg` by view name. `__test_watermarkOverride` seam added for integration test isolation. v0.6 bucket-grid contract (`n = bucketCount` or `bucketCount + 1`) preserved across the merged result. |
| 0.6 | 2026-04-29 | PM / Claude | Server contract clarification: aggregate response returns whatever natural epoch-aligned buckets overlap the requested range; `n` may be `bucket_count` (aligned request) or `bucket_count + 1` (unaligned). Response `startTime`/`endTime` reflect the served bucket grid, not the requested range. Removes the "exact bucketCount" pretence — server is honest about its bucket alignment. Trend viewer client unchanged (aligns by policy). `bucket_count` becomes a bucket-width knob rather than a strict count contract. SQL template and dispatch table unchanged. |
| 0.5 | 2026-04-28 | PM / Claude | Wire contract change. API moves from (tag_ids, bucket_s, tile_index) to (tag_ids, start_time, end_time, bucket_count). Trend viewer client locks to bucket_count=250 by policy; server is agnostic and accepts 1..2500 for future consumers. Drops INVALID_TILE_INDEX; adds INVALID_RANGE and INVALID_BUCKET_COUNT. Cache keys, tile geometry, and tile-fetch math now express in time ranges. CAG dispatch (§6.3 table), bounded prev SQL (§5.5), watermark fall-through (§4.3), null-as-gap (§5.4), and N≤8 tag cap (§6.6) all unchanged. |
| 0.1 | 2026-04-21 | PM / Claude | Initial design spec capturing full trend viewer decisions — architecture, API, CAG aggregation, client package structure, UX (tag picker / time range / saved views), cache strategy, mode model, error/loading policy, multi-client behavior, testing strategy, MVP scope. |
| 0.2 | 2026-04-22 | PM / Claude | Aggregation scheme revised to power-of-10 (5 levels: raw, 1s, 10s, 1min, 10min). API endpoint changed to tile-based (`GET /api/v1/trends/tile?tag_ids&bucket_ms&tile_index`). Resolution selection moved server→client. Single DB entry point `getTrendTile()` dispatches internally on `bucketMs`. Phase A drops all CAGs — every non-raw level computed on-the-fly via `time_bucket()` against raw hypertable; CAG migrations deferred until on-the-fly perf is measured and specific levels warrant promotion. Response shape is a discriminated union (raw returns `{ts[], value[]}`; aggregate returns `{tsStart, n, value[]}`). Removed `max_points`, `resolution=auto`, `WINDOW_TOO_LARGE`. |
| 0.3 | 2026-04-22 | PM / Claude | Pre-build design pass resolving nine pending questions. Booleans are first-class traces with default Y-scale `[-0.5, 1.5]` (§8.1.2). Numeric Y-scale defaults to Tag Registry `[engineering_min, engineering_max]`, autoscale fallback (§8.1.1). Units shown on Y axis and legend from Tag Registry `units` field (§8.1.3). Multi-tag batching: one DB round-trip per tile across all requested tag IDs, single-tag exception for tag-add operations (§4.1, §10.4). Per-tile perf observability: always-on client `console.info`, opt-in server `console.info` via `TIMESCALE_LOG_TILE_QUERIES` (§14.7). CAG promotion threshold: p95 > 300 ms at a given `bucket_ms` level, human-in-the-loop decision. Per-tag subscription lifecycle in tailing mode: subscribe-then-fetch on add, immediate unsubscribe on remove, in-flight fetches complete on mode transition (§10.7). Color palette: `schemeTableau10` × 2, theme-agnostic (§8.2). Tooltip timezone: fixed site timezone via `HMI_SITE_TIMEZONE` (§8.5). Test data uses a pre-2000 sandbox window written per-test via `writeTestSamples()`; no monolithic seed file (§16.5). Added recommended Phase A build order with landable checkpoints (§17.1.1). |
| 0.4 | 2026-04-27 | PM / Claude | Performance-driven revision absorbing the empirical results from `Docs/DB_Config_Usage_And_Perf.md` (gate testing 2026-04-24/27). **CAGs are now Phase A, not Phase B** — all four CAGs (1s/10s/1min/10min) ship with the trends API (§3, §4.1, §17.1). Watermark-aware dispatch is mandatory — `getTrendTile()` splits any query whose `range_end > watermark_ts` and serves the trailing portion from the next-finer source (§4.3, new). Bucket size becomes continuous: `bucket_s = window_seconds / total_buckets`, dispatched onto the nearest CAG with outer `time_bucket()` re-aggregation; cheap zone is Div ≤ 16 (§6.3 rewritten). Tile geometry changes from 600 buckets per tile to **250 buckets, 4 tiles in parallel** per window (§10.2 rewritten). Per-query tag cap drops from 20 to **N ≤ 8** (heap-scatter cliff at N≈10–11); 20 remains the chart UX cap; charts >8 tags fan out into multiple parallel queries (§6.6, §10.4). New §5.5 documents the **bounded `prev` SQL pattern** — `AND ts >= $tileStart - INTERVAL '5 minutes'` — as mandatory; without it planning cost grows with chunk count (14 ms → 1.85 ms with bound). Depends on writer cadence ≥1 sample/tag/60 s. Snapshot interval ratified at **1 minute** (already in production via `TrendSnapshotScheduler`), replacing the 5-minute `SnapshotEmitter` of v0.3 (§5.3). CAGs materialize `last`, `null_count`, `min`, `max` from day one (§3.6, §6.5) — `min`/`max` cost storage but enable Phase B bands without re-migrating; `null_count` is required to honor null-as-gap on the CAG path. Connection pool guidance bumped from 10 to **20–30** for production multi-operator concurrency (§15). Build order rewritten (§17.1.1). New open question on T005 reconciliation — shipped 1s CAG (`caro_samples_1s`) materializes `count` not `null_count` and uses 12h chunks / 30s refresh / 12h compression; **must be migrated to align with this spec before the trends API ships** (§18). |

---

## 1. Introduction

This document specifies the design of the CARO_HMI Trend Viewer: the operator-facing component for visualizing historical and live time-series data from tags captured in the `tag_samples` TimescaleDB hypertable. It complements `hmi_trend_viewer_reference.md` (which defines the trending subsystem's storage contract and pipeline) by defining the read side — the REST API, the client package, and the user experience.

The trend viewer is an HMI-level feature, not a SCADA widget. It occupies a dedicated view within the HMI shell and is instantiated once per HMI client session. Operators use it to inspect process behavior over time, compare multiple tags, pan and zoom through history, and watch values update live.

Intended audience: frontend developers implementing the viewer, backend developers implementing the trends API, QA, and reviewers validating the null-as-gap contract end-to-end.

Document owner: Product Manager.

---

## 2. Scope

The trend viewer provides: a single chart displaying up to 20 overlaid traces; Live and historical (fixed) viewing modes; pan, zoom, and tag selection interactions; a tag picker; quick-preset and custom time range selection; saved views (deferred to Phase B); correct null rendering as visual gaps (never bridged); and multi-client independence.

Out of scope for MVP: saved views, shared views, mobile/touch optimization, keyboard accessibility polish, CSV export, statistical annotations, threshold overlays, cursor measurement mode, and a second Y axis. These are enumerated in §18 and allocated to later phases.

---

## 3. Technology Stack

Stack choices inherit from the platform (see `platform_handoff.md` §Stack). New dependencies introduced by this feature:

| Component | Technology | Rationale |
|---|---|---|
| Chart rendering | uPlot | Canvas-2D renderer, ~40 KB bundle, handles 20 × high-density traces at 60 fps without React reconciliation overhead. Supports stepped interpolation and `spanGaps: false` which is required for the null-as-gap contract. Lower overhead than Recharts (SVG, re-renders with React) or Chart.js (canvas but heavier and less ergonomic for time-series). |
| Aggregation (Phase A) | Four TimescaleDB CAGs + raw fall-through | 1s / 10s / 1min / 10min CAGs materialized off `tag_samples`. Reads use `time_bucket_gapfill()` + `locf()` with a bounded `prev` correlated subquery (§5.5). Outer `time_bucket(bucket_s)` re-aggregation lets one CAG cover ~a decade-and-a-half of window range (cheap zone = Div ≤ 16, §6.3). Dispatch is watermark-aware (§4.3) — the trailing portion of any query past the CAG's materialization watermark falls through to the next-finer source. **Unified dispatch rule (Phase 6, validated 2026-05-15):** raw COV is served only for tile windows where `expectedPoints ≤ bucketCount`; bucketed output is served for larger windows. `tag_samples` is now a source-table option for sub-second buckets (raw-source bucketed: gapfill+locf directly against `tag_samples`, same template as the CAG queries). Preset impact: 1m stays raw; 5m and 15m flip to bucketed via `tag_samples`. See §6.3 for the full two-step dispatch rule. |
| Aggregation (Phase B+) | Additional CAGs as needed | If the 10min CAG's worst-case operating point (Div ≈ 24.58 at 85–170 d windows) proves too slow once that much history accumulates, an hourly CAG can be added. Same query template; only a new dispatch range. |

All other layers (Node/Express, WebSocket, `@caro/db`, `@caro/hmi-context`, `@caro/ui`, React/Vite, TypeScript) are reused unchanged.

---

## 4. Architecture

### 4.1 Components

| Component | Location | Role |
|---|---|---|
| Trends REST endpoint | `apps/caro-hmi/server/src/routes/trends.ts` | Serves `GET /api/v1/trends/tile`. Validates `tag_ids`, `start_time`, `end_time`, `bucket_count`. Delegates to `getTrendTile()` from `@caro/db`. Returns the standard platform envelope. Stateless — no resolution selection, no window math. `bucketSMs` derivation and `bucketS` validation are DB-layer responsibilities; the route does not derive or check `bucketS` (Phase 6: small windows route to raw COV before bucketS is ever evaluated). |
| TrendSnapshotScheduler | `apps/caro-hmi/server/src/trend-snapshot-scheduler.ts` | Already in production. Ensures every trendable tag gets ≥1 DB row per minute via piggyback (on next MQTT ingest) or force-write (silent modules). The 1-minute cadence is a hard contract — the trends query's bounded `prev` subquery (§5.5) depends on it. |
| `getTrendTile()` | `packages/db/timescale/trends.ts` | Single named function: `getTrendTile(tagIds, startTime, endTime, bucketCount, nowMs?): Promise<{ tile: TrendTile; meta: TileMeta }>`. The route serializes `tile` to the wire; `meta` is server-side observability (consumed by the §14.7 structured log). `meta.segments[]` records per-segment `{ source, rangeStartMs, rangeEndMs, rowCount, dbElapsedMs }` captured during query recursion; `meta.finalSource` mirrors `tile.source` (`'mixed'` when watermark fall-through combined multiple sources); `meta.totalDbElapsedMs` and `meta.rows` are convenience sums. Derives `bucketSMs` and `bucketS` via `deriveBucketSMs`, then dispatches on `bucketS` per §6.3. Returns the actual natural epoch-aligned bucket grid: for aligned requests this matches `(startTime, endTime)` with exactly `bucketCount` rows; for unaligned requests `startTime` and `endTime` in the response reflect the served grid boundary and `n` is `bucketCount + 1` (§6.2). `committedThroughTs` is populated from the `DbPipeline` monotonic watermark (`nowMs` arg, passed in by the route) and used as the future-bucket-nulling cutoff (§6.5). **Watermark-aware fall-through (§4.3):** any query whose `endTime > source.watermark_ts` is split — materialized portion served from the chosen source, trailing portion from the next-finer source (CAG or raw). **Multi-tag batching:** one DB round-trip across all requested tag IDs using `WHERE tag_id = ANY($tagIds)`; results split by `tag_id` into the `series` array. **Per-query tag cap N ≤ 8** (§6.6) — the server rejects requests above this; charts with more tags fan out at the client. Platform rule forbids raw SQL in apps — all queries live here. |
| `packages/trend-chart/` | New workspace package | Full client-side feature: chart component, data hooks, cache, tag picker, time range bar, legend, saved-views dropdown (Phase B). Owns all window/level math, tile fan-out across the 2-tile parallel pattern (§10.2), and the N≤8 tag fan-out (§10.4). |

**Phase A migrations:** `T001_create_tag_samples.sql` (raw hypertable, already applied), plus four CAG migrations — `T005_create_cag_1s.sql` (already applied but **must be re-migrated**, see Open Questions §18 and `Docs/platform_todo.md`), `T00X_create_cag_10s.sql`, `T00X_create_cag_1min.sql`, `T00X_create_cag_10min.sql` (numbering TBD). Each CAG materializes `last(value ORDER BY ts)`, `null_count`, `min(value)`, `max(value)` (§3.2 of `DB_Config_Usage_And_Perf.md`). The `null_count` column is non-negotiable — it carries the null-as-gap signal through aggregation (§5.4). The `min`/`max` columns are consumed by the v0.8 read path (§6.2, §6.5) — surfaced as per-series `min`/`max` arrays in the aggregate tile response and rendered as filled bands by `@caro/trend-chart`.

### 4.2 Request Flow — Historical Fetch (one range)

```
Client                                           Server                           DB
  │  computes: windowSec → bucketS = windowSec / (2 × 500)                     │
  │            tileSpanMs = 500 × bucketS × 1000                                │
  │            → 4 epoch-aligned (startTime, endTime) ranges                    │
  │            and fans out tag IDs into ≤8-tag groups (§10.4)                  │
  │                                                  │                              │
  │ GET /api/v1/trends/tile?tag_ids=&start_time=&end_time=&bucket_count=        │
  ├─────────────────────────────────────────────────▶│                              │
  │                                                  │  derives bucketS = (end−start) / (bucketCount × 1000)
  │                                                  │  dispatch on bucketS (§6.3)  │
  │                                                  │    < 1.0 → raw               │
  │                                                  │    < 16  → 1s CAG (Div-agg)  │
  │                                                  │    < 160 → 10s CAG           │
  │                                                  │    <1600 → 1min CAG          │
  │                                                  │    else  → 10min CAG         │
  │                                                  │  watermark-split if needed   │
  │                                                  │  (§4.3)                      │
  │                                                  ├─── @caro/db.getTrendTile()─▶ │
  │                                                  │◀───────────────rows──────────┤
  │                                                  │  merge null_count>0 → null   │
  │                                                  │  shape response              │
  │  {ok:true, data:{source, startTime, endTime,     │                              │
  │   bucketS?, n?, series:[...]}}                   │                              │
  │◀─────────────────────────────────────────────────┤                              │
```

For each visible window the client fires **2 tile-fetches in parallel** via `Promise.all`, plus ±1 async prefetch tile on each side (not render-blocking), plus tag-group fan-out for charts with > 8 plotted tags (§10.4). Tile geometry constants live in §10.2 (`TREND_VIEWER_DEFAULTS`). Ranges are epoch-aligned — `startTime` is always an integer multiple of `tileSpanMs` from epoch — so identical logical ranges produce identical wire requests across clients and share the cache.

### 4.3 Watermark-Aware Dispatch and Fallthrough

Each CAG carries a `watermark_ts` reflecting how far materialization has advanced — typically lagging `now()` by the CAG's refresh cadence plus its native bucket size. A naive read of any window whose `range_end` is past the watermark would render a flat line at the live edge until the next refresh.

**Dispatch rule for fallthrough.** For any tile whose `[range_start, range_end)` overlaps `(watermark_ts, ∞)`:

1. Compute `splitBoundaryMs` as the start time of the TimescaleDB bucket containing `watermarkMs`, queried via a small SQL round-trip:

   ```sql
   SELECT extract(epoch from
             time_bucket($1::int * INTERVAL '1 millisecond',
                         to_timestamp($2::bigint / 1000.0))
           ) * 1000 AS split_ms
   ```

   A naive JS-side `floor(watermarkMs / bucketSMs) * bucketSMs` is **not equivalent**. For fixed-width intervals < 1 day, TimescaleDB's `time_bucket()` uses origin 2000-01-03 00:00:00 UTC, not the Unix epoch. The two grids coincide only when `bucketSMs` evenly divides `TS_BUCKET_ORIGIN_MS` (946,857,600,000 ms) — true for "round" widths (1s/10s/1min/10min/1h) but false for the arbitrary `bucketSMs` produced by `Math.round(spanMs / bucketCount)` on unaligned viewports. If the JS formula were used the stitch boundary would land mid-bucket, causing the left segment's CAG query to return a partial bucket and the right segment to re-query the same partial bucket from the finer source. Querying the actual TimescaleDB grid guarantees disjoint, fully-formed buckets.
2. Serve `[range_start, splitBoundaryMs)` from the chosen source (CAG).
3. Serve `[splitBoundaryMs, range_end)` from the **next-finer source** (a smaller-bucket CAG, or raw if the chosen source is already the 1s CAG and `watermark_ts` is recent enough).
4. Concatenate results in `getTrendTile()` before applying the gapfill+locf merge.

The next-finer source is itself subject to the same rule recursively, so a query whose tail is fresher than the 1s CAG's watermark falls through to raw — which has no watermark concept since writes commit immediately.

**Why this is mandatory.** Without watermark-aware fallthrough, the live edge of every Live-mode chart shows a flat line of stale CAG data until the CAG refresh fires (every 1 minute per `cagg_refresh_policy`). For 1-minute and longer windows the visible tail can be missing 10–60+ seconds of real data. Retrofitting the split logic later means re-implementing it across every level and re-validating the gapfill+locf merge — significantly more work than building it in from day one.

**Fall-through reflected in response.** When the split-and-stitch path fires, the response carries `source: 'mixed'` (§6.2) to indicate that materialized CAG data and a finer-source portion were combined. Clients do not act on this field — it is informational, surfaced for diagnostics and the server-side perf log (§14.7). The future-bucket nulling clause in §6.5 applies to the stitched mixed-source result regardless of which source filled each bucket — fall-through-from-raw filling the post-watermark slice does not exempt those buckets from the future-null rule.

**Implementation note.** `getTrendTile()` reads each CAG's watermark via `_timescaledb_internal.cagg_watermark(mat_hypertable_id)`, joining `_timescaledb_catalog.continuous_agg` by `user_view_name`. The function returns microseconds since epoch as a bigint string; divide by 1000 for milliseconds. Raw (`tag_samples`) has no watermark — treated as `Infinity` so it never triggers a fall-through. Watermark lookups are memoized per-source with a 30-second TTL and in-flight deduplication (module-level `watermarkCache` / `watermarkInFlight` maps in `@caro/db`); the first call after TTL expiry pays the underlying catalog cost (130–300 ms cold, <5 ms warm), while all subsequent calls within the TTL window return instantly. An `__test_watermarkOverride` seam (`Map<AggregateSource, number> | null`) bypasses the cache and DB lookup in integration tests without changing production code paths. An `__test_clearWatermarkCache` seam resets the module-level cache between tests.

### 4.4 Request Flow — Live Tail

```
Client (Live mode)                                 Server
  │                                                  │
  │  { type: "SUBSCRIBE_TREND", tagIds: [...] }       │
  ├─────────────────────────────────────────────────▶│  registers per-client trend outbox
  │                                                  │
  │                                                  │  MQTT ingest → TelemetryIntake.ingest()
  │                                                  │    → trendDeltaListener(moduleTs, moduleId)
  │                                                  │    → for each trendable tag T in moduleId:
  │                                                  │        for each client subscribed to T:
  │                                                  │          outbox[T].push({ moduleTs, value: LKV[T] })
  │                                                  │
  │                                                  │  TREND_FLUSH_HZ tick (default 4 Hz):
  │                                                  │    for each subscribed tag with no outbox entries
  │                                                  │      (its module did not ingest this window):
  │                                                  │      emit synthetic { moduleTs: now, value: LKV }
  │                                                  │    flush outbox → TREND_DELTA frame
  │                                                  │
  │  { type: "TREND_DELTA",                          │
  │    samples: [{ moduleTs, tagId, value }, ...] }  │
  │◀─────────────────────────────────────────────────┤
  │                                                  │
  │  useLiveSubscription feeds samples               │
  │  into bucket accumulator (aggregate) or          │
  │  raw buffer (raw mode); emits LiveTail           │
  │  merged by TrendChartContainer via               │
  │  mergeTrendData(cachedData, liveSub.tail)        │
```

The trend live tail uses a **dedicated WS channel** — not the existing `useLiveValue` / SUBSCRIBE/DELTA path. Three reasons the LKV path is unsuitable: (1) **coalescing** — the pull-based 8 Hz DELTA tick only delivers the latest value per tag per tick, silently dropping intermediate samples; (2) **no module timestamp** — the DELTA payload carries no `ts`, so the client would have to use `Date.now()` at WS receipt, introducing 100–500 ms of variable clock skew against the module-timestamped historical axis; (3) **only-changed semantics** — flatlines produce no events, making bucket closure on COV-silent tags impossible without heuristics. The shared `ws` connection is reused; a parallel subscription set and per-client outbox are maintained by `WsServer` alongside the existing LKV subscription.

**Server-side membership filter.** The server silently filters incoming `SUBSCRIBE_TREND` tag IDs against the boot-time trendable set. Non-trendable IDs are dropped without error (one batched `console.warn` per ignored subscribe message identifies the offending IDs). The Tag Picker (§11.4) is the UX-layer gate; this is server-side defense against stale saved views and a guard against the detrendified-tag synthetic-flatline regression (a non-trendable subscription would otherwise receive synthetic LKV samples every flush that masquerade as live trend data with no historian backing). Asymmetric with `/api/v1/trends/tile` (§6.1), which is permissive — REST reads serve whatever the historian has; WS serves only current live trend updates.

`TelemetryIntake.setTrendDeltaListener(fn)` wires the ingest path to the WS server's outbox accumulator. **Listener signature is `(moduleTs, moduleId)` — per-MQTT-ingest, not per-COV-of-tag.** `TelemetryIntake.ingest()` fires the listener once per MQTT frame with the frame's timestamp and the originating module ID; the listener does not see per-tag values. `WsServer.handleTrendDelta(moduleTs, moduleId)` then snapshots `LKV[t]` for every trendable tag `t` in the module and pushes one outbox entry `{ moduleTs, value: LKV[t] }` per (subscribed tag × subscribing client). The push happens regardless of whether the tag's value actually changed in that frame — the listener has no COV signal to filter on. Bandwidth follows module ingest rate × subscribed-tags-in-module, not per-tag COV rate. At the current HMI publish tick (~250 ms) and the picker stage cap (16 tags, §11.6), per-client outbox growth is ≤ 16 entries/flush; at `TREND_FLUSH_HZ = 4` Hz this is roughly equivalent in bandwidth to a per-COV implementation that re-emits LKV at flush cadence for flatlines.

The flush at `TREND_FLUSH_HZ` emits one `TREND_DELTA` frame per client containing all buffered samples plus one synthetic event per subscribed tag whose outbox is empty (the tag's module did not ingest in this flush window — typically a silent module, or modules ingesting slower than `TREND_FLUSH_HZ`). **Purpose of the synthetic event: propagate the LKV as the LOCF value into the client's bucket accumulator at the flush cadence — it advances bucket boundaries on flatline-and-silent tags.** Under the per-ingest design above, the synthetic branch is the rare fallback only when no per-ingest LKV-snapshot landed in the outbox between flushes. `moduleTs: now` resolves to the HMI server's `Date.now()`. Exact timestamp precision is not critical: by LOCF semantics the value is the same at any moment in the flatline window, so a bucket-boundary shift due to clock-domain skew between server and module places identical content in the resulting bucket. See handoff §11.D. `committedThroughTs` in the tile response (§6.2) gates the client's ring trim threshold — WS events older than that are pruned as already covered by cached tile data.

**Per-ingest vs per-COV — design intent.** The listener could in principle be wired per-COV-write (`(moduleTs, tagId, value)`), pushing only changed tags into the outbox and relying entirely on synthetic-on-flush for flatline advancement. At the current `module_ingest_rate ≈ TREND_FLUSH_HZ` operating point the two designs produce roughly identical outbox bandwidth (one entry/tag/flush either way: a real LKV from ingest, or a synthetic from flush). Per-COV's bandwidth advantage only materializes when `module_ingest_rate > TREND_FLUSH_HZ` (faster modules, or lower flush rate), which is not the current configuration. The simpler `(moduleTs, moduleId)` signature is therefore retained; revisit if a faster-ingest module is introduced or if subscriber counts exceed the picker cap (e.g. saved-view subscribers in Phase B).

**Bounded outbox (operational invariant).** The per-client outbox is per-tag (`Map<tagId, Array<{moduleTs, value}>>`). Each per-tag array is capped at `MAX_TREND_OUTBOX_PER_TAG = 500` entries. Under the per-ingest design above, a per-tag outbox fills at the rate of `module_ingest_rate` (one entry per ingest of the tag's module); at the current HMI publish tick of ~250 ms this is 4 entries/second, giving ~125 seconds of back-pressure tolerance before drops start. On overflow the oldest entry is dropped (`shift()`) and a per-client `trendDroppedCount` is incremented. `trendFlush` emits one batched `console.warn` per flush summarizing the drop count, then resets the counter. Worst-case memory per stuck client = `subscribed_tags × 500 × ~48 bytes/event`; bounded at the picker stage cap of 16 tags (§11.6) to ≤ ~400 KB per stuck client. Drop-oldest is correct for live tail (newest data is most relevant); historical reads come from the REST `/api/v1/trends/tile` path, not the WS outbox.

---

## 5. Data Pipeline — Why Gap-Fill, Why Snapshots

### 5.1 Change-of-Value Storage

The trending subsystem stores samples on change of value (COV). A tag that stays at `1.0` for eight hours produces one sample at the start of that period and no further samples until it changes. This is defined in `hmi_trend_viewer_reference.md` §1.4 as the storage contract.

### 5.2 The Empty-Bucket Problem

Both raw `time_bucket()` queries and CAG reads materialize a row for a bucket only when the underlying source has at least one sample in that interval. A tag flatlining through a 1-minute bucket — or a 1-hour bucket — produces no row for that bucket. A naive read returns fewer rows than expected, creating apparent gaps where data in fact exists: the tag was simply stable.

Two mechanisms together solve this, and they apply identically to raw and CAG reads — only the source relation differs:

**Gap-fill at read time.** TimescaleDB's `time_bucket_gapfill()` emits one row per requested bucket even when the underlying query returns nothing for that bucket. Combined with `locf()` (last observation carried forward), missing buckets are populated with the last known value. The exact SQL template is in §5.5.

**Continuous writer cadence.** `LOCF` needs a prior value to carry forward. If the query window starts during a long flatline with no sample at all, `LOCF` has nothing to carry. The platform's `TrendSnapshotScheduler` solves this by guaranteeing at least one sample per trendable tag every 60 seconds, via piggyback on the next MQTT ingest or a force-write for silent modules.

### 5.3 Writer Cadence — 1-Sample-per-Tag-per-Minute

`TrendSnapshotScheduler` is the production component that bounds the maximum interval between samples for any trendable tag. It is already deployed and runs as part of the HMI server boot sequence. The relevant guarantee:

> Every trendable tag has a sample written to `tag_samples` at least once every 60 seconds — either as a real COV write piggybacked on the next MQTT ingest for that tag, or as a force-write for tags whose modules have gone silent.

This 1-minute cadence is a **load-bearing contract** for the trends API: the bounded `prev` correlated subquery in §5.5 looks back exactly 5 minutes, providing 5× safety margin against writer hiccups, deployment restarts, or transient gaps. Empirically validated at 0 NULL `prev` results across 1,600,000 lookups in gate testing.

**Rationale:**

- *Force-publish on flatline.* Tracking a per-tag "last written timestamp" and emitting a synthetic sample when it exceeds a threshold is conceptually purer but more complex. The piggyback-then-force-write design accepted here keeps the synthetic-sample code path small and rare.
- *COV purity.* A snapshot is equivalent to a "time-since-last-COV" event and does not violate the COV principle — it simply bounds the maximum interval. Booleans that flatline for hours of operation are common; snapshots ensure the historian always has recent evidence the tag exists.
- *Storage cost.* Bounded. At 1-minute cadence across ~504 trendable tags, snapshots contribute ~725K rows/day, a small fraction of the raw hypertable's daily ingest.
- *Interval choice.* 1 minute is the tightest we need given the bounded `prev` is 5 minutes. Going tighter (e.g., 30 s) would cost more rows for no read-side benefit. Going looser (5+ min) would force the `prev` bound up and inflate planning cost — the design explicitly rejects this trade.

### 5.4 Null-as-Gap Contract

Null sample values indicate bad quality — sensor fault, communication timeout, stale PLC data. They must never be interpolated, smoothed, or bridged. A null marks a boundary: data before the null is valid, data after the null is valid, and the span containing the null is visually empty on the chart.

This contract is preserved at every pipeline stage:

| Stage | Preservation Mechanism |
|---|---|
| Sample write | `tag_samples.value` is `DOUBLE PRECISION NULL`; nulls are stored, not dropped. |
| Bucket aggregation (raw and CAG) | Each bucket row carries `null_count`. For raw the server computes `count(*) FILTER (WHERE value IS NULL)` inline. For CAGs `null_count` is **materialized as a column** alongside `last`, `min`, `max` (§3.2 of `Docs/DB_Config_Usage_And_Perf.md`). Both sources expose the same `(last, null_count)` pair per bucket. |
| Read query | Server inspects `null_count`: if `null_count > 0` for a bucket, the bucket's value is emitted as `null` in the response regardless of `last`. |
| API response | `series[].value` is a `(number \| null)[]` array; nulls are inline, not sidelined into a separate array. |
| Client rendering | uPlot is configured with `spanGaps: false`, rendering null as a visual break in the line. |

The decision to merge `hasNull` into the `value` array at the server (rather than returning separate `last[]` and `hasNull[]` arrays) was deliberate: the client never needs to distinguish "value was this but there were nulls" from "value is null." Both render identically. Merging at the server halves the per-series array count in the response and simplifies client code.

**T005 reconciliation (resolved, 2026-04-28).** T006 migration dropped `caro_samples_1s` and created `tag_samples_1s_cagg` with the correct `null_count = count(*) FILTER (WHERE value IS NULL)` column. All four CAGs now honour the null-as-gap contract. See §18 Resolved.

### 5.5 Canonical Gapfill+LOCF Query with Bounded `prev`

This is the **single SQL template** used for both raw and CAG paths in `getTrendTile()`. Only `<source_table>` differs:

```sql
SELECT s.tag_id,
       time_bucket_gapfill(make_interval(secs => $1::float8),
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
  AND s.ts <  $3::timestamptz
GROUP BY s.tag_id, bucket
ORDER BY s.tag_id, bucket;
```

`<source_table>` is one of: `tag_samples`, `tag_samples_1s_cagg`, `tag_samples_10s_cagg`, `tag_samples_1min_cagg`, `tag_samples_10min_cagg`.

`$1` is `bucket_s` (float8 seconds), `$2`/`$3` are tile bounds, `$4` is the tag-ID array (≤ 8 entries per §6.6).

**Why `INTERVAL '5 minutes'` is mandatory.** Without the bound, the `prev` subquery's `ChunkAppend` enumerates the entire chunk set at plan time. Measured cost on the current 88-chunk table: planning ~14.8 ms per tile, projecting to ~56 ms at the 14-day steady state of ~336 chunks. With the 5-minute bound, the planner uses the chunk-meta index condition (`_ts_meta_max >= tileStart − 5 min`) to prune to ≤ 2 chunks at plan time, dropping planning to ~1.85 ms. ChunkAppend reduction in the `prev` SubPlan: 61 nodes → 1 node. Catalog buffer hits: 1255 → 54.

This is not an optimization — it's the difference between a design that ships and stays shipped, and one that degrades silently as the table ages.

**Why 5 minutes (not less).** Writer cadence (§5.3) guarantees a sample per trendable tag at least every 60 seconds. The 5-minute bound provides 5× safety margin against writer hiccups, deployment restarts, and clock skew. Validated empirically at 0 NULL `prev` across 1.6M lookups in gate testing.

If writer cadence ever changes, this bound must be re-derived.

**NULL `prev` semantics.** When no prior value exists within the 5-minute window — a freshly-created tag, the start of the retention window, or an actual writer outage — the `prev` subquery returns NULL. The chart shows a NULL left edge until the first in-window sample. This is the correct default: operators must see gaps as gaps, not as fabricated continuations of stale values. See `DB_Config_Usage_And_Perf.md` §5.4.

**Prepared statements: do not use.** PostgreSQL's generic-plan regime (activated after the 5th prepared execution) cannot use bind values for chunk pruning at plan time. Prepared statements move chunk-enumeration cost from plan-time to execution-time without reducing it, and break the bounded-`prev` optimization. Use standard `client.query(text, values)` form. Tested in `perf_gates_prepared_2026-04-XX.md` — disproved.

**LOCF trailing behaviour (v1.3).** LOCF runs unbounded — it carries the last known value forward through all empty trailing buckets in any aggregate query. There is no `MAX(ts)` cutoff query. A recently-stopped tag will show a flat line at its last value extending to the right edge of the requested window. Trailing-edge dead-tag detection is deferred to a future enhancement; see the "Dead-tag detection" TODO in `hmi_trend_viewer_handoff.md`. Watchdog NULLs (§5.4 null-as-gap) remain the primary mechanism for signalling dead tags in deployments where the watchdog reliably writes NULLs on telemetry loss.

**Absent-tag fallback.** COV tags in windows narrower than the mandatory 60 s snapshot interval may produce zero in-window rows, causing `time_bucket_gapfill` to emit nothing and LOCF to have no carry-forward value. After the main gapfill query resolves, `querySegment` detects any tag whose output grid is entirely empty and issues a separate bounded-prev query:

```sql
SELECT DISTINCT ON (tag_id) tag_id, <value_col> AS v
FROM <source_table>
WHERE tag_id = ANY($1::int[])
  AND <time_col>  <  to_timestamp($2::bigint / 1000.0)
  AND <time_col> >= to_timestamp($2::bigint / 1000.0) - INTERVAL '5 minutes'
ORDER BY tag_id, <time_col> DESC
```

The result fills the entire grid flat at the most-recent prior value. Tags with no prior history in the 5-minute window remain `null × n`. This follows the same 5-minute bound and the same chunk-pruning rationale as the inline `prev` subquery above.

---

## 6. API — `GET /api/v1/trends/tile`

### 6.1 Request

```
GET /api/v1/trends/tile
  ?tag_ids=42,87,93           # comma-separated positive integers (>0); required, 1 ≤ count ≤ 8 (§6.6)
  &start_time=1776864000000   # ms since epoch, positive integer
  &end_time=1776864480000     # ms since epoch, positive integer; must satisfy end_time > start_time
  &bucket_count=250           # positive integer, 1..2500
```

One request = one time range for up to 8 tags. The server first applies the unified shape dispatch (§6.3 Step 1) using `SAMPLE_RATE_HZ = 10` and `bucketCount` to decide raw-vs-bucketed. Within the bucketed branch it derives `bucketS = Number(endTime - startTime) / (bucketCount * 1000)` and dispatches on it per §6.3 Step 2. Shape selection is server-side authoritative — no shape parameter exists on the wire. The interactive trend viewer client sends epoch-aligned ranges — i.e., `startTime` is an integer multiple of `bucketCount * bucketS * 1000` from epoch — so that identical logical ranges produce identical wire requests across clients and share the cache. Other consumers may send non-aligned ranges; see §6.2 for how the response differs.

No `bucket_s` on the wire, no `tile_index`. `bucketS` is a server-internal derived value; clients express requests in terms of time ranges and a bucket count. The server is a pure function of `(tag_ids, start_time, end_time, bucket_count)`.

**`bucket_count` is a bucket-width knob, not a strict row-count guarantee.** The server uses `bucket_count` to derive the bucket width (`(endTime - startTime) / bucket_count`). For aligned requests the response carries exactly `bucket_count` rows. For unaligned requests `time_bucket_gapfill` produces `bucket_count + 1` rows (one extra leading bucket that partially overlaps the request range from epoch). The response's `n` field always reflects the actual row count. The server accepts `bucket_count` in 1..2500; the interactive trend viewer locks it to **250** by policy (§10.2). Other consumers may choose different values but operate outside the gate-tested zone and are responsible for their own performance characterization.

### 6.2 Response

The response shape is a discriminated union on `source`:

**Raw response** (tile window where `expectedPoints ≤ bucketCount`, i.e., `tileWindowSec × SAMPLE_RATE_HZ ≤ bucketCount`; at `SAMPLE_RATE_HZ=10`, `bucketCount=500`: tile window ≤ 50 s, visible window ≤ 100 s)**:**

```jsonc
{
  "ok": true,
  "data": {
    "source": "raw",
    "startTime": 1776864000000,
    "endTime": 1776864480000,
    "committedThroughTs": 1776864480123,
    "series": [
      { "tagId": 42, "ts": [1776864001234, 1776864003445], "value": [1.9, 1.8, null] },
      { "tagId": 87, "ts": [1776864001890],                "value": [0.0] }
    ]
  }
}
```

Raw responses carry per-sample timestamps (COV samples are irregular). `ts[]` and `value[]` are parallel arrays of equal length.

**Aggregate response** (tile window where `expectedPoints > bucketCount`; bucketed via `tag_samples` or a CAG per §6.3)**  — v0.8:**

```jsonc
{
  "ok": true,
  "data": {
    "source": "1s_cagg",
    "startTime": 1776864000000,
    "endTime": 1776864960000,
    "bucketSMs": 1920,
    "n": 500,
    "committedThroughTs": 1776864958080,
    "series": [
      {
        "tagId": 42,
        "value": [1.9, 1.8, null, 2.0, 2.0],
        "min":   [1.7, 1.6, null, 2.0, 2.0],
        "max":   [2.1, 1.9, null, 2.0, 2.0]
      },
      {
        "tagId": 87,
        "value": [0.0, 0.0, 0.0, 0.1],
        "min":   [0.0, 0.0, 0.0, 0.1],
        "max":   [0.0, 0.0, 0.0, 0.1]
      }
    ]
  }
}
```

`min[i]` and `max[i]` are aligned 1:1 with `value[i]`. All three arrays have length `n`. For empty buckets (gapfilled, no source rows), `min[i] === max[i] === value[i]` — band collapses to zero area since the value was provably constant (COV semantics). For mixed-null buckets, all three are `null`. Raw responses (`source: 'raw'`) do NOT carry `min` or `max`; the discriminated union enforces this. See §6.5 for the full three-case rule.

`source` is one of `'tag_samples'`, `'1s_cagg'`, `'10s_cagg'`, `'1min_cagg'`, `'10min_cagg'`, or `'mixed'`. `source: 'tag_samples'` appears when the raw-source bucketed path (§6.3 Step 2, `bucketS < 1.0`) served the full range. `source: 'mixed'` appears when watermark fall-through (§4.3) stitched portions from multiple sources. The raw response shape still uses `source: 'raw'` — these are distinct: raw COV returns variable-length `ts[]` arrays; raw-source bucketed returns fixed-length `value[]`/`min[]`/`max[]` arrays with the aggregate envelope. `bucketSMs` is the bucket size in integer milliseconds, returned for client rendering; the server derives it as `Math.round((endTime - startTime) / bucketCount)`.

`committedThroughTs` is the `DbPipeline` monotonic watermark at request entry — it advances on each successful DB commit or empty tick and stalls on write failure. Present on **both** raw and aggregate responses. Clients use `committedThroughTs` directly as the live-ring-buffer trim threshold: WS events older than that are pruned as already covered by the cached tile; newer events remain in the accumulator/raw buffer for stitching. Because `committedThroughTs` reflects the DB's actual commit frontier (not a wall-clock offset), no `−1000 ms` fudge is needed. The same value serves as the future-bucket-nulling cutoff inside `getTrendTile` (§6.5) — single source of truth, no separate `nowMs` field on the wire.

`n` is the **actual** row count in each `value` array. Clients use the response's actual `n` field and `bucketSMs`; never derive the bucket count from the request alone. CAG sources continue to return `n === bucket_count` (aligned) or `n === bucket_count + 1` (unaligned leading bucket) because their materialized bucket widths (1s/10s/1min/10min) divide cleanly into `TS_BUCKET_ORIGIN_MS` (2000-01-03 UTC). For the raw-source bucketed path (`source === 'tag_samples'`, sub-second bucket widths from `Math.round(spanMs / bucket_count)`), `n` can deviate from `bucket_count` by a few buckets in either direction due to alignment variance against `TS_BUCKET_ORIGIN_MS` combined with `Math.round`'s direction — when round goes down, `q = spanMs/bucketSMs > bucket_count`; when round goes up, `q < bucket_count`. Both directions are mathematically correct gapfill outputs, not errors.

`startTime` in the response is the start of the **first** bucket in the served grid. For aligned requests this equals the request's `start_time`. For unaligned requests it is the nearest natural epoch-aligned bucket boundary before `request_startTime` — i.e., `floor(request_startTime / bucketSMs) * bucketSMs`. `endTime` is the end of the last bucket: `response_startTime + n * bucketSMs`.

For `RawTrendTile`, `startTime` and `endTime` always match the request exactly (raw is COV-driven, not bucketed).

Timestamp for aggregate bucket index `i` is `startTime + i * bucketSMs` (using the response's `startTime`). No per-bucket timestamps are transmitted — this is the primary payload savings at aggregate levels.

Wire format note: `startTime` and `endTime` are typed as `bigint` in TypeScript. JSON serializes them as numbers (safe within `Number.MAX_SAFE_INTEGER`, covering epoch ms past year 285,000). HTTP query params parse from strings.

Error envelope is the standard platform shape per `platform_handoff.md`:

```jsonc
{ "ok": false, "error": { "code": "INVALID_TAG_IDS", "message": "..." } }
```

Validation errors:

| Code | Trigger |
|---|---|
| `MISSING_QUERY_PARAM` | any of `tag_ids`, `start_time`, `end_time`, `bucket_count` is absent |
| `INVALID_TAG_IDS` | `tag_ids` empty, count > 8, contains a non-integer, or contains a non-positive integer (`id ≤ 0`) |
| `INVALID_RANGE` | `end_time ≤ start_time`, or either timestamp is non-positive |
| `INVALID_BUCKET_COUNT` | `bucket_count` outside 1..2500 or non-integer |
| `INVALID_BUCKET_S` | derived `bucketS` outside `(0, MAX_BUCKET_S]` (§6.3) — thrown by `getTrendTile()` in the **bucketed branch only**. Raw COV requests skip `bucketSMs` derivation entirely (Phase 6 dispatch); the route no longer validates `bucketS`. Normal clients do not trigger this because over-range UX is handled by the client-side `gatedFetchTile` gate (§6.3 Out-of-range UX). |

> **Note: the trends API does not enforce trendable-tag membership.** `trendable` is a write-side flag (it controls `TrendSnapshotScheduler` and the COV enqueue path in `TelemetryIntake`); reads return whatever data exists in `tag_samples` and its CAGs. A tag toggled `trend=false` after data was written still serves that data through retention — preserving access to legitimate historian data is preferred over symbol-table strictness. The Tag Picker (§11.4) is the UX-layer gate against adding non-trendable tags to a chart. Direct API consumers (saved views, scripted callers) are responsible for their own appropriateness checks. The WS live channel is asymmetric — `SUBSCRIBE_TREND` filters against the trendable set (§4.4); see that section for the rationale.

### 6.3 Bucket Size Selection and Source Dispatch

`bucketS` is a server-internal derived value. The DB layer uses the shared `deriveBucketSMs` helper inside `getTrendTile()` to compute `bucketSMs = Math.round(Number(endTime - startTime) / bucketCount)` first (integer-ms, used for downstream arithmetic and the response wire field), then `bucketS = bucketSMs / 1000`. The route does not derive or validate `bucketS` — see §6.1 (INVALID_BUCKET_S footnote) and §6.3 Out-of-range UX point 6 for the rationale (Phase 6 dispatch routes small windows to raw COV before `bucketS` is ever evaluated). The helper is exported from `@caro/db` so tests can assert parity between any future route-level usage and the DB-layer canonical implementation; no production caller other than `getTrendTile` consumes it today. Dispatch is on `bucketS` alone. The client never sends `bucketS` directly. The interactive trend viewer's approach to computing ranges that land in the desired dispatch zone is described in §10 (Cache Strategy, Trend viewer client policy).

**Design note: no client-side dispatch mirror.** `SAMPLE_RATE_HZ`, `bucketCount`, and the CAG thresholds that govern shape selection live only in `@caro/db`. The client does not predict the source label before issuing a request. Two reasons this is intentional, not an oversight: (1) when watermark fall-through fires, the server returns `source: 'mixed'` — a client-side predictor would have to either lie or reconcile after-the-fact, so server-as-source-of-truth is a correctness property, not just a maintenance shortcut; (2) duplicating four constants across packages with cross-reference comments pays a maintenance cost for marginal UX value. The `SpanBucketIndicator` shows bucket size in ms (derivable client-side from viewport math) rather than the dispatch label. If a dispatch label is ever required client-side, the response's `source` field can be surfaced post-fetch.

The dispatch table below is unchanged by the v0.6 alignment contract. Alignment only affects how many rows the `time_bucket_gapfill` call emits and what `startTime`/`endTime` the response carries (§6.2); it does not affect which source is chosen.

**Server dispatch — two-step unified rule (Phase 6, validated 2026-05-15):**

**Step 1 — shape selection (raw vs bucketed):**

```
expectedPoints = (endTime - startTime) / 1000 × SAMPLE_RATE_HZ
if expectedPoints ≤ bucketCount → raw COV (queryRaw, returns RawTrendTile)
else                            → bucketed (continue to Step 2)
```

`SAMPLE_RATE_HZ = 10` (exported from `@caro/db`). At `bucketCount = 500`, crossover is at tile window > 50 s (visible window > 100 s at `visibleTilesPerWindow = 2`).

**Step 2 — source table for bucketed path:**

```
if bucket_s < 1.0:    tag_samples (raw-source bucketed, gapfill+locf directly on raw data)
elif bucket_s < 16:   1s CAG    + outer time_bucket(bucket_s)
elif bucket_s < 160:  10s CAG   + outer time_bucket(bucket_s)
elif bucket_s < 1600: 1min CAG  + outer time_bucket(bucket_s)
else:                 10min CAG + outer time_bucket(bucket_s)
```

Where Div = `bucketS / native_bucket_s` of the chosen CAG. The cheap zone is **Div ≤ 16**, measured (`DB_Config_Usage_And_Perf.md` §7.3): re-aggregation cost is roughly flat up to Div = 16 and roughly doubles per doubling of Div past that. Cheap zone is usable up to Div ≈ 30.

**Per-preset routing (trend viewer defaults: `bucketCount=500`, `visibleTilesPerWindow=2`):**

| Preset | Visible window | Tile window | `bucket_s` | Shape | Source |
|---|---:|---:|---:|---|---|
| 1m  | 60 s    | 30 s   | 0.06 s | Raw COV  | `tag_samples` (COV) |
| 5m  | 300 s   | 150 s  | 0.30 s | Bucketed | `tag_samples` (raw-source) |
| 15m | 900 s   | 450 s  | 0.90 s | Bucketed | `tag_samples` (raw-source) |
| 1h  | 3,600 s | 1,800 s| 3.6 s  | Bucketed | 1s CAG |
| 4h  | 14,400 s| 7,200 s| 14.4 s | Bucketed | 1s CAG |
| 24h | 86,400 s|43,200 s| 86.4 s | Bucketed | 10s CAG |
| 7d  | 604,800 s|302,400 s| 604.8 s| Bucketed | 1min CAG |
| 14d |1,209,600 s|604,800 s|1,209.6 s| Bucketed | 1min CAG |

The 5m and 15m presets now return bucketed output (raw-source) instead of raw COV. All other presets are unchanged. See `Docs/trend_dispatch_unified_rule_proposal.md` for empirical validation (35% faster DB-side, 3.3× smaller wire payload vs raw COV at production activity).

**Drag-zoom / End-picker windows** below 100 s return raw COV automatically; above 100 s return bucketed. The flip is at the single threshold `expectedPoints = bucketCount`, not at `bucket_s = 1.0`.

**Window-range view (derived, at `bucket_count=500`):**

| Window | Source | `bucket_s` range | Div range |
|---|---|---|---|
| < 1.67 min | raw COV | < 0.2 s | n/a |
| 1.67 – 16.7 min | tag_samples bucketed | 0.2 – 2.0 s (but < 1.0 only) | n/a |
| 16.7 min – 4 h | 1s CAG | 1.0 – 14.4 s | 1.0 – 14.4 |
| 4 h – 32 h | 10s CAG | 28.8 – 115.2 s | 2.88 – 11.52 |
| 32 h – 10 d | 1min CAG | 230.4 – 921.6 s | 3.84 – 15.36 |
| 10 d – 170 d | 10min CAG | 1843 – 14746 s (`MAX_BUCKET_S`) | 3.07 – 24.58 |

Worst-case Div across the operating range is 24.58 (10min CAG at 85–170 d windows) — outside the cheap zone but inside the usable zone. Every other operating point stays Div ≤ 16. If the 10min CAG's worst-case proves too slow once 85+ d of history accumulates, an hourly CAG can be added (Phase B+, see §17.2).

**Client-side clamp.** The reducer in `useTrendMode` applies a single `clampLowerBound` helper to `zoomApplied` and `panApplied` actions: if `from < 1n`, the viewport is shifted rightward so `from = 1n` while preserving `to - from`. This prevents the reducer from emitting a `modeViewport` that the server would reject with `INVALID_RANGE` — the server requires `startTime > 0`. **No span-cap clamp** is applied to wheel-zoom or pan: span is passed through unchanged, so wheel-zoom past `MAX_VIEWPORT_SPAN_MS` does not snap back. Out-of-range UX is instead handled by the client-side `gatedFetchTile` wrapper in `useTrendData` (which rejects with `CLIENT_OVER_RANGE` when `bucketS > MAX_BUCKET_S` and with `CLIENT_UNDER_RANGE` when `tileSpanMs / bucketCount === 0n`) and by `placeholderData` rendering with the inline message in `CursorDisplay` (see §6.3 Out-of-range UX below). `MAX_VIEWPORT_SPAN_MS` is retained as a constant and is applied as a span cap on `endPickerCommitted` (preset/End-picker paths produce well-formed spans, so the cap is a defense-in-depth guard for the End picker's discrete commit). `MAX_BUCKET_S = 14746` and `MAX_VIEWPORT_SPAN_MS = MAX_BUCKET_S × 1000 × bucketCount × visibleTilesPerWindow` (≈ 170.67 days at defaults) are defined in `packages/db/timescale/trends.ts` (re-exported from `@caro/db`) and mirrored in `packages/trend-chart/src/level.ts`. `MIN_VIEWPORT_SPAN_MS = 1000n` (1 second; keeps `bucketSMs ≥ 1 ms` at `2 × 500` buckets per window) is a client-only concept — it lives exclusively in `packages/trend-chart/src/level.ts` and is not exported from `@caro/db` (the server does not enforce a corresponding threshold; see Out-of-range UX point 6 below). Server-side validation (route + `getTrendTile`) remains as defense in depth for non-viewer consumers and edge cases (URL manipulation, saved views).

**Out-of-range UX.** When the user drag-zooms or wheel-zooms to a span outside the supported range (too wide: `bucketS > MAX_BUCKET_S`; or too narrow: `viewportSpan < MIN_VIEWPORT_SPAN_MS`), the chart enters an out-of-range state without snapping back:

1. The `useTrendData` fetch effect short-circuits before constructing tiles when `viewportSpan > MAX_VIEWPORT_SPAN_MS` or `viewportSpan < MIN_VIEWPORT_SPAN_MS`, returning immediately without setting any state. The range guard is applied in history mode only — live tiles may legitimately extend past the live edge. No boolean flags are exposed on the hook result for this — `TrendChartContainer` derives its own modeViewport-keyed booleans for UX decisions; see point 3.
2. Every tile fetch in `useTrendData` is issued through `runTileFetch`, which delegates to a single `gatedFetchTile` `useCallback` wrapper that rejects with `CLIENT_PRE_EPOCH` for pre-epoch tiles (`startTime < 0n`), `CLIENT_UNDER_RANGE` when `tileSpanMs / bucketCount === 0n`, and `CLIENT_OVER_RANGE` when `bucketS > MAX_BUCKET_S`. Catch handlers at each site recognize these sentinels as silent no-ops; no flags are written — suppression is accomplished by the rejection itself.
3. `TrendChartContainer` derives `uxRangeExceeded` and `uxRangeTooNarrow` from `modeViewport` via `useMemo` (keyed on `modeViewport.start`/`modeViewport.end`), not from `useTrendData`'s hook flags. `modeViewport` is updated by `useTrendMode` on every wheel/pan RAF tick, so the UX state tracks user intent directly. The render branch uses `chartData = (uxRangeExceeded || uxRangeTooNarrow) ? placeholderData : mergedData`. `placeholderData` carries `n = 2`, `bucketSMs = Number(span)`, and one null-filled series entry per `tagId`. The two stub x-values at `modeViewport.start` and `modeViewport.end` let uPlot autoscale the x-axis to the user's selected range (preventing the `[0,1]` fallback that would otherwise produce negative-timestamp feedback on subsequent wheel events). `TrendChart` receives `rangeExceeded={uxRangeExceeded}` and `rangeTooNarrow={uxRangeTooNarrow}`.
4. An inline message renders on the right side of the cursor row via `CursorDisplay`'s `rangeMessage` prop: `"Range too wide. Zoom in or pick a smaller preset."` (over-range) or `"Range too narrow. Zoom out or pick a wider preset."` (under-range). `rangeMessage = null` when the chart is in range. `CursorDisplay` pins `lineHeight: 16px` so toggling the message does not reflow the row.
5. `TrendChart` accepts `rangeExceeded` and `rangeTooNarrow` props. The imperative `setScale` effect's dep array includes both, and the `lastIntent === 'zoom' | 'pan'` bypass gate is suppressed when either is `true` — uPlot's xScale stays aligned with `modeViewport` during continuous wheel-zoom in either out-of-range state.
6. The REST route applies one server-side defense-in-depth check for over-range: `INVALID_BUCKET_S` thrown by `getTrendTile()` in the bucketed branch when `bucketS > MAX_BUCKET_S`. Normal viewer clients never reach this — the client-side `gatedFetchTile` gate rejects first. **Under-range has no server-side guard**: sub-100s windows route to `queryRaw` via Phase 6 dispatch and return 200 with raw COV (possibly empty for sub-second windows with no samples). This is correct behavior — the bucketed branch's existing `INVALID_BUCKET_S` check covers genuinely invalid cases; a separate under-range check would have wrong threshold semantics because the server sees per-tile spans (= viewport / `visibleTilesPerWindow`), not viewport spans.

Pre-epoch tiles (`startTime < 0n`) are similarly filtered: `tilesForViewport` in `level.ts` drops `startTime < 0n` from both visible and prefetch arrays (TS_BUCKET_ORIGIN_MS alignment can push the left-prefetch before Unix epoch on epoch-adjacent viewports), and `gatedFetchTile` carries a defensive `CLIENT_PRE_EPOCH` check (evaluated first, before `CLIENT_UNDER_RANGE` and `CLIENT_OVER_RANGE`) as a silent skip with no flags set.

**Range span uniformity.** Range span is derived from `bucketS` at the trend viewer's fixed `bucketCount=500` — there are no fixed-per-level tile spans. The number of buckets per request is the contract, not the duration. This means at low Div the range span shrinks proportionally; at high Div it grows. The client always fetches the same response shape: 500 values per tag per range (when `bucket_count=500`).

### 6.4 Retention Behavior

The server applies **no clamping**. The DB returns whatever data is available for the requested range — if the range spans a region older than the source's retention horizon (raw: 14 d; 1s CAG: 14 d; 10s CAG: 90 d; 1min CAG: 1 y; 10min CAG: indefinite — see `DB_Config_Usage_And_Perf.md` §3.1), fewer rows come back and gap-fill produces no row for unmaterialized buckets. The client renders missing buckets as a gap — visually identical to any other null region. This keeps the server simple and honest: the response is a function of `(tag_ids, start_time, end_time, bucket_count)` alone.

The client emits a `console.info` when a request's `endTime` falls before the chosen source's retention edge, purely for developer visibility.

### 6.5 Min/Max Bands — v0.8 (Shipped)

The aggregate response carries `value`, `min`, and `max` per series (v0.8). The CAG storage layer materializes `last`, `null_count`, `min`, and `max` from day one; the read path consumes all four:

- `last` → emitted as `value` (or `null` when `null_count > 0`).
- `null_count` → consumed server-side to decide whether to emit `null`; never reaches the client.
- `min`, `max` → emitted alongside `value`; the band fill on the chart collapses to zero area for flat/empty buckets and renders a visible spread for normal buckets.
- `first`, `count` → not materialized; no proposed consumer.

**Three-case rule.** The server classifies every bucket using the pair `(null_count, bucket_min)`:

| `null_count` | `bucket_min` | Case | Wire (`value`, `min`, `max`) | Renders as |
|---|---|---|---|---|
| `> 0` | any | Mixed-null | `null, null, null` | Band gap |
| `0` | `IS NULL` | Empty (gapfilled) | `LOCF'd last × 3` | Line (band collapsed) |
| `0` | `NOT NULL` | Normal | `last, bucket_min, bucket_max` | Band from min to max |

Empty buckets collapse `min` and `max` to the LOCF'd `last` because COV semantics guarantee the value was constant during that bucket — carrying forward the prior bucket's measured spread would assert variance that did not occur. This collapse happens in JS (the server's `querySegment` post-pass), not in SQL, so it shares the same `null_count` conditional path that already enforces null-as-gap.

**CAG aggregator.** The re-aggregation CTE uses `min(s.min)` / `max(s.max)` (not `last()`) so that Div > 1 outer re-aggregation spans the full range of source sub-buckets. `last` uses `locf(last(s.last, s.bucket))` as before. `bucket_min` and `bucket_max` have no LOCF wrapper — empty sub-buckets surface as NULL and the JS post-pass handles them via the empty-bucket rule.

**Raw path.** `source: 'raw'` responses never carry `min` or `max`. Raw is COV-driven with no bucket aggregation; min/max do not apply. The discriminated union enforces this at the type level — raw series carry only `ts[]` and `value[]`.

**Backward compatibility.** The v0.8 change is purely additive. Clients reading only `series[].value` continue to work correctly; the new fields are additional parallel arrays.

**Future-bucket nulling.** After the three-case classification is applied, any bucket whose `bucketStartMs > committedThroughTs` is set to `(null, null, null)` regardless of its three-case outcome. This prevents server-side LOCF from synthesizing phantom values for buckets the server provably had not yet observed at request entry. Applies to the aggregate path only — raw tiles do not LOCF and need no adjustment. The bucket containing `committedThroughTs` (i.e., `bucketStartMs ≤ committedThroughTs < bucketStartMs + bucketSMs`) is preserved; only strictly-future buckets are nulled. `committedThroughTs` is passed from the route handler as an explicit `nowMs` argument to `getTrendTile`; when omitted (non-route callers), `Date.now()` is used, which is always past any historical tile's `endTime` — no change in behavior for those callers.

### 6.6 Max Tag Count

The API caps `tag_ids` at **8** per request. The chart's UX cap of 20 plotted tags remains; charts with more than 8 plotted tags fan out into multiple parallel queries on the client (§10.4) — a 16-tag chart over a single window becomes 4 time-tiles × 2 tag-groups = 8 parallel tile requests.

The N ≤ 8 cap comes from gate testing (`DB_Config_Usage_And_Perf.md` §6.3): the heap-scatter cliff lives at N ≈ 10–11 on uncompressed data and produces measurable degradation past N = 8 even on compressed paths. Capping at 8 keeps every operating point inside the cheap zone and avoids the planner's scan-strategy flip.

**Connection-pool implication.** Charts with many tags multiply outbound DB connections. A single operator opening a 16-tag chart consumes 8 connections (4 tiles × 2 tag-groups). Pool sizing must account for this — see §15.

---

## 7. Client Package Structure

Single workspace package `packages/trend-chart/`. Rationale against splitting into separate data and rendering packages:

- Only one consumer (the trend viewer) exists today. Splitting for speculative reuse is premature abstraction — another `package.json`, another `tsconfig`, another workspace edge, for zero current benefit.
- Internal boundaries already model the split. `cache/` and `hooks/useTrendData.ts` are the data layer; `TrendChart.tsx` and `render/` are the presentation layer. If a second consumer emerges (e.g., a "24h mini-trend" SCADA widget), lifting the data layer into `@caro/trend-data` is a mechanical refactor.
- Platform precedent. Existing packages are named for what you import when you want the feature, not for how the feature is built internally — `@caro/widgets` (SCADA widgets), `@caro/hmi-context` (live-value plumbing). `@caro/trend-chart` fits this pattern.

### 7.1 Layout

> **Implementation note (v1.0):** The wrapper component is named `TrendChartContainer`, not `TrendChartProvider` as originally specced. `Provider` implies a React Context; this component is a stateful wiring layer, not a context. The file structure below reflects the as-built layout.

```
packages/trend-chart/
  src/
    index.ts                      # all public exports
    types.ts                      # Tile, Viewport, AggregateSeriesData, RawSeriesData, TrendData
    api.ts                        # fetchTile() — typed REST fetch; TileApiResponse discriminated union

    # ── Core primitives (no React) ──────────────────────────────────────────
    level.ts                      # alignedTilesInRange, tilesForViewport, TREND_VIEWER_DEFAULTS,
                                  # TS_BUCKET_ORIGIN_MS, MAX_BUCKET_S (mirror of @caro/db),
                                  # MAX_VIEWPORT_SPAN_MS, floorDiv, ceilDiv
    tileCache.ts                  # TileCache (LRU, 50 MB cap), makeTileCacheKey
    colorAssign.ts                # colorAssign(tagId), PALETTE, PALETTE_SIZE
    axisInteractions.ts           # pure axis pan/zoom helpers (7 exported functions)
    (date formatting lives in @caro/ui — see formatDateTime / formatDate)

    # ── React hooks ─────────────────────────────────────────────────────────
    useTrendData.ts               # REST fetch orchestration; owns TileCache instance
    useTrendMode.ts               # live/fixed three-state mode machine; reducer plus
                                  # an onTransition callback (fires on prev.mode !== next.mode)
                                  # that owns the live↔fixed side effects (drainBuffers,
                                  # invalidateNonTerminalTiles) — supersedes the prior
                                  # dispatchModeAction container wrapper
    useZoomState.ts               # zoom level state; exports computeDragZoomViewport
    useSessionPersistence.ts      # debounced localStorage save (~250 ms), unmount flush,
                                  # initial-load reconciliation (filter saved tagIds against
                                  # trendable set, promote stale live-fixed to live-trailing
                                  # if savedToMs has passed); owns the buildInitialModeState
                                  # helper. Returns initial values + snapshot callbacks +
                                  # scheduleSave. No-op when persistKey is undefined.

    # ── Components ──────────────────────────────────────────────────────────
    TrendChart.tsx                # uPlot canvas wrapper; rebuild lifecycle, X-scale
                                  # preservation, per-trace Y-scale overrides, wheel/drag
    TrendChartContainer.tsx       # thin wiring layer: composes useTrendMode +
                                  # useSessionPersistence + useTrendData + useLiveSubscription
                                  # + useZoomState + TrendChart + TagPickerModal. Owns
                                  # tagIds state, picker open state, the lastChartDataRef
                                  # bridge, range-message derivation, RAF coalescing for
                                  # pan/zoom. ~440 lines after the 2026-05-27 refactor.
    SpanPresets.tsx               # footer: 8-preset strip (1m/5m/15m/1h/4h/24h/7d/14d)
    EndPicker.tsx                 # footer: End datetime picker button + Live/Go Live button
    Legend.tsx                    # vertical column on the right side of the chart
    CursorDisplay.tsx             # cursor-time display in the legend area

    render/
      uplotConfig.ts
      yScales.ts
      bandsFromTrendData.ts       # per-tag {mins, maxs} extraction; raw path returns same array
                                  # reference for zero-area band collapse
      formatBucketS.ts            # bucket size → human-readable (e.g. "3.8 min buckets")
      formatValue.ts              # tag value formatting
      formatTickLabel.ts          # X-axis tick label formatting
      formatSpanMs.ts             # viewport span → human-readable (e.g. "1 h")
      formatFetchMs.ts            # last-fetch duration → human-readable (e.g. "234 ms", "1.23 s")

  package.json
  tsconfig.json
```

Step 11/12 hooks and components are now built (`useLiveSubscription.ts`, `TagPickerModal.tsx`). Phase B items still pending: `useTrendViews.ts`, `SavedViewDropdown.tsx`. `SpanBucketIndicator.tsx` was deleted in the 2026-05-27 audit pass — the original combined widget is superseded by the `SpanIndicator` + `BucketFetchIndicator` split (see §8.6).

### 7.2 Dependencies

- `@caro/ui` — apiClient, tokens, primitives
- `@caro/hmi-context` — `useLiveValue(tagId)` for live tail, `useTagMap()` for tag metadata
- `uplot` — external, new dependency

Not a dependency of `@caro/widgets`. Trend chart is an HMI-level component, not a SCADA widget.

---

## 8. Chart Rendering

### 8.1 Layout

One chart, up to 20 overlaid traces. Single visible Y axis on the left of the plot area, whose scale, units, and color correspond to the **selected trace**. Each trace nonetheless has its own internal Y-scale so that all 20 traces are visible simultaneously without being crushed into a single shared Y range.

The Y-axis occupies a fixed 60 px wide area (`Y_AXIS_SIZE_PX` constant in `uplotConfig.ts`). Its label area is reserved at a fixed 16 px (`Y_AXIS_LABEL_SIZE_PX`) regardless of whether the selected trace carries a unit. When the selected trace is unitless (Boolean, or a tag with no unit string), the axis label is set to a space character `' '` so uPlot still allocates the area without displaying text. This prevents the plot-left-edge from shifting on trace selection.

### 8.1.1 Default Y-Scale per Trace

When a tag is first added to the chart, its Y-scale initializes as follows:

| Tag type | Default Y-scale |
|---|---|
| Numeric, `eng_min` and `eng_max` both present in Tag Registry | `[eng_min, eng_max]` |
| Numeric, engineering range missing | Autoscale over visible data (initial fetch fills in min/max) |
| Boolean | `[-0.5, 1.5]` |

After initialization, the operator can pan and zoom each trace's Y-scale independently (§9.1). Scale overrides are sticky per trace for the session. Saved Views do not persist Y-scale overrides (§13.1).

### 8.1.2 Boolean Traces

Boolean tags are treated identically to numeric tags — same trace model, same legend row, same selection behavior, same pan/zoom interactions. The only difference is the default Y-scale above.

Rationale: industrial trend viewers (Rockwell, Ignition, Wonderware) typically isolate booleans to a dedicated strip. Unifying them into the main plot area keeps the implementation simple and lets operators freely overlay a valve-open state on top of a flow-rate numeric without learning a second interaction model. The `[-0.5, 1.5]` default keeps the stepped line visually centered rather than hugging a plot edge.

### 8.1.3 Units on the Y Axis and Legend

The Y axis label shows the units of the selected trace, sourced from the Tag Registry's `unit` field (e.g., `°C`, `bar`, `%`). Boolean traces display no unit (blank Y-axis label). The legend value column shows the bare numeric (e.g. `78.3`); units appear in a dedicated adjacent column (`°C`). Boolean values render as `1` or `0` with no unit column text. If a tag's `unit` field is null or empty, the unit column is blank.

### 8.2 Trace Colors

Deterministic assignment from tag ID via `colorAssign(tagId) = PALETTE[tagId % 20]`. Two operators who add tag 42 to a chart see it in the same color across any client and any session.

**Palette.** Single theme-agnostic 20-entry palette built from D3's `schemeTableau10` concatenated with itself (`[...schemeTableau10, ...schemeTableau10]`). Tableau's 10-color categorical set is legible on both light and dark backgrounds, widely battle-tested, and available via the `d3-scale-chromatic` package (no custom curation needed). Repeating the 10-color set for indices 10–19 accepts a modest collision risk (tags 0 and 10 share the same hue) in exchange for zero palette-design work — colors are only aliased at ≥ 10 plotted tags, and operators adding that many usually differentiate by legend position anyway.

**Out of scope for MVP.** Theme-aware palette switching (separate light/dark sets), colorblind-safe variant (Okabe-Ito base + extensions), operator color overrides. All trivially swappable behind the `colorAssign()` function signature if Phase B demands it.

### 8.3 Line Style

Stepped interpolation between samples (not linear). A recorded value of `2.0` at `t1` followed by `2.5` at `t2` is rendered as a constant at `2.0` until `t2`, then a step to `2.5`. This matches the COV storage semantics — no inference of smooth transitions between unrecorded moments.

`spanGaps: false` in uPlot config. Any `null` in a `value` array renders as a break in the line at that bucket.

### 8.4 Legend

Vertical column on the **right side** of the chart. Rendered as a `<table>` with five columns: color swatch (fixed 18 px), label (auto), value (fixed px computed from `charsForTag`), unit (auto), remove (fixed 20 px). The `valueColPx` is computed once via `useMemo([tagIds, tagMap])` so live data updates never reflow the column.

`charsForTag(tag)` derives the character budget for the value column: `sign + intDigits + dot + decimals`, where `intDigits = min(8, floor(log10(max(|eng_max|, |eng_min|, 1))) + 1)` and `decimals` comes from the `format` field's `%.Nf` pattern (default 4). Boolean tags always return 1.

Each row shows:

- Color swatch (10×10 px, colored border when selected)
- Trace label: `tag_registry.tag_name` when set; `Tag-<id>` when NULL. Full `tag_path` available on hover via `title` attribute.
- Numeric value (right-aligned, fixed-width column) — see idle-value rule below
- Unit string (`tag_registry.unit`, blank when null) — separate column
- Remove (×) button

Click on a legend entry selects that trace. Selected trace is highlighted (e.g., bold text, colored swatch border), Y axis adopts its color and scale, and non-selected traces dim slightly.

**Idle-value rule.** When the cursor is absent (not over the plot area), each trace's displayed value depends on mode: in Live mode (`live-trailing` or `live-fixed`) the last fetched bucket's value is shown (the most recent data point); in `fixed` mode `--` is shown. This is controlled by a `showLastWhenIdle` prop on `Legend` (and forwarded through `TrendChart`). `TrendChartContainer` sets `showLastWhenIdle={isLive(modeState.mode)}`.

### 8.5 Cursor Time in Legend

The `Legend` strip's first row is a `Cursor:` field rendered directly by `Legend.tsx`. When the cursor is over the plot area, the field displays the cursor's X-axis position timestamp — taken via `posToVal`, not snapped to the nearest sample or bucket, so it reads correctly inside data gaps — rendered in the **fixed site timezone** (sourced from `Legend`'s `siteTimezone` prop, ultimately from `HMI_SITE_TIMEZONE` env var). When the cursor is outside the plot area the field shows `Cursor: --`.

Format: full date + time via the `formatDateTime` helper in `@caro/ui` (e.g. `01-May-2026 14:30:42`). Timestamps describe the plant — a remote engineer VPNed in from another region sees the same wall-clock values an on-site operator sees. Falls back to browser-local time when `siteTimezone` is absent.

`CursorDisplay.tsx` is a separate narrow component rendered **above** the footer preset row. It renders only the over-range / under-range message when the viewport span is out of bounds (see §6.3 Out-of-range UX); it is otherwise invisible. Its row height is pinned (`lineHeight: 16px`) so toggling the message does not reflow the footer.

The Legend's per-tag rows display each trace's value at the cursor when the cursor is over the plot, and fall back to the idle-value rule (§8.4) when it is not. The per-tag value is resolved from the cursor's X-axis **timestamp** (`cursorTsMs`, derived via `posToVal`) — never from uPlot's nearest-data-point index. Indexing by nearest point snaps across step transitions and bucket boundaries, displaying a value the rendered line does not have at the cursor. Resolution differs by mode:

- **Raw:** last-observation-carried-forward — the value of the last sample with `ts ≤ cursorTsMs`, seeded by the `prev` bounded-prev sample (§5.5). The valid range is the **union extent**: the latest timestamp across *all* traces, which is the same grid `bandsFromTrendData` forward-fills every trace onto. A cursor before a trace's first sample/`prev`, past the union extent, or resolving to a `null` sample shows `—`. Bounding by a trace's *own* last sample is wrong — it blanks quiet setpoints and `prev`-only flat traces whose line is still drawn across the viewport.
- **Aggregate:** the bucket containing the cursor — `bucketIdx = floor((cursorTsMs − startTime) / bucketSMs)`. A `bucketIdx` outside `[0, n)`, or a `null` bucket, shows `—`. The displayed value is the bucket `max` (v0.8 band data) or the single value (v0.7 cache fallback).

A separate floating cursor overlay is a Phase B UX decision.

### 8.6 Span, Bucket, and Fetch Indicator

The span/bucket/fetch information is split across two locations:

**Footer (below chart, alongside presets).** `SpanIndicator` shows the current viewport span (e.g. `Span: 4 h`). It lives in the footer left cluster between `SpanPresets` and `EndPicker`.

**Legend strip (below the tag table).** `BucketFetchIndicator` shows the current `bucketSMs` in human-readable form (e.g. `Bucket Size: 3.8 min`) and the wall-clock duration of the most recent viewport-change batch (e.g. `Last Fetch: 234 ms`). The Last Fetch line is null-displayed (`—`) until the first fetch completes. Both values are passed to `Legend` as `bucketSMs` and `lastFetchMs` props (routed through `TrendChart`). Low real estate cost, high diagnostic value for correlation with band render quality.

`SpanBucketIndicator` remains exported from `@caro/trend-chart` for backward compatibility but is no longer used in the active footer.

### 8.7 Always-Band Render Architecture

Two uPlot series are registered per tag — a min (lower edge) and a max (upper edge) — plus a `bands[]` entry filling between them. This static 2-series shape is registered once at uPlot init and never changes on mode flip or data swap.

- **Aggregate mode.** `bandsFromTrendData` returns distinct `min`/`max` arrays. Normal buckets have `mins[i] < maxs[i]` → visible filled band. Empty buckets have `mins[i] === maxs[i] === value[i]` → zero-area band (COV flatline collapse per §6.5). Mixed-null buckets have `null` at both indices → band gap.
- **Raw mode.** `bandsFromTrendData` passes the same JS array reference for both min and max (`mins[i] === maxs[i]` for every i) → zero-area band; only the per-edge stroke is visible, rendering the stepped COV line.

Visual contrast: selected trace uses fill α=0.6, stroke α=0.8, stroke width 2; non-selected uses fill α=0.25, stroke α=0.4, width 1.5. Both the min and max series draw the same colored stroke so the band is visually framed on both edges.

**No `data.type` in uPlot rebuild deps.** Mode flips from raw to aggregate or back are handled by `useTrendData` calling `u.setData(newUplotData)` — no uPlot destroy-and-recreate fires. The static always-band shape is what makes this possible; there is nothing structurally different between raw and aggregate configurations.

**`width: 0` regression guard.** Setting `width: 0` on a uPlot series causes the engine to skip `_paths` computation for that series entirely. Since `_paths.band` is built inside the paths function, a zero-width series never produces the clip geometry needed for band fill rendering — the fill silently disappears. The min series must have a non-zero width. Guarded by a dedicated test in `__tests__/render/uplotConfig.test.ts`.

---

## 9. Interaction Model

### 9.1 Pan

Pan is gated by hovering over the relevant axis margin — no keyboard modifier is required. The cursor changes shape to indicate the active gesture.

- **Horizontal pan.** Hover over the X-axis tick-label strip below the plot area → cursor changes to `ew-resize`. Left-click and drag horizontally → translates the X scale (`u.setScale('x', ...)`). Prefetch tiles already in the LRU cache cover the direction of travel, so the pan transitions without a blank frame. Preset, Live, or End picker commit resets the visual position by overwriting the X scale via the imperative `xRange` effect.

  > **Implementation note (v1.0):** Pan dispatches `panApplied { from, to, nowMs }` via `onXPan` → `handleXPan` (separate RAF channel). `panApplied` always produces a `fixed` state (live-trailing → fixed, live-fixed → fixed, fixed → fixed) and preserves `sizeMs` from the prior state (not derived from `to - from`). The zoom resolution (`currentBucketSMs`/`zoomAnchorSpan`) is not reset on `lastIntent === 'pan'`. The fetch effect re-runs on the updated `modeViewport`; the `runTileFetch` no-op guard typically prevents new network requests when the tile set is covered by the prefetch LRU entries.
- **Vertical pan.** Hover over the Y-axis label strip left of the plot area → cursor changes to `ns-resize`. Left-click and drag vertically → adjusts the **selected trace's** Y-scale only via `u.setScale('y_<tagId>', ...)`. Non-selected traces retain their existing Y-scales (sticky per-trace, persisted across uPlot rebuilds in `yScaleOverridesRef`). No mode transition occurs.

### 9.2 Zoom

Zoom is gated by hovering over the relevant axis margin for wheel events, or by drag-selecting on the plot area for box-zoom. No keyboard modifier is required for any gesture.

- **Horizontal wheel-zoom.** Hover over the X-axis margin → wheel up/down → continuous zoom anchored at the cursor data-X via `u.setScale('x', ...)`. After each wheel event, `computeZoomLevelTransition(newSpanMs, zoomAnchorSpan)` checks whether the new span has crossed the **1.5× threshold** relative to the anchor span. If it has, a discrete **zoom-level switch** fires: `bucketSMs` halves (zoom-in) or doubles (zoom-out), and the next fetch-effect run issues fresh visible + prefetch tiles at the new resolution (bridge render until they arrive). There is no cursor-centered viewport recenter — `useTrendData` is driven by `modeViewport` directly, which continues to advance via `zoomApplied` dispatches. No mode transition occurs.
- **Vertical wheel-zoom.** Hover over the Y-axis margin → wheel up/down → zooms the **selected trace's** Y-scale around the cursor data-Y. Other traces unaffected. No mode transition occurs.
- **Drag-zoom on plot area.** Left-click-drag on the plot area produces a uPlot drag-selection rectangle (`cursor.drag.x: true, setScale: false`). On mouse-up, the `setSelect` hook applies the selection as the new visual X range and calls `onDragZoom(startMs, endMs)`. The container's `handleDragZoom` snaps to the nearest discrete level via `computeDragZoomViewport` and sets the gesture resolution (`gestureBucketSMs` in `useZoomState`); `dispatchModeAction` simultaneously updates `modeViewport` to the selection bounds. `cursor.bind.dblclick: () => null` disables uPlot's built-in fit-to-data reset, which would break tile alignment.

  > **Implementation note (v1.4):** All X-scale mutations dispatch `zoomApplied { from, to, nowMs }` via `onXRangeChange` → `handleXRangeChange` (RAF-coalesced). This keeps `modeViewport`, `SpanBucketIndicator`, preset highlight, and the `EndPicker`'s End display in sync with the visible window. `zoomApplied` always → fixed regardless of prior mode or the value of `to`. See §9.3 for full transition rules.

### 9.3 Mode State Machine

Three modes. No explicit Pause or Resume buttons.

**State type:**

```typescript
type LastIntent = 'preset' | 'live' | 'endPicker' | 'zoom' | 'pan' | null

type ModeState =
  | { mode: 'fixed';         from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent }
  | { mode: 'live-trailing'; sizeMs: bigint; nowMs: bigint;            lastIntent: LastIntent }
  | { mode: 'live-fixed';    from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent }
```

All three branches carry `sizeMs` — required so `liveClicked` and auto-promote can restore/preserve the current window size. `live-trailing` is the rolling-live state (viewport tracks `latestSampleTs`); `live-fixed` is the panned-but-still-live state (WS active, viewport pinned past the live edge); `fixed` is the fully historical state.

**Mode invariants:**

| State | WS bucketing | `viewport.to` vs `latestSampleTs` | Tick action |
|---|---|---|---|
| `fixed` | inactive (ring fills, no bucketing) | arbitrary | no-op |
| `live-trailing` | active | `viewport.to == latestSampleTs` (derived) | advance `nowMs` |
| `live-fixed` | active | `viewport.to > latestSampleTs` | auto-promote check |

**Transition table:**

| From | Action | Condition | To | Key side effects |
|---|---|---|---|---|
| `fixed` | `presetClicked` | — | `fixed` | re-anchor `from = to - sizeMs` |
| `live-*` | `presetClicked` | — | `live-trailing` | re-anchor to the live edge; tiles refetched as needed |
| `fixed` | `liveClicked` | — | `live-trailing` | enter Live; tiles fetched through the unified pipeline |
| `live-*` | `liveClicked` | — | `live-trailing` | re-anchor to the live edge; tiles refetched as needed |
| `fixed` | `endPickerCommitted` | `to > latestSampleTs` | `live-fixed` | enters Live; no teardown (symmetric rule — see §12.2) |
| `fixed` | `endPickerCommitted` | `to <= latestSampleTs` | `fixed` | re-anchor `from = to - sizeMs`; historical navigation |
| `live-*` | `endPickerCommitted` | `to > latestSampleTs` | `live-fixed` | no teardown |
| `live-*` | `endPickerCommitted` | `to <= latestSampleTs` | `fixed` | `drainBuffers`; tiles refetched for the historical viewport |
| `fixed` | `zoomApplied` | — | `fixed` | no teardown |
| `live-*` | `zoomApplied` | — | `fixed` | `drainBuffers`; tiles refetched for the historical viewport |
| `fixed` | `panApplied` | — | `fixed` | (today's pan-in-fixed behavior preserved) |
| `live-*` | `panApplied` | `to > latestSampleTs` | `live-fixed` | no teardown |
| `live-*` | `panApplied` | `to <= latestSampleTs` | `fixed` | `drainBuffers`; tiles refetched for the historical viewport |
| `live-trailing` | `tick` | — | `live-trailing` | advance `nowMs`, preserve `lastIntent` |
| `live-fixed` | `tick` | `nowMs >= state.to` | `live-trailing` | **auto-promote**: snap viewport to `[nowMs - sizeMs, nowMs]`; set `lastIntent = 'live'` |
| `live-fixed` | `tick` | `nowMs < state.to` | `live-fixed` | no-op |
| `fixed` | `tick` | — | `fixed` | no-op (defensive; container guard prevents dispatch in fixed) |

**Symmetric window-vs-live-edge classification rule (supersedes proposal D6 and D7).** Pan, zoom, and endPicker from **any** starting state classify the landing mode by comparing `latestSampleTs` to the action's `to` field:
- `to > latestSampleTs` → `live-fixed` (viewport right edge past live data edge; WS stays active)
- `to <= latestSampleTs` → `fixed` (viewport right edge at or behind live data edge; WS torn down)

This rule applies uniformly regardless of the starting state. In particular, `endPickerCommitted` from `fixed` with a future-end now enters `live-fixed` (not stays `fixed` as proposal D6 originally specified). The original D6/D7 asymmetry is superseded. See §12.2 for endPicker details.

**Auto-promote `lastIntent` synthesis.** When auto-promote fires (`live-fixed` tick with `nowMs >= state.to`), `lastIntent` is set to `'live'` — not the prior value — so that `useZoomState` re-derives `currentBucketSMs` and `zoomAnchorSpan` from the post-snap clean span (`isZooming` flips to `false`, causing `derivedBucketSMs` to re-compute from the new `modeViewportSpan`). The SpanPresets highlight rule (`lastIntent !== null && lastIntent !== 'zoom' && sizeMs === preset.sizeMs`) is preserved because auto-promote preserves `sizeMs`. `tick` in `live-trailing` (the non-auto-promote path) still preserves `lastIntent` — clock advance is not a user intent and the viewport doesn't snap.

**`latestSampleTs === null` fallback (§3.3).** When `latestSampleTs` is unavailable (no `TREND_DELTA` frame received yet in the session — the window before first live data arrives), `panApplied` and `endPickerCommitted` treat `state.modeViewport.end` as if it were `latestSampleTs`. Consequences: pan-left from `live-trailing` before any data arrives exits Live (same as post-data); pan-right before any data arrives enters `live-fixed` (same as post-data). Operator gesture semantics are preserved across the spine-fetch-in-flight window.

**`lastIntent` and preset highlight rule.** `lastIntent` tracks the most recent user action. `SpanPresets` highlights the active preset when `lastIntent !== null && lastIntent !== 'zoom' && sizeMs === preset.sizeMs`. The highlight communicates *current viewport span matches this preset width*, not *you clicked this preset* — any size-preserving intent (`preset`, `pan`, `live`, `endPicker`) keeps the highlight as long as `sizeMs` aligns. `zoom` is excluded because it produces arbitrary `sizeMs` values. `null` (initial state) suppresses the highlight at first render. `tick` preserves `lastIntent` (non-auto-promote path); auto-promote sets `lastIntent = 'live'`.

`sizeMs` is held constant across all transitions except `presetClicked` and `endPickerCommitted`. Pan, tick, liveClicked, and auto-promote all preserve `sizeMs`.

Trend WS subscription lifecycle (`SUBSCRIBE_TREND`/`UNSUBSCRIBE_TREND`) is keyed on **tag-list membership and chart mount**, not on mode — `useLiveSubscription` keeps subscriptions warm across all mode transitions so the ring buffer continues receiving samples in fixed mode and seeds the accumulator on Live re-entry. UNSUBSCRIBE_TREND fires on tag removal or chart unmount. See §10.7.

### 9.4 Selected Trace

Exactly one trace is "selected" at any time. Selection is:

- Set on tag add: first tag added becomes selected.
- Changed by legend click.
- Changed by keyboard (Phase B).
- Persisted in saved views (Phase B).

The Y axis on the left of the plot area displays the selected trace's scale and color.

### 9.5 Defensive Guards

Edge-case guards added during the bands and over-range implementations:

- **`bucketSMs === 0n` guard in `level.ts` (`tilesForViewport`).** If `tileSpanMs / BigInt(bucketCount) === 0n` (bigint integer division), `tilesForViewport` returns empty tile arrays rather than dividing by zero downstream. Belt-and-suspenders for the history path: the primary under-range guard is `gatedFetchTile`'s `CLIENT_UNDER_RANGE` sentinel (see below), which catches sub-1ms viewports on every tile fetch.

- **`CLIENT_UNDER_RANGE` sentinel in `gatedFetchTile` (client-side only).** `gatedFetchTile` checks `tileSpanMs / BigInt(bucketCount) === 0n` and, if true, rejects with `CLIENT_UNDER_RANGE` without calling the server (no state is set — suppression is accomplished by the rejection). The history-mode fetch effect has a matching `isViewportUnderRange` short-circuit (`viewportSpan < MIN_VIEWPORT_SPAN_MS`). `TrendChartContainer` derives `uxRangeTooNarrow` from `modeViewport` for the UX response (placeholder data + message). The server has no corresponding route-level check: sub-100s windows route to `queryRaw` via Phase 6 dispatch and return 200 correctly (see §6.3 Out-of-range UX, point 6). Asymmetric with `CLIENT_OVER_RANGE` / `INVALID_BUCKET_S`: over-range has a server-side backup; under-range does not, because the server cannot use `MIN_VIEWPORT_SPAN_MS` (a viewport-level constant) against per-tile spans.

- **`newStart >= 1n` clamp in `useZoomState.ts` (`handleZoomLevelSwitch`).** When zooming in on a viewport very close to epoch 0, the computed `newStart` can be zero or negative. The clamp ensures `newStart` is at least `1n` (ms) before the tile request is issued. A zero or negative `start_time` would reach the server as an `INVALID_RANGE` error; the clamp silently corrects it at the client.

- **`clampLowerBound` in `useTrendMode.ts` reducer (`zoomApplied`, `panApplied`).** If `from < 1n`, shift the viewport rightward so `from = 1n` while preserving span. Same intent as the `useZoomState` guard above but applied at the reducer boundary to cover wheel-zoom and pan paths. No span clamp here — over-range UX is handled by `gatedFetchTile` + `placeholderData` (see §6.3 Out-of-range UX), so the reducer lets the span pass through unchanged on `zoom`/`pan`.

- **`endPickerCommitted` sizeMs cap.** `useTrendMode`'s reducer caps `state.sizeMs` at `MAX_VIEWPORT_SPAN_MS` on `endPickerCommitted` only. End-picker commits are discrete user actions where snap-to-cap is acceptable, unlike continuous wheel-zoom.

- **`endPickerCommitted` lower-bound clamp.** If the user-picked `to` would produce `from < 1n` (combining a near-epoch End with a max-span prior `sizeMs`), the reducer shrinks `sizeMs` so `from` lands at exactly `1n`. End-picker semantics preserve the chosen End by contract; the span shrinks rather than the End shifting forward (unlike `zoomApplied`/`panApplied`'s `clampLowerBound`, which preserves span and shifts the viewport). `to < 2n` is rejected outright as a no-op since the EndPicker UI prevents sub-1-ms spans (§12.2).

- **Pre-epoch tile filter in `tilesForViewport`.** `tilesForViewport` filters `startTime < 0n` from both visible and prefetch arrays; `gatedFetchTile` carries a defensive `CLIENT_PRE_EPOCH` sentinel check (evaluated first, before `CLIENT_UNDER_RANGE` and `CLIENT_OVER_RANGE`) as a silent skip with no flags set. See §6.3 Out-of-range UX.

---

## 10. Cache Strategy — Tile-Based (Option C)

### 10.1 Model

The client cache is keyed by `(tagId, startTime, endTime, bucketCount)` — keyed on the **request** values, not the served grid. The trend viewer client policy is to align `startTime` to integer multiples of `tileSpanMs` from epoch and to use the defaults defined in §10.2 (`TREND_VIEWER_DEFAULTS`). This ensures that `n === bucketCount`, the response's `startTime`/`endTime` match the request's exactly (§6.2, aligned case), and two requests for the same logical tile from different clients produce identical wire values and share the cache key without a separate coordination layer.

> **Cache key and future-bucket nulling (§6.5).** Two requests for the same logical tile from different clients at different times may differ by up to one bucket width in their future-nulled region: an earlier request will have more buckets past its `committedThroughTs` nulled than a later request for the same range. The cache key does not capture `committedThroughTs`, so a cached tile served to a subsequent client may be stale-but-consistent in this respect — the cached tile has more nulls than a fresh fetch would. This is acceptable: it errs on the side of showing gaps rather than phantom values, and it self-corrects on the next cache eviction. The terminal-cache rule (§10.8) ensures non-terminal tiles are never LRU-cached, so stale future-nulled content cannot be frozen across sessions; ordinary history-mode pans are unaffected because their `endTime < committedThroughTs` by construction.

The overfetch geometry is **configurable asymmetrically**: `tilesForViewport` accepts optional `overfetchLeftCount` and `overfetchRightCount` parameters that override `overfetchPerSide` for a given call. The live-exit refetch (live→fixed transition) calls `tilesForViewport` with `overfetchRightCount: 0`, producing 2 visible + 1 left-prefetch tiles — no right-side prefetch, because the user has just panned backward in time and a future-side prefetch tile would be wasted.

Cache entries form disjoint namespaces per `bucketCount` value per tag. Raw entries (`bucketS < 1.0`) never collide with aggregate entries, and entries at different `bucketS` values never collide with each other. Bucket-size transitions (zoom across a §6.3 dispatch threshold) discard nothing — the new level's ranges are fetched while the old level's ranges remain cached until evicted by LRU.

### 10.2 Tile Geometry

**Default trend viewer client policy: `bucketCount=500`, `visibleTilesPerWindow=2`, `overfetchPerSide=1`.** The live-exit refetch overrides the right-side count to 0, producing 2 visible + 1 left-prefetch tiles for that specific call.

Each tile is one rendered unit: 500 buckets at the viewport's bucket width. The two visible tiles together cover the full viewport and are the only tiles that gate chart render. One prefetch tile on each side fires concurrently with the visible fetches but does NOT block render — it populates the LRU cache asynchronously so that the next pan in that direction hits the cache instantly.

**Justification (empirical).** A perf-page sweep across `pointsPerTile ∈ {1000, 500, 250}` showed per-fetch latency is comparable across configs — 0–10% delta with high variance and no consistent direction across dispatch rows. The "4×250 beats 1×1000 by 51%" claim from v0.4 gate testing did not reproduce in the full dispatch sweep. The 2-visible design's advantages are:

- **Time-to-first-render**: the chart awaits the slowest-of-2 tiles rather than slowest-of-4, statistically improving first-paint latency.
- **DB concurrency pressure**: 2 simultaneous viewport queries vs 4, halving pool demand during render.
- **Decoupled prefetch**: prefetch tiles no longer contribute to render-blocking latency; they fill in cache ahead of user navigation.

The server accepts `bucketCount` in 1..2500 for non-viewer consumers (analytics, exports, headless reports). Those operate outside the viewer's gate-tested point and are responsible for their own perf characterization.

**Per-tag-group fan-out.** Charts with > 8 plotted tags split the tag list into ⌈N/8⌉ tag-groups. Each tile fires once per tag-group. A 16-tag chart during a viewport change becomes 2 visible-tiles × 2 tag-groups = 4 render-blocking queries (plus 2 prefetch tiles × 2 groups = 4 background queries).

**Payload sizing.** 8 tags × 500 buckets × 8 bytes = 32 KB per aggregate response. A 2-tile viewport with 8 tags is ~64 KB — identical to the prior geometry's total, distributed across 2 responses instead of 4.

### 10.3 LRU Eviction

Total cache size capped at **50 MB**. Eviction by least-recently-used entry. Entries currently on screen are exempt from eviction regardless of age.

Rationale for range-tile caching over alternatives:

- *Per-request raw slices.* Simpler but wastes bandwidth on overlapping fetches and prevents any reuse across pan operations. Rejected.
- *Full-window streaming.* Keeps everything in memory. Unbounded. Rejected.
- *Epoch-aligned range tiles.* Fixed-size cache units with predictable math. Pan by half a tile → one range fetch (neighbor). Zoom across levels → distinct cache namespaces, no invalidation required. LRU is trivial.

### 10.4 Tile-Aligned Fetches

Given visible viewport `[viewportStart, viewportEnd)` and `TREND_VIEWER_DEFAULTS` (§10.2):

```
tileSpanMs        = (viewportEnd - viewportStart) / visibleTilesPerWindow   // bigint floor division
firstVisibleStart = floor(viewportStart / tileSpanMs) * tileSpanMs          // epoch-aligned

visible[k].startTime = firstVisibleStart + k * tileSpanMs    for k in [0, visibleTilesPerWindow)
visible[k].endTime   = visible[k].startTime + tileSpanMs

prefetch[before] = tile immediately before visible[0]         // startTime = firstVisibleStart - tileSpanMs
prefetch[after]  = tile immediately after visible[visibleTilesPerWindow - 1]
```

All timestamp arithmetic is bigint to avoid float drift. Visible tiles are fired via `Promise.all` and awaited before chart render. Prefetch tiles fire concurrently but their resolution does NOT gate render.

> **Applies in all modes.** The tile-alignment rule above is used for every fetch, live and historical — both go through `tilesForViewport`. Live mode calls it with `overfetchRightCount: 0` (no right-side prefetch past the live edge); otherwise the geometry is identical. Tile-grid alignment is a cache-stability concern — identical logical windows must produce identical wire requests so the LRU key matches across clients — and it lets the terminal-cache rule (§10.6) reuse a tile once it rolls into the past and becomes terminal.

> **Implementation note (v1.0):** Tile boundaries are aligned to `TS_BUCKET_ORIGIN_MS = 946_857_600_000n` (2000-01-03T00:00:00Z UTC) — TimescaleDB's actual `time_bucket()` default origin for fixed-width intervals. Aligning to Unix epoch (0) produces boundaries that do not match TimescaleDB's natural bucket grid, which caused 502 errors on 7d/14d windows when the derived `bucketS` crossed a CAG dispatch threshold. The exported constant was renamed from `PG_EPOCH_MS` to `TS_BUCKET_ORIGIN_MS` to reflect this. `alignedTilesInRange` and `tilesForViewport` in `level.ts` both use this origin.

Tiles already in the cache are skipped. This ensures:

- All tiles are uniform and cacheable across clients.
- Adjacent pans hit the cache: the prefetch tile for the direction of travel is already populated.
- The server always sees epoch-aligned windows; the response's `n === bucketCount` and `startTime`/`endTime` match the request exactly.

**Multi-tag batching with N ≤ 8 fan-out.** Each tile request carries up to 8 tag IDs batched via `WHERE tag_id = ANY($tagIds)` server-side (§4.1). Charts with > 8 plotted tags fan out into ⌈N/8⌉ tag-groups. Total render-blocking requests for a fresh viewport: `visibleTilesPerWindow × ⌈N/8⌉` (e.g., 4 for a 16-tag chart). Prefetch tiles add `2 × ⌈N/8⌉` background requests.

The N ≤ 8 cap derives from the heap-scatter cliff (§6.6) and is enforced server-side. Per-query latency is roughly linear in N up to the cap; past N = 8 the planner flips scan strategy and latency degrades non-linearly.

**Single-tag exception.** When the operator adds one new tag to a chart whose already-plotted tags have the required range(s) cached, the client issues a single-tag range request for just the new tag — refetching the existing tags would be wasted bandwidth. This is the only case in which a range request carries fewer than the chart's currently-plotted tag count modulo 8.

**Connection pool implication.** Outbound DB connection demand scales with `4 × ⌈N/8⌉` per active window per operator. See §15 for pool sizing.

### 10.5 Overfetch and Prefetch

- **Visible tiles** are render-blocking: the chart's first paint awaits all visible tiles resolving. The visible tile count is variable (typically 2–4) — all tiles overlapping `[viewport.start, viewport.end)` at the current `tileSpanMs`; `MAX_VISIBLE_TILES = 16` is the hard cap (see below).
- **Prefetch tiles** (one each side of the viewport, `overfetchPerSide=1`) fire in parallel with the visible fetches but their resolution does **not** gate render. They populate the LRU cache asynchronously.
- **Pan transition**: the prefetch tile covering the direction of travel is already in the cache, so the pan transitions without a blank frame. The new outer-edge prefetch tile fires async at that point.
- **Zoom across §6.3 dispatch threshold**: `bucketCount` changes (effectively — the tile span changes), so the new tiles have distinct cache keys from the old ones. The old tiles remain cached until evicted by LRU. Bridge render: display the old level's data scaled into the new pixel space until the new visible tiles resolve.
- **Debounce.** Pan events debounce at ~100 ms to avoid issuing a new fetch on every frame of a drag.
- **Bridge render.** When `bucketS` changes, render the old level's data scaled into the new pixels until the new visible fetches resolve. Bridge data may span a watermark fall-through transition (§4.3) silently — the client does not need to inspect the `source` field of a cached response to render it.

**Coverage is structural.** `tilesForViewport` takes an explicit `tileSpanMs` (= `currentBucketSMs × bucketCount`) and emits every grid-aligned tile overlapping `[viewport.start, viewport.end)` using a left-anchor strategy anchored at `TS_BUCKET_ORIGIN_MS`. Because the full displayed viewport is covered on every fetch-effect run, there is no incremental extension loop and no `ensureCovered`, `checkAndExtendXCoverage`, `panThresholdCheck`, or `getActiveRange` function — those functions and their callers were removed in the unified-tile refactor. Coverage gaps from pan or zoom-out cannot arise: the next fetch-effect run recomputes the full tile set from the current `modeViewport`. `TS_BUCKET_ORIGIN_MS`, `floorDiv`, and `ceilDiv` are defined in `level.ts` and used only there.

**`MAX_VISIBLE_TILES = 16` defense-in-depth cap.** Before allocating visible tiles, `tilesForViewport` estimates the visible-tile count. If the estimate exceeds `MAX_VISIBLE_TILES`, the function returns `{ visible: [], prefetch: [] }` with a `console.warn` and no fetch fires. Legitimate renders produce 2–4 visible tiles; the cap is set to 16 — well above the legitimate maximum and well below a tile-storm count (~1000+). This makes a tile storm structurally impossible even if the caller passes a mismatched (wide viewport, tiny `tileSpanMs`) pair.

> **Asymmetric overfetch.** `tilesForViewport` accepts optional `overfetchLeftCount` and `overfetchRightCount` parameters. When omitted they default to `overfetchPerSide` (default 1). The live-exit refetch passes `overfetchRightCount: 0` — 2 visible tiles + 1 left-prefetch, no right — because the user is panning backward in time and a right-side prefetch tile would cover a window range the user just left.

### 10.6 Live Tail Architecture

**One unified fetch pipeline.** Live and history mode share a single tile-fetch pipeline (`runTileFetch`). There is no separate "live-spine" path. In every mode `useTrendData` computes the required tile set with `tilesForViewport` and fetches the tiles that need fetching; `activeTilesRef` is the single on-screen tile set. Live mode differs only in `overfetchRightCount: 0` (the live edge is the newest data — nothing to prefetch to the right) and in the live branch of the freshness predicate.

**Terminal-cache rule.** A tile is written to the LRU cache **iff it is terminal** — its data fully covers the tile's range (`committedThroughTs >= tile.endTime`). A tile whose right edge extends past the server's latest data (`committedThroughTs < tile.endTime`) — the live-edge tile always is one — is **non-terminal**: it is held only in `activeTilesRef`, with its fetched data in `entry.data`, and is never cached. A tile fetched while its right portion was still empty therefore can never be frozen in the LRU with stale CAG-lag nulls. When a non-terminal tile later rolls fully into the past it is refetched once more and the now-terminal response is cached. This rule is what the old cache-bypass-for-live and eviction-on-live-entry mechanisms existed to approximate; it replaces both.

**`ActiveTileEntry`.** Each entry is `{ tile, committedThroughTs, shape, data }`. `committedThroughTs` is the `DbPipeline` watermark from the response (`null` until the fetch resolves); `shape` is `'raw' | 'aggregate'`; `data` holds the assembled `TrendData` for a non-terminal tile and is `null` for a terminal tile (whose data lives in the LRU).

**Freshness predicate.** A single predicate (`needsFetch`) decides whether a tile needs a network fetch: when no cache entry covers it; or its active entry has not resolved (`committedThroughTs === null`); or it has rolled `REFETCH_LAG_MS` into the past (refetch once more to obtain a terminal, cacheable copy); or — in history mode — its `committedThroughTs` is short of the viewport end. In live mode the predicate returns `false` unconditionally — the WS tail handles the live-edge tile in steady state; `invalidateNonTerminalTiles` handles Fixed→Live transitions by resetting non-terminal entries to trigger an immediate re-fetch; and `REFETCH_LAG_MS` handles tiles that have rolled into the past. There is no `spanChanged` guard, no skip guard, and no `isTailing` branch.

**`useLiveSubscription` — the WS live tail.** `useLiveSubscription` owns the dedicated trend WS channel (§4.4) and three per-tag structures: a **ring** (`TREND_RING_CAPACITY = 20` entries) that buffers raw WS samples and fills in *every* mode; a **bucket accumulator** (aggregate mode) that closes buckets on `bucketSMs` boundaries, emitting `{ ts, value, min, max, null_count }` per the server's three-case rule (§6.5); and a **raw buffer** (raw mode) of `{ moduleTs, value }` pairs trimmed to `2 × viewportSpanMs` of wall-clock coverage. The accumulator / raw buffer produce the `LiveTail` (`AggregateTail | RawTail | null`). Subscription lifecycle is keyed on tag-list membership and chart mount, not on mode — subscriptions stay warm across all transitions. Bucketing is gated on `isLive(mode)`; in `fixed` mode the ring still fills but no `LiveTail` is produced. On re-entry to Live the accumulator/raw buffer is reseeded from the ring, so a brief excursion through `fixed` does not lose tail history.

**`latestSampleTs` semantics.** `latestSampleTs = max(sessionHighWaterMark, currentMaxAcrossSubscribedTags)`. `sessionHighWaterMark` records the highest `moduleTs` observed since Live entry, bumped on every WS sample. It returns `null` only before the first `TREND_DELTA` arrives in a session, and is monotonic-non-decreasing for the session lifetime — the high-water-mark floor prevents regression when the max-providing tag is removed. Synthetic-on-flush events (§4.4) advance every subscribed tag's `moduleTs` at `TREND_FLUSH_HZ`, so `latestSampleTs` tracks `~now` regardless of per-tag write cadence. `drainBuffers` resets `sessionHighWaterMark`.

**Merge at render.** `TrendChartContainer` computes `mergedData = mergeTrendData(assembledTileData, liveSub.tail, { seamCommittedThroughTs })` in a single `useMemo` — there is no live-vs-history split. The merge applies the unified coverage rule: the live tail wins on its coverage range, nulls included; at the **seam bucket** (the bucket containing the tile's `committedThroughTs`) the tile and accumulator `min`/`max` are combined — `min = min(tile, accumulator)`, `max = max(tile, accumulator)` — so the boundary bucket keeps its true envelope across both partial sources. Raw mode drops cached samples at or after the tail's first timestamp and appends the tail.

**`totalN` cap at the live-edge seam.** During the ~1-bucket window before the WS accumulator closes its first bucket in a new tile's range, `liveStartIndex` is negative (the tail started before the tile's left edge) and `liveEndIndex ≤ seamBucketIndex`. Without a cap, `totalN = liveEndIndex + 1` can extend past the cached tile's actual data coverage, producing null future-coverage buckets that render as a white gap. When `liveStartIndex < 0 && seamBucketIndex >= 0 && liveEndIndex <= seamBucketIndex`, `totalN` is capped at `seamBucketIndex`. This closes the transient white-gap window at the live-edge tile boundary.

**Negative `liveStartIndex` guard.** `effectiveCachedN` (the clip boundary applied to cached data) is gated by `liveStartIndex >= 0`. When `live.startMs < cached.startTime` (i.e. `liveStartIndex < 0`), the live tail started before the cached tile's left edge — cached data outside live's actual output coverage is preserved. The `li >= 0` guard in the inner merge loop already drops live buckets whose output index would be negative, so the coverage rule is maintained without double-counting.

**Live-mode heartbeat.** While `isLive(mode)` is true, `useTrendData` runs a 2 s heartbeat that re-evaluates the freshness predicate. This keeps the live-edge tile refetching when the viewport is pinned (`live-fixed`) and no viewport change is firing the fetch effect.

**`tick` dispatch.** `TrendChartContainer.handleDataReceived` guards on `isLive(modeStateRef.current.mode)` before dispatching `tick { nowMs: maxModuleTs }` — keeps the viewport advancing in both `live-trailing` and `live-fixed` (the latter for auto-promote checks) without affecting `fixed` mode.

**`dispatchModeAction` wrapper.** `TrendChartContainer` wraps mode transitions in `dispatchModeAction`. It applies two conditional side effects before dispatching:
- **Live → fixed** (`isLive(prev) && !isLive(next)`): calls `drainBuffers()` to clear the accumulator, raw buffers, and session high-water mark. The ring is not cleared.
- **Fixed → live** (`!isLive(prev) && isLive(next)`): calls `trendData.invalidateNonTerminalTiles()` to reset `committedThroughTs` to `null` on non-terminal active entries, forcing an immediate re-fetch with a fresh watermark. Terminal LRU entries are untouched.

There is no `evictAll`, no `refetchHistory`, no `commitAndDrain`, and no generation counter: the LRU never needs wholesale eviction because the terminal-cache rule keeps non-terminal data out of it, and stale in-flight fetches are discarded by a run-independent resolve flow (a tag-generation counter that bumps only on a `tagIds` change).

### 10.7 Subscription Lifecycle

`useLiveSubscription` manages subscription by tracking `tagIds` and chart mount only. The subscribe-lifecycle effect re-runs on tag-list changes and on `subscribeTrend` identity changes. It does **not** re-run on mode flip — the WS subscription stays warm across all three mode states.

**Add tag (any mode).** All `tagIds` mutations in `TrendChartContainer` route through `commitTagIds`, which calls `invalidateNonTerminalTiles()` before `setTagIds()`. This resets the live-edge tile's `committedThroughTs` to `null` so that after the tag list changes, `needsFetch` treats the seam tile as unresolved and refetches it — preventing a merge-seam gap where the new tag's data is stitched onto a stale `committedThroughTs`. After `setTagIds`, `useLiveSubscription`'s effect fires on the next render and sends `SUBSCRIBE_TREND` for the new tag. Ring entries for removed tags are pruned at the start of the new effect body. In Live mode, samples arriving on the WS before the REST tile lands are held in the ring and accumulated into the buffer.

**Remove tag (any mode).** `commitTagIds` calls `invalidateNonTerminalTiles()` before `setTagIds` (same seam-gap prevention as Add tag). Cleanup unsubscribes the per-tag callback. When that's the last callback for the tag, `HmiContextProvider` sends `UNSUBSCRIBE_TREND` to the server.

**Any Live → fixed.** `drainBuffers()` clears the bucket accumulator, raw buffers, and `sessionHighWaterMark`. It does **not** clear the ring — the ring keeps filling in fixed mode and seeds the accumulator on Live re-entry. **Subscriptions are not touched** — they stay open across all modes. Bucketing is suppressed via the `isLive(mode)` guard inside the subscribe callback; in fixed mode only the ring-append + microtask scheduling happens (the ring is bounded by `TREND_RING_CAPACITY = 20` per tag).

**Fixed → live-*.** `dispatchModeAction` calls `invalidateNonTerminalTiles()` before dispatching — no teardown, no eviction (see §10.8). Non-terminal active entries have their `committedThroughTs` reset to `null`; terminal LRU entries are untouched. The `isLive(mode)` predicate widens to `true`, enabling bucket accumulation; the accumulator is reseeded from the ring. On the next heartbeat or viewport change, `needsFetch` sees the reset entries as unresolved and refetches them with a fresh watermark. Tile fetches fire through the unified pipeline (§10.6).

**Internal live-trailing ↔ live-fixed flips.** No teardown, no subscription change. Buffer preserved. Bucketing continues uninterrupted. `isLiveRef` remains `true` in both Live states.

**Chart unmount.** Effect cleanup unsubscribes all current tags. Last-callback-per-tag triggers `UNSUBSCRIBE_TREND`.

### 10.8 Cache Freshness on Mode Transition

Cache freshness is **structural**, not maintained by eviction. The terminal-cache rule (§10.6) admits a tile to the LRU only once its data fully covers its range (`committedThroughTs >= tile.endTime`). A non-terminal tile — one whose right edge is still inside the live region, where the server is still returning future-nulled or not-yet-materialized buckets — is never cached; it lives only in `activeTilesRef`. CAG-lag nulls and partially-covered live-edge data therefore can never be frozen into the LRU, within a session or across sessions.

There is consequently **no `evictAll`** and no eviction-on-mode-transition. The earlier architecture cleared the entire cache on every Live entry to prevent cross-session frozen nulls ("Gap B"); the terminal-cache rule removes the failure mode that eviction guarded against, so the eviction is gone. A non-terminal tile is refetched once it has rolled `REFETCH_LAG_MS` into the past, and only that terminal response is written to the cache.

The right-edge writer-lag window (`TIMESCALE_DB_TICK_MS` ≈ 500 ms plus FIFO trim tolerance) is covered by the live tail: the WS accumulator carries data right up to `latestSampleTs`, and `mergeTrendData` stitches it onto the cached/non-terminal tile at the seam bucket (§10.6). After a live→fixed transition the newly-fixed viewport shows the line trailing off naturally at `committedThroughTs`, with no null band.

---

## 11. Tag Picker

### 11.1 Entry Point

Gear icon in the Legend's `<thead><th colSpan={5} scope="colgroup">` header row opens a modal. The modal closes via:
- **OK button** — commits the staged set to `setTagIds`.
- **Cancel button**, **Esc key**, or **click outside** — discards staged changes silently.

The chart remains visible during picking: the modal is sized to content (not full-screen), preserving the original chart-visible-while-picking rationale without a side-panel layout.

### 11.2 Browse Model

Flat alphabetical list of trendable tags in the left pane. Tags are sorted by `tag_name` (fallback `Tag-<id>` when `tag_name` is null). A search box above the list filters by case-insensitive substring match on `tag_name`.

There is no tree view, no expand/collapse state, and no filter auto-expand.

### 11.3 Selection Model

- **Click an available tag** in the left pane to stage it. It appears in the right (Trending) pane in insertion order.
- **Click × in the right pane** to unstage a tag.
- **Already-staged tags** in the left pane render bold and tinted; clicking them is a no-op.
- **OK** commits the staged set via `commitTagIds` (which calls `invalidateNonTerminalTiles()` before `setTagIds` — see §10.7) and closes the modal.
- **Cancel / Esc / click outside** closes without committing.

This supersedes the checkbox multi-select + "Add N tags" commit model. Selection is immediate (click → staged) rather than accumulated-then-committed.

### 11.4 Trendable Filter

Non-trendable tags (`tag.trendable === false`) are filtered out of the left pane entirely. The picker reads `tag.trendable` directly off the `tagMap`; no separate endpoint fetch. The "N matching tags are not trendable" footer hint is not implemented.

### 11.5 Modal Sizing

Both panes share the same computed width: `max(MIN_PANE_PX, ceil(longestTagNameLen × FONT_WIDTH_PX) + PANE_PADDING_PX)`, memoised off `availableTags` (not the filtered list) so search does not change pane widths. Outer wrapper width = `paneWidth × 2 + PANE_GAP_PX`. Height pinned at `calc(90vh - 8rem)` so the modal does not shrink when search narrows the list.

Modal chrome uses inline styles on `@caro/ui Modal` (`outerStyle` / `headerStyle` / `bodyStyle`) — consistent with `@caro/trend-chart`'s inline-style-pure convention.

### 11.6 Cap

The staged set is capped at 16 tags. The 17th add attempt shows an inline error; removing a tag clears it. The chart UX cap (maximum plotted tags) remains 20, per §2 / §6.6 fan-out math.

---

## 12. Time Range UX

### 12.1 Preset Buttons

Eight presets in a horizontal strip: **1m · 5m · 15m · 1h · 4h · 24h · 7d · 14d**. Click on a preset:

- **From `fixed`:** stays `fixed`. Preserves `to`; re-anchors `from = to - preset duration`. No Live entry.
- **From `live-*` (either Live state):** enters `live-trailing` with the new preset's `sizeMs`. `isLive` stays true, so no teardown fires; the viewport re-anchors to the live edge and the fetch effect refetches tiles for the new span. When the preset changes `bucketSMs` or dispatch shape (e.g., 1m raw → 24h aggregate) the new span produces a fresh tile set and the live accumulator re-buckets at the new `bucketSMs`, reseeded from the ring.

The active preset is highlighted when `lastIntent !== null && lastIntent !== 'zoom' && sizeMs === preset.sizeMs`.

**Same-preset re-click in `live-trailing`** still performs the full teardown (no short-circuit). Consistent behavior simplifies the implementation and the operator mental model.

### 12.2 End Picker

> **Implementation note (v1.0):** The original `from`/`to` Custom picker was replaced by an End-only picker. The `from` field was removed — `from` is always derived as `to - sizeMs`. This keeps `sizeMs` stable (same span, just a different anchor point) and removes the need to track two independent datetime fields.

A styled button in the footer displays the current End time (formatted in site-local wall time). Clicking the button opens the browser's native `<input type="datetime-local">` popup. Committing applies the **symmetric window-vs-live-edge rule** (§9.3):

- **From any state, `to > latestSampleTs`** → enters `live-fixed`. WS stays active; viewport is pinned with the picked End. No teardown.
- **From any state, `to <= latestSampleTs`** → enters `fixed`. `drainBuffers` clears the live tail; the fetch effect refetches tiles for the historical viewport.

The rule is uniform: `endPickerCommitted` from `fixed` with a future End (`to > latestSampleTs`) enters `live-fixed`, exactly as it does from a Live state. In `fixed` mode the WS ring keeps filling, so `latestSampleTs` is a real value, not `null`; the `classifyByWindow` fallback (`state.to` when `latestSampleTs` is unavailable) preserves the same outcome.

This supersedes the original D6 asymmetry in the proposal: `endPickerCommitted` from `fixed` with a future-end now **enters `live-fixed`** rather than staying `fixed`. The operator must be watching live data to be in a Live state when picking a future end — deliberate historical navigation from `fixed` is still handled by the `to <= modeViewport.end` path going to `fixed`.

`from = to - sizeMs` (current span preserved) for all non-Live outcomes. Invalid or too-short input is a no-op (display snaps back to the prior End value); specifically, the reducer also rejects `to < 2n` outright as a self-consistency guard against sub-1-ms spans (the EndPicker UI prevents this in practice, but the reducer is defensive). The display re-syncs from `viewport.end` whenever the viewport changes.

> **Implementation note (v1.0):** The picker is implemented as a styled `<button>` that overlays a hidden `<input type="datetime-local">` positioned behind it (opacity 0, pointer-events none). Clicking the button calls `input.showPicker()` to open the browser's native date/time popup anchored at the button. This avoids styling the native picker chrome while keeping keyboard and accessibility behavior on the real input element. String values produced by the input are interpreted as site-local wall time using `siteTimezone` prop via `Intl.DateTimeFormat`. Falls back to browser-local time when `siteTimezone` is absent.

### 12.3 Live Button

The Live button has three visual states, driven by mode and `liveEdgeBehindWindow`:

| Mode | `latestSampleTs` vs viewport | Visual | Click behavior |
|---|---|---|---|
| `fixed` | n/a | Default ("Go Live") | `liveClicked` → `live-trailing` |
| `live-trailing` | n/a | Highlighted ("Live") | Disabled / no-op |
| `live-fixed` | `latestSampleTs >= state.from` | Highlighted ("Live") | `liveClicked` → `live-trailing` |
| `live-fixed` | `latestSampleTs < state.from` | **Orange** | `liveClicked` → `live-trailing` |

The orange state signals "live edge is off-screen to the left" — the current viewport has panned entirely past the live data edge and the chart is blank or near-blank. Orange is the affordance for this state: click to snap back to `live-trailing`. No tooltip is shown (per design decision D10).

Click in the highlighted or orange state (both Live states): dispatches `liveClicked`, which re-anchors the viewport to the live edge and snaps to `live-trailing`, keeping the current `sizeMs`. No teardown fires — `isLive` stays true across the re-anchor, so the live tail and ring are preserved; the fetch effect refetches tiles for the re-anchored viewport.

`liveEdgeBehindWindow` is derived in `TrendChartContainer` as `latestSampleTs !== null && latestSampleTs < modeState.from` and passed to `EndPicker` as a prop.

### 12.4 Return-to-Live-Trailing Paths

From `fixed` mode, the **only** path to any Live state is clicking the Live button (`liveClicked`). From `live-fixed`, the paths to `live-trailing` are: clicking the Live/orange button (`liveClicked`), auto-promote via `tick` when `latestSampleTs >= viewport.to`, or `presetClicked`.

End picker commits from `live-*` with a future end enter `live-fixed` (not `live-trailing`). Pan always produces `fixed` or `live-fixed`, never `live-trailing` directly. Zoom from any state always → `fixed`.

There is no explicit Pause or Resume control. Panning the chart backward (within Live) is the implicit "view history while staying live"; clicking the orange/Live button is the implicit "snap back to now."

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
- `live-fixed` pan-right offset — `live-fixed` is treated as transient interaction state. The Save action snaps to `live-trailing` (persisted as `tailing=true`, no viewport). The relative offset from `latestSampleTs` at save time has no clear meaning at replay time when `latestSampleTs` has advanced. Optional UX note for Phase B implementation: surface a small notice when the operator saves while in `live-fixed` ("Saved as Live; current buffer offset isn't preserved").

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

No saved default view. The mode state machine initializes in `live-trailing` (see §9.3 and `useTrendMode.ts`). When `tagIds.length === 0` — first-time open or after all tags are removed — the chart renders its **full layout unchanged**: a blank plot area at normal height, the Legend strip with the Signals header and gear icon, and the footer. The gear icon remains the sole entry point to the tag picker modal (see §11); there is no separate "Add tags" button. Once tags are added via the modal, `live-trailing` is already the active mode and the chart begins tailing immediately.

### 13.6 Session Persistence

The trend viewer restores the operator's current view across HMI page navigation and full browser refreshes. This is distinct from Saved Views (§13.1–§13.4), which are user-named, optionally server-persisted, and capture a different subset of state.

**Scope of persisted state.** The following fields are written to storage on change and restored on mount:

- Tag list (`tagIds`)
- Per-tag Y-scale overrides (`yScaleOverrides`) — keyed by tag ID; min/max pairs
- Selected tag ID (`selectedTagId`)
- Viewport span (`sizeMs`) — a BigInt stored as a decimal string
- Mode (`fixed` | `live-trailing` | `live-fixed`)
- Viewport end timestamp (`toMs`) — a BigInt as decimal string; present only for `fixed` and `live-fixed` modes

Colors are not persisted because `colorAssign(tagId)` is deterministic. Cursor position, hover state, picker-open state, and other transient UX state are not persisted.

**Storage.** Values are stored in `window.localStorage` under the key `caro.trend-viewer.session.${persistKey}`, where `persistKey` is an optional prop on `TrendChartContainer`. When the prop is absent, persistence is off entirely — no reads and no writes are performed. This opt-in design prevents future embedded mini-chart instances from inheriting persistence behaviour they do not expect.

**Schema.** The stored value is JSON-encoded and schema-versioned. The current schema is V1 (`version: 1`). Parse failures, unknown version numbers, and quota or access exceptions (e.g. Safari private browsing, storage full) all fail silently: the session is discarded and the chart initialises from its default state, with a `console.warn` for developer diagnostics.

**Write cadence.** The container writes a debounced save (approximately 250 ms) whenever `tagIds`, mode state, `selectedTagId`, or Y-scale overrides change. Any pending write is flushed synchronously on container unmount.

**Hydration reconciliation.** On mount, after a valid session is loaded from storage:

- `tagIds` are filtered against the current trendable tag set. Any stored tag ID that is no longer trendable (or no longer exists in the registry) is silently dropped. If filtering leaves the list empty, the chart starts with `tagIds = []` rather than falling back to the `tagIds` prop.
- `mode === 'live-fixed'` with `Date.now() >= Number(toMs)`: the saved viewport end has passed, so the mode is promoted to `live-trailing` with the saved `sizeMs`; `toMs` is discarded.
- `mode === 'fixed'`: viewport is reconstructed as `from = toMs − sizeMs`, `to = toMs`.
- `mode === 'live-trailing'`: only `sizeMs` is restored; the viewport rolls from the live edge.

**Relationship to Saved Views.** Session persistence is the always-on, single-key, browser-local restoration of the operator's working view. Saved Views (Phase B, §13.1–§13.4) are user-named, server-persisted, and capture a different field subset — notably they do not include Y-scale overrides (§13.1). The two mechanisms coexist: loading a Saved View updates the in-memory state and the updated state becomes the next persisted session on the following debounced write.

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

### 14.4 WebSocket Disconnect

Tail stops advancing. The gap between disconnect time and reconnect time renders as nulls. Client auto-reconnects with exponential backoff (500 ms → 1 s → 2 s → 4 s → 8 s cap, forever **while the chart has active subscriptions** — not only while in Live mode). On reconnect, subscription resumes normally. `console.warn` on disconnect, `console.info` on reconnect including the disconnect duration:

```
[trend-chart] WS reconnected after 8.3s, gap visible in chart
```

No bridge-fetch on reconnect. If the operator wants the real data in the gap, any pan/zoom triggers a REST refetch that fills it in. A long disconnect while in `live-fixed` may trigger auto-promote to `live-trailing` via `tick` when `latestSampleTs` catches up — this is an acceptable consequence of the design, not a special case.

### 14.5 Retention Clamping

No client UI. `console.info` when the client submits a range request whose `endTime` falls before `now - 14d`. The DB returns what it has; the client renders gaps for buckets older than retention.

### 14.6 Summary

| Condition | Operator sees | Developer sees |
|---|---|---|
| Initial load | Skeleton + progress bar | — |
| Re-fetch | No indicator | `console.warn` if >500 ms |
| Fetch failure | Gap (null span) | `console.error` with tile key |
| WS disconnect | Gap, tail frozen | `console.warn` |
| WS reconnect | Tail resumes | `console.info` |
| Retention edge | Gap at left edge | `console.info` |
| Every range fetch | — | `console.info` with `start`, `end`, `bucket_count`, `tag_count`, `rows`, `elapsed_ms` (§14.7) |

### 14.7 Performance Observability

End-to-end tile latency is the key signal for monitoring CAG-path health in production and deciding whether the 10min CAG's worst-case operating point (Div ≈ 24.58 at 85+ d windows, §6.3) needs an additional CAG layer (§17.2).

**Client-side (primary).** `useTrendData` brackets each `fetch()` call with `performance.now()` and logs one structured line on response:

```
[trend-chart] tile fetched  start=1776864000000  end=1776864480000  bucket_count=250  tag_count=8  rows=250  elapsed_ms=42
```

Captures DB + server + network + JSON parse — closest to what the operator experiences. Always on. The existing §14.2 threshold (`console.warn` on fetches >500 ms) stays.

**Server-side (secondary, opt-in).** `getTrendTile()` in `@caro/db` logs one summary line per request at function exit, gated by env var `TIMESCALE_LOG_TILE_QUERIES=1` (default off):

```
[db] getTrendTile start=1776864000000 end=1776864480000 bucket_count=250 source=tag_samples_1s_cagg tag_count=8 rows=250 db_elapsed_ms=28.5
```

Fields read directly from `meta` (§4.1): `source` is `meta.finalSource` (one of `raw`, `tag_samples`, `1s_cagg`/`10s_cagg`/`1min_cagg`/`10min_cagg`, or `mixed` for watermark fall-through); `rows` is `meta.rows`; `db_elapsed_ms` is `meta.totalDbElapsedMs.toFixed(1)`. Used for attribution ("is the slow request DB, network, or a watermark fall-through?") when a client-side warning points to a specific request. Off by default to avoid log spam in normal operation.

The per-segment debug log inside `querySegment` / `queryRaw` is retained as verbose mode under the same env gate — when enabled, both per-segment lines AND the summary line fire together, giving operators both granularities at once for diagnosis. The per-segment raw-path line includes a `prev=N` field counting how many of the requested tags found a bounded-prev sample in the 5-minute pre-window (matches the per-tag `series[i].prev` count in the response).

**Latency budget.** A `bucket_s` operating point exceeds budget when its client-observed p95 latency consistently exceeds **300 ms** during realistic operator usage. The decision to add a new CAG layer (or to re-tune the dispatch ranges in §6.3) is made by a human eyeballing the console — no automated aggregation in MVP. 300 ms leaves room above pan debounce (~100 ms) plus chart repaint (~16 ms) for tile arrival to still feel instant; above that, operators start to perceive lag. The threshold is a rule of thumb, not a hard gate.

**Not tracked in MVP.** Per-bucket-size rolling p95 as a `Trend_Info` tag, `trend_query_perf` table, automated alerts. These are re-openable if console eyeballing becomes painful.

---

## 15. Multi-Client Behavior

Every HMI client instance is fully independent:

- **Tile cache** is in-memory per browser. Two clients fetching overlapping windows maintain separate caches.
- **WebSocket subscription.** Each client opens its own WS connection to the HMI server. Existing infrastructure (`@caro/hmi-context`) handles N concurrent clients.
- **REST endpoint.** Stateless. Every request is self-contained `(tag_ids, start_time, end_time, bucket_count)` and the response is a deterministic function of those inputs. Identical requests from different clients are cacheable at any shared layer (query cache, future server LRU). Scales with normal web concerns.
- **Chart state** (mode, window, selected trace, zoom) lives in client-local `TrendChartContainer`. No cross-client synchronization.

**Server-side load with CAG dispatch.** With four CAGs serving the bulk of operating windows, per-range DB cost is materially lower than v0.3's on-the-fly design (measured 2.21× CAG-vs-raw speedup on cag-compressed paths, `DB_Config_Usage_And_Perf.md` §7.2). Each range is still a single grouped query (`WHERE tag_id = ANY($1)`) capped at N ≤ 8 tags per query. TimescaleDB's query cache absorbs identical repeated requests from different clients. A server-side LRU keyed on `(tag_ids, start_time, end_time, bucket_count, watermark_ts)` is a natural future optimization if needed.

**Connection pool demand.** Per-operator outbound DB demand:

- Per active window: `visibleTilesPerWindow × ⌈N/8⌉` connections during fetch (e.g., 4 connections for a 16-tag chart with `visibleTilesPerWindow=2`).
- Plus prefetch tiles asynchronously (`overfetchPerSide=1` per side).
- Multiplied by concurrent operators.

The `@caro/db` Timescale pool's `max` is a configurable parameter; current default and any pending re-tuning live in `Docs/platform_todo.md`. Empirical perf-page testing has not surfaced the pool as a bottleneck (`platform_todo.md` watchlist entry); sizing methodology in `Docs/DB_Config_Usage_And_Perf.md §10.5` if a measurement campaign becomes warranted. If pool capacity becomes the actual bottleneck, `visibleTilesPerWindow` is a relief-valve knob — perf gates cover both 2-tile and 4-tile configurations.

Saved views are server-persisted and user-scoped. Two clients signed in as the same user share personal views; a save on one is visible on the other on next read. Last-write-wins on concurrent edits.

---

## 16. Testing Strategy

### 16.1 Server Unit Tests (Vitest)

- `/api/v1/trends/tile` handler: request validation (`tag_ids` count 1–8; `end_time > start_time`, both positive; `bucket_count` in 1..2500), envelope format, raw vs aggregate response shape, error cases (`INVALID_TAG_IDS`, `INVALID_RANGE`, `INVALID_BUCKET_COUNT`, `INVALID_BUCKET_S`). `INVALID_BUCKET_S` originates from the DB layer (bucketed path only) — the route no longer derives or validates `bucketS`.
- `getTrendTile` dispatch: `bucket_s < 1.0` → raw; `< 16` → 1s CAG; `< 160` → 10s CAG; `< 1600` → 1min CAG; else → 10min CAG (§6.3); watermark-split path (§4.3); argument validation; N ≤ 8 enforcement; aligned requests return `n === bucketCount`; unaligned requests return `n === bucketCount + 1` with response `startTime`/`endTime` reflecting the served bucket grid (§6.2)
- `TrendSnapshotScheduler`: existing tests; spec relies on its 1-min cadence guarantee but does not introduce a new component for it

### 16.2 Server Integration Tests (Real TimescaleDB)

This is the highest-value test layer. The null-as-gap contract and the bounded `prev` correctness live here and are hard to get right.

- `T001_create_tag_samples.sql` applies cleanly on empty DB
- All four CAG migrations apply cleanly on empty DB and produce the four expected `tag_samples_*_cagg` views with materialized `last`, `null_count`, `min`, `max`
- `writeTagSamples` round-trip: write → read via raw tile → observe sample
- Bounded `prev` query (§5.5): plan inspection confirms ≤ 2 chunks in the `prev` SubPlan ChunkAppend; planning time < 5 ms
- Bucket queries at each `bucket_s` level (representative samples in the cheap zone of each CAG) return correct `time_bucket_gapfill` + `locf` results over per-test samples written via `writeTestSamples()` covering known null rows and flatlines (§16.5)
- Watermark-aware fall-through (§4.3): write samples past a CAG's watermark → tile request spanning the watermark returns continuous data (CAG portion + raw fall-through portion stitched correctly)
- Server correctly emits `null` in the bucket's `value` when `null_count > 0` for that bucket
- End-to-end: POST samples via DbPipeline → GET `/api/v1/trends/tile` at raw and each aggregate level → shapes and null placement match expectations

### 16.3 Client Unit Tests (Vitest + jsdom)

- `tileCache`: LRU eviction, cache key derivation `(tagId, startTime, endTime, bucketCount)`, size accounting, 50 MB cap
- `level.ts`: trend viewer client policy — `windowSec → bucketS = windowSec / (2 × 500)`; `tileSpanMs = 500 × bucketS × 1000`; `(from, to, bucketS) → [startTime, endTime]` epoch-aligned pairs for each visible range and prefetch; cheap-zone validation (`bucketS` clamped to keep Div ≤ 16 within each CAG band, §6.3)
- `useTrendData`: range-aligned fetch math, 2-visible + prefetch parallel fan-out, ⌈N/8⌉ tag-group fan-out, overfetch boundaries, `bucketS` transitions across §6.3 thresholds, stitch at `committedThroughTs`
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

**Database (TimescaleDB)**

- T005 1s CAG re-migration: replace `count` with `null_count`; align chunk interval (24h), refresh interval (1 min), compression-after (1h) per `DB_Config_Usage_And_Perf.md` §3. **Top priority — blocks everything else.** See Open Questions §18 and `Docs/platform_todo.md`.
- New CAG migrations for 10s, 1min, 10min CAGs — same shape (`last`, `null_count`, `min`, `max`), retention per `DB_Config_Usage_And_Perf.md` §3.1
- `cagg_refresh_policy` for each CAG (1-min cadence)

**Server**

- `GET /api/v1/trends/tile` endpoint — range-based, stateless, validates N ≤ 8, validates `(tag_ids, start_time, end_time, bucket_count)` per §6.1, derives and validates `bucketS`
- Single `getTrendTile(tagIds, startTime, endTime, bucketCount)` entry point in `@caro/db`, derives `bucketS` internally and dispatches per §6.3 (raw / 1s CAG / 10s CAG / 1min CAG / 10min CAG with outer `time_bucket`)
- Bounded `prev` SQL pattern (§5.5) — mandatory in every path
- Watermark-aware fall-through (§4.3) — mandatory before the API is exposed to Live mode
- Server-side `null_count > 0 → null` merge for aggregate levels
- `TrendSnapshotScheduler` is **already in production** — no new component needed; spec relies on its 1-min cadence guarantee

**Client**

- `packages/trend-chart/` single-package
- Trend viewer client locks `bucketCount` to 500; computes `bucketS = windowSec / (2 × 500)` and derives epoch-aligned `(startTime, endTime)` pairs per §10 (Trend viewer client policy)
- 2 visible + 1 prefetch-per-side parallel fetch per window (`Promise.all`), ⌈N/8⌉ tag-group fan-out for charts > 8 tags (§10.2, §10.4)
- `TrendChart` component: single chart, up to 20 overlay traces, single Y axis tied to selected trace
- Tile cache keyed by `(tagId, startTime, endTime, bucketCount)`, 500-bucket ranges, LRU at 50 MB
- Live / fixed modes with implicit transitions
- Preset buttons + custom range + Live button
- Tag picker modal (flat trendable-tag list + Trending list; click-to-stage, search filter, 16-tag cap)
- Legend (name, color, current value, click to select trace, remove button)
- Cursor time in Legend strip (`Cursor:` field, site-timezone formatted); per-tag value at the cursor already in Legend rows (§8.5). A separate floating cursor overlay is Phase B.
- Null-as-gap rendering (uPlot `spanGaps: false`)
- WebSocket live tail with gap-on-disconnect, silent resume on reconnect
- Client-side bucket accumulator for live tail stitching at the active `bucket_s`
- Failed fetch → null span + `console.error`
- Resolution indicator in header
- Per-tile perf logging (client `console.info` always on; server logging gated by `TIMESCALE_LOG_TILE_QUERIES`, §14.7)

**Testing**

- Server unit + integration tests (16.1, 16.2) — including bounded `prev` plan inspection and watermark fall-through stitching
- Client unit tests for cache, bucket-size math, and hooks (16.3)

### 17.1.1 Phase A Build Order (Recommended)

Non-binding, but each step is landable independently and its tests pass in isolation. Dependency order minimizes the amount of code that sits un-exercised before the next layer is built. The CAG and bounded-`prev` work has been pulled to the front because everything downstream depends on it.

| # | Step | Builds on | Proves |
|---|---|---|---|
| 1 | **T005 1s CAG re-migration.** New Timescale migration replacing `count` with `null_count` (`count(*) FILTER (WHERE value IS NULL)`), aligning chunk interval (12h → 24h), refresh (30s → 1 min), compression-after (12h → 1h). Drop and recreate the CAG; bridge the rename if any code references `count`. Integration test confirms the materialized view exposes the four-column shape (`last`, `null_count`, `min`, `max`). | existing T005 + `Docs/DB_Config_Usage_And_Perf.md` §3 | null-as-gap contract on the CAG path; spec compliance |
| 2 | **`@caro/db` raw path** with bounded `prev`: `getTrendTile()` for `bucket_s < 1.0` only. Plus `writeTestSamples()` / `resetTestRange()` helpers (§16.5). Integration test: write raw samples into the sandbox window, read back via `getTrendTile(..., 0.5, ...)`, assert shape, values, and `EXPLAIN` plan shows ≤ 2 chunks in the `prev` SubPlan. | 1, existing `@caro/db` Timescale infrastructure | DB round-trip, envelope shape, bounded-`prev` correctness, test sandbox pattern |
| 3 | **`@caro/db` 1s CAG path** with outer re-aggregation (`time_bucket(bucket_s)`) and bounded `prev` against the CAG. Integration tests covering null emission, flatline LOCF, and re-aggregation correctness for `bucket_s` values across the cheap zone (1.92, 4, 8, 14.4 s). | 1, 2 | CAG read shape, Div re-aggregation correctness, null contract on CAGs |
| 4 | **Watermark-aware fall-through** in `getTrendTile()`: split-and-stitch logic when `range_end > watermark_ts`. Integration test: write samples past the 1s CAG's watermark; tile request spanning watermark returns continuous data. | 3 | Live-edge correctness; mandatory before API exposes Live mode |
| 5 | **REST endpoint `/api/v1/trends/tile`**: thin handler, validation (`INVALID_TAG_IDS` count 1–8, `INVALID_RANGE`, `INVALID_BUCKET_COUNT`), envelope, perf log (§14.7). `INVALID_BUCKET_S` delegated to DB layer (bucketed path only). Unit tests for validation; integration test for end-to-end round-trip. | 4 | API surface, validation, perf observability |
| 6 | **Remaining CAG migrations** (10s, 1min, 10min) and dispatch branches in `getTrendTile()`. Integration tests for each. | 5 | Full §6.3 dispatch coverage |
| 7 | **`packages/trend-chart/` scaffold**: workspace package, `level.ts` (`alignedTilesInRange` primitive; `tilesForViewport` composite returning `{visible, prefetch}` with `bucketCount=500` / `visibleTilesPerWindow=2` / `overfetchPerSide=1` defaults; `deriveBucketSMs` helper), `tileCache.ts` (LRU keyed by `(tagId, startTime, endTime, bucketCount)`, 50 MB cap, generic byte-size accounting), `colorAssign.ts` (`schemeTableau10` cycled to 20 entries). Pure unit tests (41 passing), no React. | 5 (types only) | client-side range math, cache eviction, palette determinism |
| 8 | **`useTrendData` hook**: range-aligned fetch orchestration, 2-tile parallelism (visible) + 2 async prefetch tiles, ⌈N/8⌉ tag-group fan-out, single-tag exception for tag-add (§10.4), stale-generation guard. ✓ Done — 62 total passing at step completion. | 7 | fetch coordination, cache population, fan-out correctness |
| 9 | **`TrendChart` static rendering**: uPlot wrapper, `spanGaps: false`, stepped interpolation, per-trace Y-scale defaults (§8.1.1), Legend component with `unit` and cursor-time field (§8.4, §8.5), resolution indicator (§8.6). ✓ Done — 106 total passing in @caro/trend-chart. Pan/zoom and time-range controls deferred to Step 10. | 8 | render path, null-as-gap, color/legend/cursor-time |
| 10 | **Mode state machine + time range UI**: live/fixed transitions (§9.3), preset strip (§12.1), custom range picker (§12.2), Live button (§12.3), pan/zoom interactions (§9.1–9.2). Still no WS. ✓ Done. | 9 | interaction model, mode correctness |
| A.5 | **v0.8 min/max bands (feature/trends-min-max-bands).** DB aggregate path returns `min`/`max` per series; three-case JS post-pass (§6.5); REST v0.8 serializes both arrays; `@caro/trend-chart` always-band 2-series render (§8.7); `bandsFromTrendData` helper; `bucketSMs === 0n` + `newStart >= 1n` defensive guards (§9.5); SpanBucketIndicator `lastFetchMs` / Last Fetch line. ✓ Done — `@caro/db` 102 passing, HMI server 233 passing, `@caro/trend-chart` 424 passing. | 1–10 | full band pipeline, defensive guards |
| 11 | **Live tail**: dedicated trend WS channel (`SUBSCRIBE_TREND`/`UNSUBSCRIBE_TREND`/`TREND_DELTA`), `useLiveSubscription` hook (ring buffer + bucket accumulator for aggregate; raw buffer for raw mode; 2×viewportSpanMs trim; `commitAndDrain` returns void), unified `mergeTrendData` (live-wins-on-coverage, `isLive(mode)` predicate replaces old `isTailing` boolean), `isLive`-gated tile-fetch suppression in `useTrendData`, eviction-on-live-entry cache freshness (`evictAll` on fixed→live-*, eliminates Gap B), server-side future-bucket nulling in `getTrendTile`, no-clamp wheel-zoom + `gatedFetchTile` over-range gating + inline "Range too wide" message in `CursorDisplay`, `dispatchModeAction` wrapper for atomic live-exit cleanup. ✓ Done — 583 `@caro/trend-chart` + 67 `@caro/hmi-context` tests passing. | 10 | live stitching, subscription correctness, mode-transition cleanup, over-range UX |
| 12 | **Tag picker modal**: gear icon in Legend `<thead><th>` opens modal; flat trendable-tag list (§11.2); click-to-stage, × to unstage (§11.3); trendable filter (§11.4); modal sizing (§11.5); 16-tag stage cap (§11.6). ✓ Done — 770 `@caro/trend-chart` tests passing. | 11 | picker UX, trendable filtering |

> **Note (post-Phase-A).** The fetch and live-tail architecture delivered in Steps 8 and 11 was subsequently unified: the separate live-spine and history-tile fetch paths were replaced by a single tile pipeline (`runTileFetch`) governed by the terminal-cache rule. The current architecture is §10.6; the Step 8 / 11 rows above record the original build sequence, not the present design.

**Landable checkpoints.** Step 1 unblocks every CAG-touching step downstream. Step 5 gives you a working API with no UI — demoable via curl. Step 9 gives you a working historical chart — demoable with a hardcoded tag list. Step 11 gives you live tail. Step 12 completes the operator-facing Phase A surface.

**Skippable-but-discouraged reorderings.** Step 1 must come before any CAG-touching step (3, 4, 6). Steps 7–9 can be built in parallel with the server work past step 5 (only types are shared).

**Operational monitoring** (separate from build steps): NULL `prev` rate per `DB_Config_Usage_And_Perf.md §8.1`, per-CAG latency dashboards, and pool-utilization monitoring are all tracked in `Docs/platform_todo.md`. None are development blockers.

### 17.2 Phase B — v1.1 (After MVP)

Backlog items currently parked. Operational/observability watchlist items (pool sizing, perf-log enhancement, EXPLAIN-plan gate) live in `Docs/platform_todo.md`.

- Saved views (personal only, `hmi_trend_views` table, dropdown UX)
- Additional CAG (e.g. hourly) if the 10min CAG's worst-case (Div ≈ 24.58 at 85+ d windows) measures over budget once that much history accumulates
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

Questions resolved during v0.1–v0.4 design:

| Question | Resolution |
|---|---|
| Multiple panels per tag, or overlay in one chart? | Overlay. Single chart, 20 traces (UX cap). |
| Dual Y axis or single? | Single, tied to selected trace. |
| uPlot vs Recharts vs Chart.js? | uPlot. Canvas rendering, minimal bundle, native stepped + gap support. |
| Return 6 fields per bucket or just `value`? | API returns `value` only in MVP. CAG storage materializes `last`, `null_count`, `min`, `max` from day one (v0.4 change) so Phase B bands don't require re-migrating. |
| Server merges null or sends separate `hasNull` array? | Server merges. Requires `null_count` materialized in CAGs. |
| Force-publish on flatline vs periodic snapshots? | `TrendSnapshotScheduler` (1-min cadence, already in production). 5-min `SnapshotEmitter` of v0.3 superseded. |
| Server-side retention clamp? | No. DB returns what it has; client logs info. |
| Hatched region vs null span for fetch failure? | Null span. Matches gap visual, re-fetches on interaction. |
| WS reconnect bridge-fetch? | No. Gap until pan/zoom. |
| Tile cache vs per-request vs full-window? | Tile cache. Option C. |
| Single package or split data/rendering? | Single. YAGNI. |
| Saved views in MVP? | Deferred to Phase B. |
| Default view on first open? | Blank chart with "Add tags" empty state. |
| Max concurrent clients? | Bounded by connection pool sizing. Pool must be ≥ 20–30 for production multi-operator use (v0.4 change, §15). |
| Aggregation scheme — 1min/1hour/1day tiers, factor-of-4 uniform, or power-of-10? | Power-of-10 with five levels (raw, 1 s, 10 s, 1 min, 10 min). |
| CAGs in Phase A, or compute on-the-fly first? | **CAGs in Phase A** (v0.4 reversal). Gate testing showed on-the-fly bucketing could not meet latency targets at production N. All four CAGs ship with the trends API. |
| Split `getTrendsRaw` and `getTrendsAggregated`, or one entry point? | One entry point, `getTrendTile(tagIds, startTime, endTime, bucketCount)` (v0.5), deriving `bucketS` internally and dispatching on it. |
| Client computes level + tile math, or server does? | `bucketS` derivation is now server-internal (v0.5). Client computes epoch-aligned `(startTime, endTime)` ranges and supplies `bucketCount`. Server is a pure `(tag_ids, start_time, end_time, bucket_count)` → range function. |
| Separate `ts[]`/`value[]` arrays vs `(ts, value)[]` pairs? | Separate arrays. Aggregate responses drop per-bucket `ts[]`; timestamps derived from `startTime + i * bucketS * 1000`. |
| `max_points` request param? | Removed. Client picks `bucket_s`. |
| Raw tile span? | Derived: `250 * bucket_s` seconds (v0.4 change from fixed 1h). |
| Bucket size enum vs continuous? | **Continuous** (v0.4 change). `bucket_s = windowSec / total_buckets` is float; dispatched onto the nearest CAG with outer `time_bucket()` re-aggregation. Cheap zone Div ≤ 16. |
| Tile geometry — 600 buckets fixed-span vs 250 buckets parallel? | **250 buckets, 4 tiles in parallel** (v0.4 change). Measured 51% wall-clock improvement over 1×1000 single tile. |
| Per-query tag cap? | **N ≤ 8** (v0.4 change). Heap-scatter cliff at N ≈ 10–11 forces fan-out for charts > 8 tags. UX cap on chart traces remains 20. |
| Bounded `prev` SQL pattern necessary? | **Yes, mandatory** (v0.4 addition, §5.5). Without it planning cost grows with chunk count and degrades silently. |
| Watermark-aware fall-through necessary? | **Yes, mandatory** (v0.4 addition, §4.3). Without it the live edge of every Live-mode chart shows stale data. |
| Prepared statements for the gapfill+locf query? | No. PostgreSQL's generic-plan regime breaks chunk pruning. Use standard `client.query(text, values)`. |
| CAGs feed from raw or chained from each other? | **Flat from raw.** All four CAGs (`tag_samples_1s_cagg`, `tag_samples_10s_cagg`, `tag_samples_1min_cagg`, `tag_samples_10min_cagg`) materialise directly from `tag_samples`. Independent watermarks preserve §4.3 fall-through correctness; no cascading refresh failures; refresh cost against hot-cache raw is negligible (~1–2K rows/min/CAG). |
| T005 1s CAG reconciliation — drop/recreate or alter? | **Drop and recreate** (option a). T006 migration (2026-04-28) drops `caro_samples_1s` and creates `tag_samples_1s_cagg` with `null_count`, 24h chunks, 1-min refresh, 1h compression-after. No operational data was lost — raw `tag_samples` is the source of truth. |
| CAG view naming convention — `tag_samples_*_cagg` or `caro_*`? | **`tag_samples_*_cagg`** — consistent with the raw `tag_samples` hypertable name. Standardized in T006–T009 (2026-04-28). |
| Tile-index-keyed wire vs range-keyed wire? | **Range-keyed (v0.5).** API takes `(start_time, end_time, bucket_count)`. Tile-aligned caching preserved by client-side discipline — epoch-aligned `startTime` values at fixed `bucketCount`. Trend viewer locks `bucketCount=250`; server accepts 1..2500 for non-viewer consumers. |
| `bucketCount` fixed at 250 in the API or a client knob? | **Client knob in the API** (1..2500). Trend viewer's policy is fixed at 500 (updated v0.9) to stay in the gate-tested zone. Other consumers can pick their own operating point but own the perf consequences. |
| 4×250 vs 2×500 vs 1×1000 tile geometry? | **2 visible × 500 + 2 prefetch (1 per side)**. Perf-page sweep showed 4×250 vs 1×1000 delta was 0–10% with high variance (not the 51% v0.4 claimed). Deciding factors: time-to-first-render (slowest-of-2 statistics), halved DB concurrency pressure, decoupled prefetch. (v0.9) |
| What does `bucket_count` actually guarantee on the wire? | It specifies the **bucket width** (via `(endTime - startTime) / bucket_count`), not a strict row-count contract. Aligned requests get exactly `bucket_count` rows; unaligned get `bucket_count + 1`. Response carries the actual served `startTime`/`endTime`/`n`. Trend viewer client aligns by policy so it always sees `n === bucket_count`. (v0.6) |

**Open (Phase A):**

- **Re-measure 10min CAG at 85+ d window** once sufficient history accumulates. Confirms or refutes the only operating point with Div > 16. If actual latency exceeds budget, add a 1h CAG.
- **End-to-end smoke test through the trends API.** All gates measured raw SQL latency only. The full API path adds ~10 ms pg-node serialization at N=8 × 250 buckets, which should be confirmed empirically once the API is built.

---

## 19. Glossary

| Term | Meaning |
|---|---|
| Auto-promote | Data-driven transition `live-fixed → live-trailing` fired by `tick` when `latestSampleTs >= viewport.to`. Snaps viewport to `[latestSampleTs - sizeMs, latestSampleTs]`. Preserves `sizeMs`; sets `lastIntent = 'live'` to trigger `useZoomState`'s reset effect. |
| Bucket size | The width of one aggregate bucket, in seconds (`bucketS`). Server-internal derived value: `(endTime - startTime) / (bucketCount * 1000)`. Not transmitted on the wire by the client. The server dispatches on `bucketS` per §6.3; values below 1.0 route to raw, otherwise to the smallest CAG with Div ≤ ~16. |
| CAG | Continuous aggregate. TimescaleDB's materialized rollup over a hypertable. Phase A ships four CAGs (1s / 10s / 1min / 10min), all materializing `last`, `null_count`, `min`, `max`. |
| Cheap zone | The Div range over which CAG re-aggregation cost is roughly flat: Div ≤ 16, measured. Cost roughly doubles per doubling of Div past 16; usable up to Div ≈ 30. |
| COV | Change of value. The storage convention where samples are written only when a tag's value changes. |
| Div | Ratio of requested `bucket_s` to the chosen CAG's native bucket size. The outer `time_bucket(bucket_s)` operation re-aggregates `Div` source rows per output bucket. |
| Fixed | Historical mode. Chart window is a static `[from, to]`; no live updates. WS ring fills but bucketing is suppressed. |
| Tag-generation counter | Monotonic integer (`tagGenerationRef`) owned by `useTrendData`. Bumped only when the `tagIds` list changes. A tile fetch captures it at dispatch; a non-terminal resolve whose captured value no longer matches is discarded. Decouples tile-fetch staleness from viewport changes and the live heartbeat. |
| `latestSampleTs` | `sessionHighWaterMark`. The scalar that drives all `live-trailing ↔ live-fixed` transitions. Returns `null` before the first `TREND_DELTA` arrives in a session, and again after `drainBuffers` resets it. Monotonic-non-decreasing within a continuous live session. (Prior to the 2026-05-27 audit pass the formula was `max(sessionHighWaterMark, currentMaxAcrossSubscribedTags)`; the ring-walk fallback was removed because every consumer handles `null` via classifyByWindow's `viewport.end` fallback per §9.3, and the ring fallback gave a third behavior — classify against a stale pre-drain tail — that no caller depended on. See audit Issue 7.) |
| `liveEdgeBehindWindow` | Derived boolean in `TrendChartContainer`: `latestSampleTs !== null && latestSampleTs < modeState.from`. True when the live data edge is entirely off-screen to the left. Passed to `EndPicker` to trigger the orange Live button state. |
| LKV | Last known value. The HMI server's in-memory cache of the most recent value per tag. |
| Live Mode | Flag indicating WS subscription is active, bucketing is gated open (`isLive(mode) === true`), and the unified buffer is being fed. True in both `live-trailing` and `live-fixed`. **"Live" appears in three places in the codebase, all consistent:** (1) `isLive(mode)` — the mode-discriminant predicate over `ModeState`; (2) the `isLive: boolean` prop threaded into `useTrendData` and `useLiveSubscription` — derived from the predicate; (3) the **live edge** semantic on a single tile — a tile is "at the live edge" when `committedThroughTs < tile.endTime` (terminal-cache rule, §10.6 / §10.8). The first two are mode-level; the third is tile-level and applies even outside Live mode (a tile whose right edge sits past the current data commit watermark). |
| LOCF | Last observation carried forward. Gap-fill mode that repeats the last seen value into missing buckets. Implemented via the bounded `prev` correlated subquery (§5.5). |
| Null-as-gap | The contract that null sample values render as visual gaps in the chart, never interpolated. Requires `null_count` materialized in CAGs to enforce on the CAG path. |
| `sessionHighWaterMark` | Bigint owned by `useLiveSubscription`, recording the highest `moduleTs` observed since Live entry. Bumped on every WS sample whose `moduleTs` exceeds the current mark. Reset to `null` by `drainBuffers`. Internal — not exposed on the hook surface. |
| Tailing | Historical term for Live mode. Superseded by the three-state model; `live-trailing` and `live-fixed` together constitute Live mode. |
| Tile | An epoch-aligned range whose width equals `bucketCount * bucketS * 1000` ms, scoped to a single `bucketCount` value. Unit of fetch and unit of cache. The trend viewer always fetches tiles of 500 buckets. |
| Tile alignment | Client policy that `startTime` is an integer multiple of `tileSpanMs = bucketCount * bucketS * 1000` from epoch. Ensures the same logical tile produces identical `(startTime, endTime)` wire values across clients, enabling shared cache hits, and guarantees `n === bucketCount` in the response (§6.2). |
| Tile span | Effective tile span is `n * bucketS_ms` based on the response's actual `n`. For aligned requests this equals `bucket_count * bucketS_ms` and matches the requested range exactly. For unaligned requests the served tile is one bucket wider. |
| Trailing | Flag indicating the viewport rolls so `viewport.to = latestSampleTs`. True in `live-trailing` only (not in `live-fixed`). |
| Trendable | Tag Registry flag indicating a tag's values are written to `tag_samples`. |
| Live tail | The `LiveTail` value (`AggregateTail \| RawTail \| null`) produced by `useLiveSubscription` from the WS-fed bucket accumulator (aggregate) or raw buffer (raw). Merged with the cached / active-tile data by `mergeTrendData` at render time. |
| Terminal tile | A tile whose fetched data fully covers its time range (`committedThroughTs >= tile.endTime`). Only terminal tiles are written to the LRU cache; a non-terminal tile (right edge still inside the live region) is held uncached in `activeTilesRef` with its data in `entry.data`. |
| Watermark | Per-CAG timestamp marking how far materialization has advanced. Queries past the watermark fall through to the next-finer source (§4.3). |
