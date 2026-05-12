# CARO_HMI Trend Viewer — Subsystem Handoff
**Updated:** 2026-05-11 | **Phase A Steps 1–11 Complete** | **Next:** Step 12 (Tag picker)

---

## 1. What Was Built

Phase A Steps 1–11 are complete. Steps 1–6 delivered the server-side trends API and TimescaleDB CAGs. Steps 7–10 delivered the `@caro/trend-chart` client package. Step 11 wired the live tail end-to-end.

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
| 11 | Live tail: dedicated trend WS channel, `useLiveSubscription` hook (FIFO + bucket accumulator + raw buffer), `mergeTrendData`, `isTailing` tile-fetch suppression, `dispatchModeAction` cleanup wrapper | ✅ Done |

**Test coverage (2026-05-11):** 542 passing in `@caro/trend-chart` (24 test files), 67 in `@caro/hmi-context`, 109 in `@caro/db`, 236 in the HMI server, 33 in the HMI client.

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
                                  #           swapCounter, activeTileCount, responseTailTs };
                                  # isTailing skip guard suppresses tile fetches during tailing
    useTrendMode.ts               # tailing/fixed mode state machine; exports reducer for unit
                                  # testing; tick action dispatched by TrendChartContainer on
                                  # TREND_DELTA receipt
    useLiveSubscription.ts        # Step 11: trend WS subscription + FIFO + bucket accumulator
                                  # (aggregate) + raw buffer (raw mode); commitAndDrain() for
                                  # atomic tailing-exit; viewportSpanMs 2×span raw buffer trim;
                                  # TREND_FIFO_CAPACITY per tag; returns LiveTail (AggregateTail
                                  # or RawTail)
    mergeTrendData.ts             # Step 11: merges cached TrendData + LiveTail; isTailing=true
                                  # clips cached series to liveEndIndex (aggregate) / drops
                                  # ts>=minLiveTs entries (raw) so live data wins the overlap
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
                                  # pre-load fallback bucketSMs integer invariant;
                                  # isTailing skip guard (3 cases)
      useTrendMode.test.ts        # trendModeReducer pure unit tests (37 cases)
      useLiveSubscription.test.ts # Step 11: FIFO trim, bucket accumulator close, raw buffer,
                                  # viewportSpanMs trim, rawBuffers NOT trimmed on threshold,
                                  # boolean coercion, commitAndDrain
      mergeTrendData.test.ts      # Step 11: aggregate clip at liveEndIndex, raw live-wins
                                  # overlap, isTailing=false passthrough
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
| `zoomApplied { from, to, nowMs }` | **Always → fixed** | `sizeMs = to - from`. Zoom is exploratory; tailing requires deliberate `liveClicked` or `presetClicked`-from-tailing after any zoom. |
| `panApplied { from, to, nowMs }` | Always → fixed | Preserves `sizeMs` from state (not `to - from`). Pan can never enter tailing. |
| `tick { nowMs }` | Advances `nowMs` in tailing only | Preserves `lastIntent`. Dispatched by `TrendChartContainer.handleDataReceived` on each `TREND_DELTA` frame received while in tailing mode. |

**`lastIntent` and preset highlight rule.** `lastIntent` tracks the most recent user action and drives the `SpanPresets` active-button highlight: `(lastIntent === 'preset' || lastIntent === 'pan') && sizeMs === preset.sizeMs`. Pan preserves `sizeMs`, so the active preset stays highlighted after a pan gesture. `tick` spreads the existing `lastIntent`.

`modeToViewport(state)` derives `Viewport { start: bigint; end: bigint }`:
- Tailing: `{ start: nowMs - sizeMs, end: nowMs }`
- Fixed: `{ start: from, end: to }`

**`tick` is the live-advance action.** `TrendChartContainer.handleDataReceived` guards on `modeStateRef.current.mode !== 'tailing'` before dispatching `tick { nowMs: maxModuleTs }`. This advances the viewport in tailing mode without affecting fixed mode. The `useZoomState` reset effect skips on `lastIntent === 'live'` so bucket size is not clobbered on each tick.

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

## 8. Live Tail Runtime Architecture (Step 11)

`useLiveSubscription` is the live-tail orchestrator. It lives in `TrendChartContainer` alongside `useTrendData`.

