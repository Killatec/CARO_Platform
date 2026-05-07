# CARO_HMI Trend Viewer — Subsystem Handoff
**Updated:** 2026-05-04 | **Phase A Steps 1–10 Complete** | **Next:** Step 11 (Live tail)

---

## 1. What Was Built

Phase A Steps 1–10 are complete. Steps 1–6 delivered the server-side trends API and TimescaleDB CAGs. Steps 7–10 delivered the `@caro/trend-chart` client package.

| Step | Deliverable | Status |
|---|---|---|
| 1 | T005 1s CAG re-migration (null_count column, correct chunk intervals) | ✅ Done |
| 2 | `@caro/db` raw path + `getTrendTile` entry point + test sandbox helpers | ✅ Done |
| 3 | `@caro/db` 1s CAG path with outer time_bucket + LOCF | ✅ Done |
| 4 | Watermark-aware fall-through in `getTrendTile` (recursive descent, source='mixed') | ✅ Done |
| 5 | REST endpoint `/api/v1/trends/tile` (validation, envelope, perf log) | ✅ Done |
| 6 | 10s/1min/10min CAG migrations and dispatch branches | ✅ Done |
| 7 | `packages/trend-chart/` scaffold: `level.ts`, `tileCache.ts`, `colorAssign.ts` — pure, no React | ✅ Done |
| 8 | `useTrendData` hook: 2-visible + 2-prefetch parallelism, ⌈N/8⌉ fan-out, stale-gen guard | ✅ Done |
| 9 | `TrendChart` static rendering: uPlot wrapper, per-trace Y-scales, legend (vertical right column), cursor display | ✅ Done |
| 10 | Mode state machine + time-range UI: tailing/fixed transitions, 8-preset strip, End picker (End-only), Live button, pan/zoom interactions | ✅ Done |

**Test coverage (2026-05-04):** 349 passing in `@caro/trend-chart` (19 test files), 97 in `@caro/db`, 226 in the HMI server, 33 in the HMI client.

---

## 2. `packages/trend-chart/` — Actual File Map