```
TREND_DELTA frame received
  → for each sample { moduleTs, tagId, value }:
      if aggregate mode:
        append to fifosRef[tagId]
        if moduleTs crosses next bucket boundary:
          close bucket → emit { ts, value, min, max, null_count }
          append to AggregateTail
      if raw mode:
        append to rawBuffersRef[tagId]
        if latestTs > lastTs + 2×viewportSpanMs:
          trim rawBuffersRef (NOT fifosRef) to latestTs - 2×viewportSpanMs

  → flushTail() → setTail(liveTail) → triggers mergeTrendData re-render

TrendChartContainer render:
  mergedData = mergeTrendData(cachedData, liveSub.tail, isTailing=true)
    aggregate: clips cachedData.series to liveEndIndex
    raw: drops cached entries with ts >= minLiveTs
  → TrendChart receives clean merged data

onDataReceived(maxModuleTs):
  if modeState.mode === 'tailing':
    dispatch({ type: 'tick', nowMs: BigInt(maxModuleTs) })
  → advances viewport, triggers xRange update → TrendChart.setScale('x', ...)
```

**Key invariants:**
- `rawBuffersRef` is never trimmed by `trimThreshold`. Trimming it moves `minLiveTs` forward, allowing LOCF gapfill from after-prefetch tiles to leak through `mergeRaw`'s cached-drop filter as a flatline gap at tile boundaries.
- `useTrendData` suppresses tile fetches while `isTailing && !spanChanged && activeTiles.length > 0`. No cached tiles fetched during tailing = no LOCF gapfill can contaminate the live view.
- On tailing exit, `dispatchModeAction` calls `commitAndDrain()` → `evictRange()` atomically. The fixed view always starts with a clean cache.

**Stable refs pattern.** `modeStateRef`, `trendDataRef`, `liveSubRef` are updated synchronously during render (not in `useEffect`) so all callbacks read current values without stale closures.

---

## 10. Implementation Divergences from Spec

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
13. **Watermark memoization (v1.5)** — `getWatermarkMs` caches each source's watermark in process memory with a 30-second TTL and an in-flight Promise deduplicator. Cold `_timescaledb_internal.cagg_watermark()` catalog queries paid 130–300 ms at production data scale; all tiles in a parallel boundary-crossing batch now share a single catalog round-trip. `__test_clearWatermarkCache` seam added for test isolation. See §4.3.
14. **Raw path unified into a single SQL query (v1.5)** — in-window samples and bounded-prev now run as one UNION ALL query with an `is_in_window` discriminant column, not two parallel queries via `Promise.all`. One connection per raw tile (was 2). Per-tag prev log lines collapsed into a `prev=N` summary count on the single log line.
15. **Dedicated trend WS channel (v1.6)** — live tail uses `SUBSCRIBE_TREND`/`UNSUBSCRIBE_TREND`/`TREND_DELTA` messages, not the existing `SUBSCRIBE`/`DELTA` LKV path. `TREND_DELTA.samples[]` is a flat array `{ moduleTs, tagId, value }`. See §10.6 of the spec for the full rationale.
16. **`rawBuffersRef` NOT trimmed on `trimThreshold` advance (v1.6)** — FIFO is trimmed; raw buffers are trimmed only on 2×viewportSpanMs in the WS callback and cleared on tailing exit. Trimming raw buffers on threshold would advance `minLiveTs` in `mergeRaw`, letting LOCF gapfill leak through the cached-drop filter.
17. **`useTrendData` `isTailing` skip guard (v1.6)** — tile fetches suppressed while tailing + unchanged span + active set non-empty. The spec's §10.6 live-stitching model assumed tiles would still be fetched; the skip guard eliminates the entire class of merge bugs by ensuring no new cached tiles arrive during a tailing session.
18. **Boolean coercion in `toNumericValue` (v1.6)** — `true → 1`, `false → 0` in `useLiveSubscription`. Matches server-side TimescaleDB writer (booleans stored as DOUBLE PRECISION 1.0/0.0); without this, boolean trend tags rendered as null gaps in the live tail.
19. **`tilesForViewport` tile-grid right-anchor (v1.6)** — right anchor changed from bucket grid to tile grid; prefetch filter lookahead extended by one `tileSpanMs`. Eliminates constant fetch→evict cycles during tailing. `alignedTilesInRange` is unchanged.
20. **Watchdog null marker dropped (v1.6)** — original plan called for `TelemetryIntake.watchdogTick()` to emit a synthetic null event at `lastSeen + 1 ms` to mark the precise gap start. Dropped because LKV null + synthetic-on-flush achieves the same bucket-null result without per-tag +1 ms bookkeeping or bucket-reclassification complexity. Trade-off: gap-start timestamp lags by up to one watchdog-tick interval (~500 ms worst case, `watchdogTickInterval = min(watchdogTimeoutMs, 500)`). Within the tolerance class of the watchdog timeout itself.
21. **Open-tile model rejected (v1.6)** — spec §10.6 described an "open range commits to LRU cache" model where cached tiles would be mutated as live data accumulated. Rejected in favor of tail-extension: cached tiles are immutable; `useLiveSubscription` owns a separate accumulator; `mergeTrendData` concatenates them at render time. Simpler invariants, no cache-mutation race, `commitAndDrain + evictRange` on tailing exit is the only interaction point.
22. **`responseTailTs`-based raw buffer trim dropped for 2×Span (v1.6)** — original plan trimmed raw buffers to `moduleTs >= responseTailTs - 1000` (same threshold as FIFO). Dropped because advancing `trimThreshold` as new tiles loaded would push `minLiveTs` forward in `mergeRaw`, letting LOCF gapfill from after-prefetch tiles leak through the cached-drop filter. Raw buffers now trimmed to `latestTs - 2×viewportSpanMs` in the WS callback (wall-clock bounded) and cleared only on tailing exit. See gotcha in §10.
23. **uPlot `range` function must read from `userScaleRef`, not be identity (v1.6)** — original plan used `range: (u, min, max) => [min, max]` (identity) to pass through `setScale` values. Discovered that uPlot clamps the identity return to the data extent, ignoring `setScale` requests that exceed it. Replaced with a `userScaleRef`-backed range function: the ref is updated synchronously before every `setScale` call (imperative path, pan handler, zoom helper), and `range` returns the ref value if set, else defers to uPlot's default autoscale. This makes the imperative X-scale update path reliable across all viewport advance scenarios.

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