```
packages/trend-chart/
  src/
    index.ts                      # all public exports
    types.ts                      # Tile, Viewport, AggregateSeriesData, RawSeriesData, TrendData
    api.ts                        # fetchTile() — typed REST fetch; TileApiResponse discriminated union

    # ── Core primitives (no React) ─────────────────────────────────────────────
    level.ts                      # alignedTilesInRange, tilesForViewport, deriveBucketSMs,
                                  # TREND_VIEWER_DEFAULTS, TS_BUCKET_ORIGIN_MS, floorDiv, ceilDiv
    tileCache.ts                  # TileCache (LRU, 50 MB cap), makeTileCacheKey
    colorAssign.ts                # colorAssign(tagId), PALETTE, PALETTE_SIZE
    dateUtils.ts                  # msToDatetimeLocal, datetimeLocalToMs, getTzOffsetMs,
                                  # formatDateTime — timezone-aware date helpers

    # ── Axis interaction helpers (pure, no React) ─────────────────────────────
    axisInteractions.ts           # pruneRemovedTagOverrides, isInYAxisHitZone, panYScale,
                                  # zoomYScale, panThresholdCheck, isInXAxisHitZone,
                                  # panXScale, zoomXScale, checkAndExtendXCoverage

    # ── React hooks ───────────────────────────────────────────────────────────
    useTrendData.ts               # REST fetch orchestration; owns the TileCache instance;
                                  # returns { data, isLoading, error, ensureCovered,
                                  #           swapCounter, activeTileCount }
    useTrendMode.ts               # tailing/fixed mode state machine; exports reducer
                                  # for unit testing; NEAR_NOW_MS, LIVE_MODE_ENABLED (dormant)
    useZoomState.ts               # zoom level state; exports computeDragZoomViewport (pure,
                                  # tested separately); syncs to modeViewport via useEffect

    # ── Components ────────────────────────────────────────────────────────────
    TrendChart.tsx                # uPlot canvas wrapper; manages rebuild lifecycle,
                                  # X-scale preservation across rebuilds, per-trace Y-scale
                                  # overrides, wheel/drag handlers, cursor state
    TrendChartContainer.tsx       # stateful wiring layer: useTrendMode + useZoomState +
                                  # useTrendData + TrendChart + footer row components
    SpanBucketIndicator.tsx       # footer: viewport span + bucket size display
    SpanPresets.tsx               # footer: 8-preset strip (1m/5m/15m/1h/4h/24h/7d/14d);
                                  # highlight rule: (lastIntent==='preset'||'pan') && sizeMs match
    EndPicker.tsx                 # footer: End datetime picker button + Live/Go Live button
    Legend.tsx                    # vertical column (right side, 180px); per-trace rows with
                                  # color swatch, value (showLastWhenIdle rule), remove button
    CursorDisplay.tsx             # cursor-time display in the legend area
    Tooltip.tsx                   # preserved but not wired in Phase A

    render/
      uplotConfig.ts              # builds uPlot Options; onCursorChange callback (idx, tsMs)
      yScales.ts                  # per-trace Y-scale defaults (eng_min/max, autoscale, bool)
      seriesFromTrendData.ts      # maps TrendData → uPlot series definitions
      formatBucketS.ts            # bucket size → human-readable (e.g. "3.8 min buckets")
      formatValue.ts              # tag value → display string
      formatTickLabel.ts          # X-axis tick label formatting
      formatSpanMs.ts             # viewport span → human-readable (e.g. "1 h")

    __tests__/
      level.test.ts               # alignedTilesInRange, tilesForViewport, deriveBucketSMs
      tileCache.test.ts           # LRU eviction, cache key, size accounting
      colorAssign.test.ts         # deterministic palette assignment
      api.test.ts                 # fetchTile wire format + error handling
      dateUtils.test.ts           # timezone-aware date helpers
      useTrendData.test.ts        # fetch orchestration, fan-out, stale-gen, ensureCovered,
                                  # pre-load fallback bucketSMs integer invariant
      useTrendMode.test.ts        # trendModeReducer pure unit tests (37 cases)
      axisInteractions.test.ts    # all 9 helper functions
      TrendChartContainer.test.tsx # container behavior: presets, Live, End picker, tag remove,
                                  # loading hints; computeDragZoomViewport pure tests
      trendChart.test.tsx         # TrendChart render, Y-scale defaults, legend display
      legend.test.tsx             # Legend component unit tests
      SpanBucketIndicator.test.tsx # span + bucket size display
      SpanPresets.test.tsx        # preset highlight rule, mode-aware behavior
      EndPicker.test.tsx          # End picker interaction, snap-back on invalid input
      CursorDisplay.test.tsx      # cursor-time display
      render/formatters.test.ts   # formatBucketS, formatValue, formatSpanMs
      render/seriesFromTrendData.test.ts
      render/uplotConfig.test.ts
      render/yScales.test.ts      # Y-scale defaults
```

---

## 3. Mode State Machine (`useTrendMode.ts`)

Two modes: `tailing` and `fixed`. The reducer is pure and unit-tested separately (37 test cases).

```typescript
type LastIntent = 'preset' | 'live' | 'endPicker' | 'zoom' | 'pan' | null

type ModeState =
  | { mode: 'tailing'; sizeMs: bigint; nowMs: bigint; lastIntent: LastIntent }
  | { mode: 'fixed'; from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent }
```

Both branches carry `sizeMs` — required so `liveClicked` can restore the prior window size when returning from fixed.

**Actions and transition rules:**

| Action | Transition | Notes |
|---|---|---|
| `presetClicked { sizeMs, nowMs }` | Stays in current mode | Tailing: updates sizeMs/nowMs. Fixed: preserves `to`, re-anchors `from = to - sizeMs`. |
| `liveClicked { nowMs }` | Always → tailing | **Sole entry to tailing from fixed.** Preserves sizeMs. |
| `endPickerCommitted { to, nowMs }` | Always → fixed | `from = to - sizeMs`. No near-now branch. |
| `zoomApplied { from, to, nowMs }` | Tailing if prior=tailing AND `to ≥ nowMs - NEAR_NOW_MS`; else fixed | `sizeMs = to - from`. Zoom from fixed always stays fixed. |
| `panApplied { from, to, nowMs }` | Always → fixed | Preserves `sizeMs` from state (not `to - from`). Pan can never enter tailing. |
| `viewportChanged { from, to, nowMs }` | Near-now heuristic | Reserved for Step 11. |
| `tick { nowMs }` | Advances `nowMs` in tailing only | Preserves `lastIntent`. Dormant while `LIVE_MODE_ENABLED = false`. |