## 10. Gotchas

Hard-won lessons from the min/max upgrade and perf engineering work.

**uPlot `width: 0` disables `_paths.band` computation.** A series with `width: 0` is treated by uPlot as "nothing to draw," and the renderer skips path generation for it — including the band path geometry. Bands referencing such a series produce no visible fill regardless of fill color or alpha. Use `stroke: 'transparent'` (with default `width: 1`) to hide a stroke while keeping the path computed for band participation.

**uPlot `bands[].series` is directional.** The array is `[upperSeriesIdx, lowerSeriesIdx]` — fill is drawn from the upper edge downward, clipped by the lower. Inverting the order produces an empty intersection. Code comment at `render/uplotConfig.ts` near the bands registration documents this in-line.

**dotenv import order matters.** `import 'dotenv/config'` must execute before ANY module that reads `process.env` at the top level. Top-level `const X = process.env.Y === '1'` lines capture the env state at module-load time. The `@caro/hmi-server` `index.ts` puts `import 'dotenv/config'` at line 1 for this reason. The `LOG_TILE_QUERIES` constant in `packages/db/timescale/trends.ts` is the canonical example of this pattern.

**Workspace packages ship from `dist/`.** `@caro/db` and `@caro/trend-chart` are TypeScript workspace packages that build to `dist/`. Source changes don't reach the running HMI server (which imports from `dist`) without `npm run build --workspace=<package>`. Restart and hard-refresh after a rebuild. Always run both builds before testing a server-side change end-to-end.

**PostgreSQL planning cost grows with chunk count for unbounded `tag_id = ANY(...)` queries.** A `MAX(ts) WHERE tag_id = ANY(...)` over `tag_samples` paid 814ms of planning time at 251 chunks (2008 plan-time chunk evaluations against the catalog). Always bound such queries by time (`AND ts >= now() - INTERVAL 'X minutes'`) so the planner can prune via `_ts_meta_max` constraints to ≤2 chunks. The bounded-prev pattern in §5.5 demonstrates this.

**TimescaleDB `cagg_watermark()` has cold-cache cost.** First call to `_timescaledb_internal.cagg_watermark()` on a fresh process pays 130–300ms at production data scale (catalog enumeration). Subsequent calls are <1ms. Always memoize watermarks in process memory if you call them per-request — the watermark advances slowly (refresh cadence) so a 30s TTL stays well within freshness.