**`lastIntent` and preset highlight rule.** `lastIntent` tracks the most recent user action and drives the `SpanPresets` active-button highlight: `(lastIntent === 'preset' || lastIntent === 'pan') && sizeMs === preset.sizeMs`. Pan preserves `sizeMs`, so the active preset stays highlighted after a pan gesture. `tick` spreads the existing `lastIntent`.

**`NEAR_NOW_MS = 60_000n`** (1 minute).

`modeToViewport(state)` derives `Viewport { start: bigint; end: bigint }`:
- Tailing: `{ start: nowMs - sizeMs, end: nowMs }`
- Fixed: `{ start: from, end: to }`

**`LIVE_MODE_ENABLED = false`** — the 1 Hz interval that dispatches `tick` is disabled pending Step 11 (WebSocket). Setting it to `true` re-enables auto-advance. The `tick` reducer case and `viewportChanged` action are preserved for Step 11.

**Step 11 follow-up note:** `viewportChanged` sets `lastIntent = 'live'`, which will trigger the `useZoomState` reset effect on every live-tick advance (clobbering bucket size each second). When Step 11 lands, either add `'live'` to the skip condition in the reset gate, or use a more targeted action for tick advances.

---

## 4. Zoom State (`useZoomState.ts`)

`useZoomState` owns three pieces of state:

| State | Type | Role |
|---|---|---|
| `currentBucketSMs` | `bigint` | Current bucket size in ms — drives `computeDragZoomViewport` |
| `zoomAnchorSpan` | `bigint` | Full viewport span at the current zoom level — drives uPlot autoscale |
| `dataViewport` | `Viewport` | The aligned viewport passed to `useTrendData` |

A `useEffect` keyed on `modeViewport.start/end` resets all three on `preset`, `live`, and `endPicker` intent changes, but skips on `zoom` and `pan` (so wheel/pan zoom anchor accumulates correctly). This ensures preset/Live/End-picker actions always start from a clean zoom level.

`handleDragZoom(selStart, selEnd)` and `handleZoomLevelSwitch('in'|'out', cursorMs)` update all three atomically. `computeDragZoomViewport` is exported for direct testing.

---

## 5. Data Fetch (`useTrendData.ts`)

`useTrendData({ viewport, tagIds })` drives tile fetches. Key behaviors:

- **Tile geometry**: `TREND_VIEWER_DEFAULTS.bucketCount=500`, `visibleTilesPerWindow=2`, `overfetchPerSide=1`. `deriveBucketSMs(viewport)` derives the bucket size from viewport span.
- **`ensureCovered`**: called by TrendChart's wheel/pan handlers to request additional tiles. Anchors candidate tiles to the *active-set edges* (`cachedStart`/`cachedEnd`) rather than re-computing from `TS_BUCKET_ORIGIN_MS` — walks outward from the current cache boundary.
- **`swapCounter`**: incremented each time the tile set swaps on a bucket-size change (zoom across a §6.3 dispatch threshold). TrendChart uses this to trigger a full uPlot rebuild.
- **`activeTileCount`**: count of tiles currently in the active set — used by `SpanBucketIndicator` and tests.
- **Stale-generation guard**: each fetch call captures a generation at dispatch; if `viewport` or `tagIds` change before the fetch resolves, the result is discarded.
- **`bucketSMs` integer invariant**: the assembled `bucketSMs` value passed to the chart must always be an integer. The fallback path (when `lastBucketSMs === 0` — all tile fetches failed) applies `Math.round()` before returning. A defensive `!Number.isInteger(bucketSMs) → throw` assertion fires at the assembly boundary so any regression surfaces here, not downstream in `BigInt()` conversions.

---

## 6. Chart Rendering (`TrendChart.tsx`)

`TrendChart` manages the uPlot instance lifecycle via a single `useEffect` keyed on:

```
[tagIds, effectiveSelectedId, tagMap, width, height, siteTimezone]
```

A separate imperative effect (keyed on `xRange`) calls `u.setScale('x', ...)` without rebuilding — this is the tailing/preset/custom live-update path.

**X-scale preservation across rebuilds** (legend click, tag add/remove): the cleanup function captures `u.scales['x'].{min, max}` into `preservedXRangeRef` before destroying the old instance. The new effect body reads and clears the ref, restoring the user's drag-zoom position. `preservedXRangeRef` is cleared on preset/Live/Custom because those go through the imperative `xRange` effect, which fires after the rebuild and overwrites any preserved range.

**Per-trace Y-scale overrides** (`yScaleOverridesRef`): wheel events and drag on the Y-axis region call helpers from `axisInteractions.ts` to update the per-trace override stored in the ref. On rebuild, overrides for removed tags are pruned and surviving overrides are restored to the new uPlot instance. Pan/zoom handlers reference `selectedTagIdRef` (a stable ref that shadows `effectiveSelectedId`) so stale closures never act on the wrong trace.

---

## 7. Container Wiring (`TrendChartContainer.tsx`)

`TrendChartContainer` is intentionally thin — it wires the hooks and passes props:

```
useTrendMode()         →  modeState, modeViewport, dispatch
useZoomState(...)      →  zoomAnchorSpan, dataViewport, handleDragZoom, handleZoomLevelSwitch
useTrendData(...)      →  data, isLoading, ensureCovered, swapCounter, activeTileCount
```

It renders:
- `TrendChart` (with `onXRangeChange` → `handleXRangeChange` RAF-coalesced → `zoomApplied`; `onXPan` → `handleXPan` RAF-coalesced → `panApplied`)
- Footer row below the chart: `SpanBucketIndicator` | `SpanPresets` | `EndPicker + Live button`

It owns `tagIds` state (initialized from `initialTagIds` prop; removes come from `Legend` via `TrendChart.onTagRemove`). It derives `xRange` (the imperative X-scale update value) from `modeViewport` via `useMemo`. It passes `showLastWhenIdle={modeState.mode === 'tailing'}` to `TrendChart` (forwarded to `Legend`).

Props: `tagIds: number[]`, `siteTimezone?: string`, `width?: number` (default 900), `height?: number` (default 420).

---

## 8. Known Dormant Feature Flags

| Flag | Location | State | Re-enable condition |
|---|---|---|---|
| `LIVE_MODE_ENABLED` | `useTrendMode.ts` module scope | `false` | Step 11: wire `tick` dispatch to WebSocket |
| `legend: { show: false }` | `render/uplotConfig.ts` | disabled | Replaced by custom `Legend.tsx` component |

`INTERACTIONS_ENABLED` and `TOOLTIP_ENABLED` feature-flag blocks were **deleted** this session (not just disabled). The interaction code is active; only the gated-off experimental code was removed.

---

## 9. Implementation Divergences from Spec

Spec was updated (v1.1) to reflect all items below — this list is for historical context.

1. **`TrendChartContainer`** — spec §7.1 called the wrapper `TrendChartProvider`; renamed because it is not a React Context provider.
2. **`ModeState.sizeMs` on fixed branch** — required to implement "liveClicked preserves prior sizeMs"; `lastIntent` field also added to both branches.
3. **Axis interaction gating = hover-zone, no modifier key** — implementation uses hit-zone detection (`isInYAxisHitZone` / `isInXAxisHitZone`). Hover the Y-axis margin for Y pan/zoom; hover the X-axis margin for X wheel-zoom; drag anywhere on the plot area for drag-zoom.
4. **End picker (End-only) replaces Custom range (from/to)** — `EndPicker.tsx` commits an End timestamp only; `from = to - sizeMs`. Uses `Intl.DateTimeFormat` with `siteTimezone`. End picker commits always go fixed — no near-now → tailing branch.
5. **Preset list expanded to 8** — `1m · 5m · 15m · 1h · 4h · 24h · 7d · 14d` (spec originally listed 6: `15m · 1h · 4h · 24h · 7d · 14d`).
6. **`liveClicked` is the sole entry to tailing from fixed** — presets from fixed stay fixed; zoom from fixed stays fixed; End picker always goes fixed.
7. **Pan dispatches `panApplied`** — always fixed, preserves `sizeMs`, does not reset `dataViewport`. Zoom dispatches `zoomApplied` on every X-scale mutation (RAF-coalesced), keeping `modeViewport` in sync.
8. **Wire field `bucketSMs` (integer ms)** — replaces `bucketS` (float seconds). Server sends `bucketSMs = Math.round(spanMs / bucketCount)`.
9. **TimescaleDB alignment** — `splitBoundaryMs` and all-absent `firstMs` computed via `time_bucket()` SQL query, not JavaScript epoch arithmetic. `POSTGRES_EPOCH_MS` removed entirely.
10. **Tile alignment origin = `TS_BUCKET_ORIGIN_MS = 946_857_600_000n`** (2000-01-03 UTC) — TimescaleDB's actual `time_bucket()` default origin.
11. **`ensureCovered` anchors to active-set edges** — does not re-derive from `TS_BUCKET_ORIGIN_MS`; `floorDiv`/`ceilDiv`/`TS_BUCKET_ORIGIN_MS` removed from `useTrendData.ts`.
12. ~~**`getTrendTile` LOCF cutoff at `MAX(ts)`** — outer CASE expression nulls any gapfill bucket past the data extent.~~ **Removed (v1.3)** — see "Dead-tag detection" TODO below.