**Pool starvation looks identical to slow SQL at the wall-clock level.** When diagnosing perf, use `TIMESCALE_LOG_TILE_QUERIES=1` to compare DB-side `elapsed_ms` against client-side wall-clock. Large gap with small DB time = queueing or app-layer overhead. Roughly equal = SQL itself is the cost.

**Multi-VM Hyper-V contention.** When TimescaleDB runs in Docker on Windows, `docker-desktop` and any user WSL distros are separate Hyper-V VMs that compete for CPU/memory/network scheduling (visible as `Vmmem` in Task Manager). Doesn't break anything but adds noise to perf measurements — close idle WSL instances before running gate tests.

**`rawBuffersRef` must never be trimmed on `trimThreshold` advance.** The `trimThreshold` (derived from `responseTailTs - 1000`) advances as new tiles load. If `rawBuffersRef` were trimmed alongside the FIFO, `minLiveTs` in `mergeRaw` would advance, causing LOCF gapfill from newly-fetched after-prefetch tiles to survive the cached-drop filter and render as a flatline gap at each tile-boundary crossing. Trim only the FIFO; raw buffers are cleaned via 2×viewportSpanMs in the WS callback and cleared entirely on tailing exit via `commitAndDrain`.

**`useTrendData` skip guard silences all tile fetches during tailing.** While `isTailing && !spanChanged && activeTiles.length > 0`, `useTrendData` returns early without fetching. This is intentional — any tile arriving during tailing can have LOCF gapfill past the tile's actual data extent, and merging it against the live buffer creates flatline contamination. The guard eliminates the merge-bug class. Side effect: after `evictRange` clears the cache on tailing exit, the first viewport change in fixed mode triggers a full refetch (expected; clean historical data loads correctly).

**`TREND_DELTA` boolean values arrive as `true`/`false`.** The TimescaleDB writer coerces booleans to DOUBLE PRECISION (1.0/0.0), but the WS trend path delivers the raw LKV value which may be a boolean. `toNumericValue` in `useLiveSubscription` applies `true → 1`, `false → 0`. Without this coercion, boolean trend tags render as null gaps in the live tail even when data is arriving correctly.

**`dispatchModeAction` vs direct `dispatch`.** Actions that can exit tailing (zoom, pan, endPicker) must go through `dispatchModeAction` to trigger `commitAndDrain + evictRange` atomically before the state transition. Actions that never exit tailing (preset, live, tick) use direct `dispatch`. Mixing them produces either a stale live buffer in the fixed view (if `dispatchModeAction` is skipped) or unnecessary eviction (if it is overused).

**Pan-back data-loss window.** On tailing → fixed transition, `commitAndDrain` clears the live buffer immediately. Live values that arrived in the last ~`TIMESCALE_DB_TICK_MS` + FIFO trim buffer (~1.5 s by default: 500 ms DB tick + 1 s trim tolerance) may not yet be committed to TimescaleDB when the next REST fetch fires. Those values are not lost in the historian — they land within the next DB flush cycle — but the brief in-transit window renders as null/gap until the subsequent refetch picks them up. Deliberate property of the tail-extension model: keeping tailing-exit synchronous and simple outweighs the cost of a sub-2 s null flash on pan-back. Not a bug.

---

## 12. What Comes Next

> **Note:** `@caro/trend-chart` ships from `dist/`. After editing source, run `npm run build --workspace=packages/trend-chart` before testing in the browser. Tests run against source directly.

| Step | Summary | Spec reference |
|---|---|---|
| 12 | **Tag picker drawer**: tree + search (§11.2), multi-select commit (§11.3), trendable filter (§11.4). | §11 |
| 13 | **Connection pool resize**: bump `@caro/db` Timescale pool from 10 to 20–30 before multi-operator production rollout. | §15 |

**Reading order for Step 12:**
1. This file (orientation, especially §7 Container Wiring)
2. `apps/caro-hmi/CLAUDE.md` — trendable tag route (`GET /api/v1/tags/trendable`) and WS architecture
3. `Docs/hmi_trend_viewer_spec.md` §11 — Tag Picker spec
4. `packages/trend-chart/src/TrendChartContainer.tsx` — wire point for `tagIds` state (`setTagIds`)