---

## Dead-tag detection — replacement for removed LOCF cutoff

**Context.** The LOCF cutoff query (`SELECT MAX(ts) FROM tag_samples WHERE tag_id = ANY(...)`) and its associated past-extent CASE wrapper were removed because they paid **814ms of planning time per CAG request** on the production-scale `tag_samples` table (251 chunks × 8 tag_ids → catalog enumeration). The cost was the dominant per-request overhead and CAG perf had regressed 5-10x from the spec's gate-test baseline as data accumulated.

**What was lost.** With the cutoff removed, LOCF carries the last known value forward through all empty trailing buckets in any aggregate query. A recently-stopped tag will show a flat line at its last value extending through the full requested window. Interior dead periods and multi-tag mixed live/dead queries were already not handled by the cutoff and are unchanged.

**What still works.** Watchdog NULLs (when the watchdog writes continuous NULLs while telemetry is silent) still produce gap rendering via §5.4 null-as-gap. For tags with reliable continuous-NULL watchdogs, dead periods render correctly today.

**Replacement options to evaluate:**

1. **Per-tag freshness lookup alongside the tile response** — a `freshness` field (last sample timestamp per tag) returned in the aggregate tile; client-side legend renders a "stale" indicator or dims the line beyond the last fresh sample.
2. **Watchdog contract guarantee** — confirm that the current watchdog reliably writes continuous NULLs while telemetry is silent, and document this as the guaranteed mechanism. For tags with compliant watchdogs no UI change is needed.
3. **Per-tag freshness tag** (`Trend_Info`-style) — a separate tag tracking per-tag last-write time, queried client-side at chart-load and periodically refreshed.

Probably some combination of (2) and (1): a watchdog contract guarantee for the common case, plus an optional freshness indicator for tags whose modules went silent without triggering the watchdog.

---

## 10. What Comes Next

> **Note:** `@caro/trend-chart` ships from `dist/`. After editing source, run `npm run build --workspace=packages/trend-chart` before testing in the browser. Tests run against source directly.

| Step | Summary | Spec reference |
|---|---|---|
| 11 | **Live tail**: WebSocket subscription wiring via `@caro/hmi-context`, client-side bucket accumulator (§10.6), per-tag subscription lifecycle (§10.7), reconnect/backoff (§14.4). Requires `LIVE_MODE_ENABLED = true`. | §10.6, §10.7, §14.4 |
| 12 | **Tag picker drawer**: tree + search (§11.2), multi-select commit (§11.3), trendable filter (§11.4). | §11 |

**Reading order for Step 11:**
1. This file (orientation)
2. `packages/trend-chart/src/useTrendMode.ts` — understand `tick` action and `viewportChanged`
3. `packages/hmi-context/src/HmiContextProvider.tsx` — understand `useLiveValue` subscription model
4. `Docs/hmi_trend_viewer_spec.md` §10.6–10.7 — bucket accumulator design
5. `apps/caro-hmi/CLAUDE.md` — WS server architecture and LKV model
