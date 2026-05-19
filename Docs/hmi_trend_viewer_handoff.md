# CARO_HMI Trend Viewer — Subsystem Handoff
**Updated:** 2026-05-13 | **Phase A Steps 1–11 Complete** | **Next:** Step 12 (Tag picker)

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
| 10 | Mode state machine + time-range UI: live-trailing/live-fixed/fixed transitions, 8-preset strip, End picker (End-only), Live button, pan/zoom interactions | ✅ Done |
| 11 | Live tail: dedicated trend WS channel, `useLiveSubscription` hook (ring buffer + bucket accumulator + raw buffer; `commitAndDrain` returns void), unified `mergeTrendData` (live-wins-on-coverage, no `isTailing`), eviction-on-live-entry cache freshness (Gap B fix), server-side future-bucket nulling in `getTrendTile`, no-clamp wheel-zoom + `gatedFetchTile` over-range gating + inline "Range too wide" message in `CursorDisplay`, `dispatchModeAction` cleanup wrapper | ✅ Done |

**Test coverage (2026-05-17):** 586 passing in `@caro/trend-chart`, 67 in `@caro/hmi-context`, 156 in `@caro/db`, 289 in the HMI server, 33 in the HMI client.

**Audit remediation pass (2026-05-15 → 2026-05-17):** all items from `Docs/hmi_trend_viewer_audit_2026-05-15.md` landed across Phases 1–5. Notable architectural change: **M1 metadata-as-return-value** — `getTrendTile()` now returns `Promise<{ tile, meta }>` (see spec §4.1 / §14.7); the `__test_lastUsedSources` module singleton is gone, with per-segment source/timing/rowCount now flowing through `meta.segments[]`. Operational hardening: F5 per-tag outbox cap (spec §4.4), TG-7 `commitAndDrain` bug fix (§10 gotcha below), TG-1 plan-pruning regression test (§10 gotcha below). All other items were refactors, test additions, or comment cleanup with no observable behavior change.

---

## 2. `packages/trend-chart/` — Actual File Map

```
packages/trend-chart/
  src/
    index.ts                      # all public exports
    types.ts                      # Tile, Viewport, AggregateSeriesData, RawSeriesData, TrendData
    api.ts                        # fetchTile() — typed REST fetch; TileApiResponse discriminated union

    # ── Core primitives (no React) ─────────────────────────────────────────────
    level.ts                      # alignedTilesInRange, tilesForViewport (filters startTime<0n),
                                  # TREND_VIEWER_DEFAULTS, TS_BUCKET_ORIGIN_MS,
                                  # MAX_BUCKET_S (mirror of @caro/db), MAX_VIEWPORT_SPAN_MS,
                                  # floorDiv, ceilDiv
    tileCache.ts                  # TileCache (LRU, 50 MB cap), makeTileCacheKey
    colorAssign.ts                # colorAssign(tagId), PALETTE, PALETTE_SIZE
                                  # (date formatting lives in @caro/ui — formatDateTime / formatDate)

    # ── Axis interaction helpers (pure, no React) ─────────────────────────────
    axisInteractions.ts           # pruneRemovedTagOverrides, isInYAxisHitZone, panYScale,
                                  # zoomYScale, panThresholdCheck, isInXAxisHitZone,
                                  # panXScale, zoomXScale, checkAndExtendXCoverage

    # ── useTrendData sub-modules (F15, 2026-05-14) ───────────────────────────
    tileActiveSet.ts              # MAX_ACTIVE_TILES, chunkArray, CachedEntry, HookState,
                                  # estimateCachedEntrySize, storeTileResult, assembleData,
                                  # computeResponseTailTs, pruneAndAdd — pure functions / types
    gatedFetchTile.ts             # buildGatedFetchTile factory —
                                  # CLIENT_OVER_RANGE / CLIENT_UNDER_RANGE / CLIENT_PRE_EPOCH
                                  # sentinel logic; GatedFetchFn type alias
    liveSpineFetch.ts             # assembleLiveSpine (pure assembly), runLiveSpineFetch —
                                  # isTailing=true branch called from inside the main useEffect
    historyTileFetch.ts           # runHistoryTileFetch — isTailing=false branch:
                                  # tilesForViewport, parallel fetch orchestration, performSwap,
                                  # stale-generation tracking, liveExitRefetch flag handling

    # ── React hooks ───────────────────────────────────────────────────────────
    useTrendData.ts               # hook shell: state/ref allocation, useEffect
                                  # orchestration (calls runLiveSpineFetch or runHistoryTileFetch),
                                  # ensureCovered, getActiveRange, evictAll, refetchHistory,
                                  # return value; re-exports pruneAndAdd + assembleLiveSpine.
                                  # ensureCovered accounts for ~100 lines of the file (pan-extend
                                  # candidate computation + per-tile fetch orchestration); future
                                  # extraction candidate as ensureCoveredFactory.ts if size grows.
                                  # returns { data, isLoading, error, ensureCovered, getActiveRange,
                                  #           evictAll, refetchHistory, swapCounter, activeTileCount,
                                  #           lastFetchMs, responseTailTs }
    useTrendMode.ts               # live/fixed three-state mode machine; exports reducer for unit
                                  # testing; tick action dispatched by TrendChartContainer on
                                  # TREND_DELTA receipt
    useLiveSubscription.ts        # Step 11: trend WS subscription + ring buffer + bucket
                                  # accumulator (aggregate) + raw buffer (raw mode);
                                  # commitAndDrain() returns void — clears rings, accumulators,
                                  # rawBuffers; TREND_RING_CAPACITY=20 per tag; returns LiveTail
                                  # (AggregateTail or RawTail)
    mergeTrendData.ts             # Step 11: merges cached TrendData + LiveTail; unified
                                  # coverage rule — live wins on its range (null included);
                                  # aggregate clips to liveEndIndex, raw drops ts>=minLiveTs;
                                  # no isTailing parameter
    useZoomState.ts               # zoom level state; exports computeDragZoomViewport (pure,
                                  # tested separately); syncs to modeViewport via useEffect;
                                  # syncDataViewport() bypasses lastIntent skip for live→fixed

    # ── Components ────────────────────────────────────────────────────────────
    TrendChart.tsx                # uPlot canvas wrapper; manages rebuild lifecycle,
                                  # X-scale preservation across rebuilds, per-trace Y-scale
                                  # overrides, wheel/drag handlers, cursor state
    TrendChartContainer.tsx       # stateful wiring layer: useTrendMode + useZoomState +
                                  # useTrendData + TrendChart + footer row components
    SpanBucketIndicator.tsx       # footer: viewport span + bucket size display
    SpanPresets.tsx               # footer: 8-preset strip (1m/5m/15m/1h/4h/24h/7d/14d);
                                  # highlight: lastIntent!==null && lastIntent!=='zoom' && sizeMs match
                                  # (any size-preserving intent stays highlighted; zoom excluded)
    EndPicker.tsx                 # footer: End datetime picker button + Live/Go Live button
    Legend.tsx                    # vertical column (right side, 180px); per-trace rows with
                                  # color swatch, value (showLastWhenIdle rule), remove button
    CursorDisplay.tsx             # cursor-time display in the legend area;
                                  # rangeExceededMessage prop renders "Range too wide. Zoom in
                                  # or pick a smaller preset." inline on the right side;
                                  # lineHeight:16px pinned so toggling does not reflow

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
      tileActiveSet.test.ts       # direct-seam: pruneAndAdd geometry (empty, below-capacity,
                                  # left-end, right-end, middle gap-fill at capacity — no warn)
      useTrendData.test.ts        # fetch orchestration, fan-out, stale-gen, ensureCovered,
                                  # pre-load fallback bucketSMs integer invariant;
                                  # isTailing skip guard (3 cases); gatedFetchTile
                                  # CLIENT_OVER_RANGE / CLIENT_PRE_EPOCH sentinels;
                                  # ensureCovered pre-epoch candidate filter
      useTrendMode.test.ts        # trendModeReducer pure unit tests
      useLiveSubscription.test.ts # Step 11: ring buffer lifecycle, bucket accumulator close,
                                  # raw buffer, viewportSpanMs trim, rawBuffers NOT trimmed
                                  # on threshold, boolean coercion, commitAndDrain (void)
      mergeTrendData.test.ts      # Step 11: unified coverage rule, aggregate clip at
                                  # liveEndIndex, raw live-wins overlap, bucketSMs mismatch
                                  # passthrough
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
      render/uplotConfig.test.ts
      render/yScales.test.ts      # Y-scale defaults
```

---

## 3. Mode State Machine (`useTrendMode.ts`)

Three modes: `fixed`, `live-trailing`, `live-fixed`. The reducer is pure and unit-tested separately.

```typescript
type LastIntent = 'preset' | 'live' | 'endPicker' | 'zoom' | 'pan' | null

type ModeState =
  | { mode: 'fixed';         from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent }
  | { mode: 'live-trailing'; sizeMs: bigint; nowMs: bigint;            lastIntent: LastIntent }
  | { mode: 'live-fixed';    from: bigint; to: bigint; sizeMs: bigint; lastIntent: LastIntent }
```

`isLive(mode)` returns `true` for both `live-trailing` and `live-fixed`. All consumer branches that were previously keyed on `isTailing` are now keyed on `isLive(mode)`.

**Transition table:**

| From | Action | Condition | To | Key side effects |
|---|---|---|---|---|
| `fixed` | `presetClicked` | — | `fixed` | re-anchor `from = to - sizeMs` |
| `live-*` | `presetClicked` | — | `live-trailing` | `commitAndDrain` + `evictAll` + spine refetch |
| `fixed` | `liveClicked` | — | `live-trailing` | `evictAll` + spine fetch |
| `live-*` | `liveClicked` | — | `live-trailing` | `commitAndDrain` + `evictAll` + spine refetch |
| `fixed` | `endPickerCommitted` | — | `fixed` | (stays fixed; see symmetric rule) |
| `live-*` | `endPickerCommitted` | `to > latestSampleTs` | `live-fixed` | no teardown |
| `live-*` | `endPickerCommitted` | `to <= latestSampleTs` | `fixed` | `commitAndDrain` + `syncDataViewport` + `refetchHistory` |
| `fixed` | `zoomApplied` | — | `fixed` | no teardown |
| `live-*` | `zoomApplied` | — | `fixed` | `commitAndDrain` + `syncDataViewport` + `refetchHistory` |
| `fixed` | `panApplied` | — | `fixed` | (pan-in-fixed preserved) |
| `live-*` | `panApplied` | `to > latestSampleTs` | `live-fixed` | no teardown |
| `live-*` | `panApplied` | `to <= latestSampleTs` | `fixed` | `commitAndDrain` + `syncDataViewport` + `refetchHistory` |
| `live-trailing` | `tick` | — | `live-trailing` | advance `nowMs`, preserve `lastIntent` |
| `live-fixed` | `tick` | `nowMs >= state.to` | `live-trailing` | **auto-promote**: snap viewport, set `lastIntent = 'live'` |
| `live-fixed` | `tick` | `nowMs < state.to` | `live-fixed` | no-op |
| `fixed` | `tick` | — | `fixed` | no-op (container guard prevents dispatch) |

**Symmetric window-vs-live-edge rule (supersedes proposal D6 + D7).** The reducer classifies `panApplied`, `zoomApplied`, and `endPickerCommitted` from **any** starting state uniformly: `to > latestSampleTs` → `live-fixed`; `to <= latestSampleTs` → `fixed`. A `classifyByWindow(latestSampleTs, action.to)` helper is extracted from the three action branches. This means `endPickerCommitted` from `fixed` with a future End now enters `live-fixed` — the original D6 asymmetry is superseded. Spec §9.3 and §12.2 document this as the contract.

**`latestSampleTs === null` fallback.** When `latestSampleTs` is unavailable (spine-fetch-in-flight window), `panApplied` and `endPickerCommitted` use `state.modeViewport.end` as the reference. Preserves gesture semantics before the first `TREND_DELTA` arrives.

**Auto-promote `lastIntent` synthesis.** Auto-promote (`live-fixed` tick where `nowMs >= state.to`) sets `lastIntent = 'live'`, not the prior value — this triggers `useZoomState`'s reset effect so `currentBucketSMs`, `zoomAnchorSpan`, and `dataViewport` re-derive from the post-snap clean span. Spec §9.3 documents this as contract behavior.

**`isFreshLiveLanding` scoping (implementation detail).** The `dispatchModeAction` `isFreshLiveLanding` branch is scoped to `prev.mode === 'live-fixed' && next.mode === 'live-trailing'` — not the wider `willBeLive && next.mode === 'live-trailing'` in the original proposal sketch. The narrower scope prevents spurious `commitAndDrain + evictAll` on `live-trailing → live-trailing` transitions (same-preset re-click while trailing), which would have broken the "preset click in tailing → no commitAndDrain" test. This is a deliberate implementation refinement; it is correct given the post-Phase-2 fix in `seedFromSpineFetch` (`spineMetadataMatches` gates the clip), which means the `live-trailing` → `live-trailing` path doesn't accumulate stale buffer state. The spec describes the user-visible contract (preset-from-Live = full teardown); this note explains why the implementation scoping is narrower.

`modeToViewport(state)` derives `Viewport { start: bigint; end: bigint }`:
- `live-trailing`: `{ start: nowMs - sizeMs, end: nowMs }`
- `fixed` / `live-fixed`: `{ start: from, end: to }`

**`tick` is the live-advance action.** `TrendChartContainer.handleDataReceived` guards on `isLive(modeStateRef.current.mode)` before dispatching `tick { nowMs: maxModuleTs }`. The `useZoomState` reset effect skips on `lastIntent === 'live'` so bucket size is not clobbered on each tick.

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

`syncDataViewport(viewport)` is a stable callback that calls `setDataViewport` directly, bypassing the reset effect's `lastIntent` skip logic. It is called unconditionally at the top of `dispatchModeAction` on every mode transition (Phase 6 hoist): since `lastIntent === 'pan'` causes the reset effect to skip, `syncDataViewport` is the only way to guarantee `dataViewport` reaches the post-transition viewport without waiting for the next non-pan action.

---

## 5. Data Fetch (`useTrendData.ts`)

`useTrendData({ viewport, tagIds, isTailing })` drives tile fetches via two paths:

**Live-spine path** (`isTailing=true`): fires one fetch spanning the full viewport at `visibleTilesPerWindow × bucketCount` buckets (1000 at defaults), using `viewport.start`/`viewport.end` as exact tile bounds (no tile-grid alignment). Result is assembled via `assembleLiveSpine` and set directly on `hookResult.data`, bypassing the LRU cache entirely. `activeTilesRef` stays empty in live mode; `ensureCovered` is a no-op. Two refs gate re-entry: `isTailingRef` is synced each render and read from inside the effect (not a dep) — this prevents a mode-flip alone from triggering the effect with a stale `dataViewport`; `spineFetchInFlightRef` is set `true` before `Promise.all` and cleared in `.then`/`.catch`, preventing 4 Hz tick re-fires from launching duplicate spine requests before the first one settles.

**History path** (`isTailing=false`): existing LRU-cache tile fetch path. `spineLoadedRef` and `spineFetchInFlightRef` are cleared at the start of this path so a subsequent live entry always triggers a fresh spine fetch. `tilesForViewport` accepts `overfetchLeftCount`/`overfetchRightCount` as optional per-call overrides (default to `overfetchPerSide`) — used by the live→fixed refetch to skip the right prefetch tile.

Key behaviors:

- **Tile geometry**: `TREND_VIEWER_DEFAULTS.bucketCount=500`, `visibleTilesPerWindow=2`, `overfetchPerSide=1`. `deriveBucketSMs(viewport)` derives the bucket size from viewport span.
- **`gatedFetchTile` wrapper**: built via `buildGatedFetchTile()` in `gatedFetchTile.ts`; all four fetch sites (live-spine, history-visible, history-prefetch, `ensureCovered`) delegate through it. Rejects with `CLIENT_PRE_EPOCH` when `startTime < 0n` (silent skip), `CLIENT_UNDER_RANGE` when `tileSpanMs / bucketCount === 0` (sub-ms tile), and `CLIENT_OVER_RANGE` when `bucketS > MAX_BUCKET_S`. Catch handlers at each site recognize the sentinels by `error.code` and skip silently. No state is set by `gatedFetchTile` — out-of-range UX is owned by `TrendChartContainer` via `modeViewport`-derived booleans.
- **`ensureCovered`**: lives in the shell; called by `checkAndExtendXCoverage` in `axisInteractions.ts` to request additional tiles on pan. Anchors candidate tiles outward from `activeTilesRef` edges using `tileSpanMs` derived from the active set's actual tile width (not the viewport span). Short-circuits when `activeTilesRef` is empty (live mode); candidate filter drops `t.startTime < 0n` and `t.startTime >= nowMs`.
- **`getActiveRange`**: stable callback returning `{ startMs, endMs, tileSpanMs }` from `activeTilesRef.current`, or `null` if empty. `tileSpanMs = active[0].endTime - active[0].startTime` — the active set's actual tile width, used by both `panThresholdCheck` and `ensureCovered` to ensure the requested extension range matches the active grid (§10.5). Passed through `TrendChart` via `getActiveRangeRef` to `checkAndExtendXCoverage`.
- **`refetchHistory()`**: bumps `historyRefetchVersion` state and sets `liveExitRefetchPendingRef`. Forces the main effect to re-run the history path even when `dataViewport` didn't change (the first `panApplied` on live exit carries live-viewport bounds). The history branch reads the flag and passes `overfetchRightCount: 0` to `tilesForViewport`, yielding 2 visible + 1 left prefetch instead of 2 + 1 + 1.
- **`swapCounter`**: incremented each time the tile set swaps on a bucket-size change (zoom across a §6.3 dispatch threshold). TrendChart uses this to trigger a full uPlot rebuild.
- **`activeTileCount`**: count of tiles currently in the active set — used by `SpanBucketIndicator` and tests.
- **Stale-generation guard**: each fetch call captures a generation at dispatch; if `viewport` or `tagIds` change before the fetch resolves, the result is discarded.
- **`bucketSMs` integer invariant**: the assembled `bucketSMs` value passed to the chart must always be an integer. The fallback path (when `lastBucketSMs === 0` — all tile fetches failed) applies `Math.round()` before returning. A defensive `!Number.isInteger(bucketSMs) → throw` assertion fires at the assembly boundary so any regression surfaces here, not downstream in `BigInt()` conversions.
- **Live spine ownership (post-Phase-2):** The live-spine fetch's result no longer lives in `useTrendData`'s `hookResult.data`. It flows through `liveSub.seedFromSpineFetch(tagId, series, generation)` into `useLiveSubscription`'s `spineRef`. `hookResult.data` is set to `null` after the fetch resolves. The chart's data in Live mode comes from `liveSub.getBufferSnapshot()`, which merges `spineRef` with the current WS tail using `mergeTrendData` internally and returns a `TrendData` snapshot.

**Live/history `mergedData` split in `TrendChartContainer`:** In Live mode, `mergedData = liveSub.getBufferSnapshot()` is called directly every render (no `useMemo` — the snapshot reads from refs, not React state). In history mode, `mergedData = useMemo(() => mergeTrendData(data, liveSub.tail), [data, liveSub.tail])`. The split is necessary because memoizing the live branch causes stale data when a new spine arrives via `seedFromSpineFetch` (which writes refs, not state). See §10 divergence 28.

**`syncDataViewport` at the top of `dispatchModeAction`:** The `syncDataViewport(modeToViewport(next))` call is hoisted to run unconditionally at the top of every `dispatchModeAction` invocation (before any branch-specific teardown). This ensures `dataViewport` is always updated on mode transitions, including internal Live-state flips (`live-trailing ↔ live-fixed`) where no teardown branch fires. See §10 divergence (Phase 6 syncDataViewport hoist).

**Phase 6 — Unified dispatch rule (implemented 2026-05-15, see `Docs/trend_dispatch_unified_rule_proposal.md`).**

The dispatch criterion for raw-vs-bucketed was replaced. Old rule: `bucketS < 1.0 → raw COV`. New two-step rule:

1. **Shape** (raw or bucketed): `expectedPoints = tileWindowSec × SAMPLE_RATE_HZ`. If `expectedPoints ≤ bucketCount` → raw COV; otherwise bucketed.
2. **Source table** (bucketed only): `bucketS < 1.0 → tag_samples` (raw-source bucketed, gapfill+locf directly on raw data); `bucketS ≥ 1.0` → existing CAG ladder unchanged.

`SAMPLE_RATE_HZ = 10` and `dispatchShape()` are exported from `@caro/db`. At `SAMPLE_RATE_HZ=10` and `bucketCount=500`, the crossover is at tile window > 50 s (visible window > 100 s). Preset impact: 1m stays raw; **5m and 15m flip from raw COV to bucketed (source: `tag_samples`)**. Validated via EXPLAIN ANALYZE 2026-05-15: bucketed is 35% faster DB-side and 3.3× smaller on the wire vs raw COV at production activity (~5.7 Hz). No client-side code changes — the discriminated union (`RawTrendTile` | `AggregateTrendTile`) is preserved; `'tag_samples'` was added to `AggregateTrendTile['source']` to label the new path.

---

## 6. Chart Rendering (`TrendChart.tsx`)

`TrendChart` manages the uPlot instance lifecycle via a single `useEffect` keyed on:

```
[tagIds, effectiveSelectedId, tagMap, width, height, siteTimezone]
```

A separate imperative effect (keyed on `xRange`) calls `u.setScale('x', ...)` without rebuilding — this is the live/preset/custom x-range update path.

**X-scale preservation across rebuilds** (legend click, tag add/remove): the cleanup function captures `u.scales['x'].{min, max}` into `preservedXRangeRef` before destroying the old instance. The new effect body reads and clears the ref, restoring the user's drag-zoom position. `preservedXRangeRef` is cleared on preset/Live/Custom because those go through the imperative `xRange` effect, which fires after the rebuild and overwrites any preserved range.

**Per-trace Y-scale overrides** (`yScaleOverridesRef`): wheel events and drag on the Y-axis region call helpers from `axisInteractions.ts` to update the per-trace override stored in the ref. On rebuild, overrides for removed tags are pruned and surviving overrides are restored to the new uPlot instance. Pan/zoom handlers reference `selectedTagIdRef` (a stable ref that shadows `effectiveSelectedId`) so stale closures never act on the wrong trace.

---

## 7. Container Wiring (`TrendChartContainer.tsx`)

`TrendChartContainer` is intentionally thin — it wires the hooks and passes props:

```
useTrendMode()         →  modeState, modeViewport, dispatch
useZoomState(...)      →  zoomAnchorSpan, dataViewport, syncDataViewport,
                          handleDragZoom, handleZoomLevelSwitch
useTrendData(...)      →  data, isLoading, ensureCovered, getActiveRange,
                          evictAll, refetchHistory,
                          swapCounter, activeTileCount
```

`dispatchModeAction` wraps `dispatch` for all mode transitions. Structure post-Phase-4/6:

1. **Unconditional at top:** `syncDataViewport(modeToViewport(next))` — fires on every mode action including internal Live flips.
2. **`wasLive && !willBeLive` branch:** `commitAndDrain()` → `refetchHistory()` (with `overfetchRightCount: 0`).
3. **`!wasLive && willBeLive` branch:** `evictAll()`. (`generation` NOT bumped — buffer is empty in fixed.)
4. **`isFreshLiveLanding` branch** (`prev.mode === 'live-fixed' && next.mode === 'live-trailing'`): `commitAndDrain()` + `evictAll()` (defensive). See §3 for why the scope is narrower than the original proposal.

`liveEdgeBehindWindow` is derived per-render as `latestSampleTs !== null && latestSampleTs < modeState.from` using `liveSubRef.current.getLatestSampleTs()` and passed to `EndPicker` as a prop for the orange button state.

It also renders:
- `TrendChart` (with `onXRangeChange` → `handleXRangeChange` RAF-coalesced → `zoomApplied`; `onXPan` → `handleXPan` RAF-coalesced → `panApplied`; `getActiveRange` passed through to `checkAndExtendXCoverage`)
- Footer row: `SpanBucketIndicator` | `SpanPresets` | `EndPicker + Live button`

It owns `tagIds` state (initialized from `initialTagIds` prop; removes come from `Legend` via `TrendChart.onTagRemove`). It derives `xRange` from `modeViewport` via `useMemo`. It passes `showLastWhenIdle={isLive(modeState.mode)}` to `TrendChart` (forwarded to `Legend`).

Props: `tagIds: number[]`, `siteTimezone?: string`, `height?: number` (default 420). Width is measured via `ResizeObserver` inside `TrendChart`.

---

## 8. Live Tail Runtime Architecture (Step 11, unified buffer post-Phase-2)

`useLiveSubscription` is the live-tail orchestrator. It lives in `TrendChartContainer` alongside `useTrendData`.

```
Spine fetch resolves (useTrendData live-spine branch):
  → seedFromSpineFetch(tagId, series, generation)
      if spineMetadataMatches(existing, series):  // same-fetch continuation
        apply live-wins-on-coverage clip
      else:                                        // wholesale replace
        skip clip; clear accumulatorsRef/rawBuffersRef/sessionHighWaterMark
      → write result to spineRef[tagId]

TREND_DELTA frame received (gated on isLive(mode) predicate):
  → update sessionHighWaterMark (latestSampleTs = max(hwm, maxAcrossSubscribedTags))
  → for each sample { moduleTs, tagId, value }:
      if aggregate mode (isLive):
        append to ringsRef[tagId]
        if moduleTs crosses next bucket boundary:
          close bucket → emit { ts, value, min, max, null_count }
          append to accumulator tail
      if raw mode (isLive):
        append to rawBuffersRef[tagId]
        trim rawBuffersRef to latestTs - 2×viewportSpanMs (NOT ringsRef)
  → left-trim unified buffer to latestSampleTs - 2×sizeMs

TrendChartContainer render (Live mode):
  mergedData = liveSub.getBufferSnapshot()
    → mergeTrendData(spineRef, accumulatorTail) at snapshot time
      aggregate: clips spine to liveEndIndex; tail fills right side
      raw: drops spine entries with ts >= minLiveTs; tail entries take their place
  → TrendChart receives clean merged snapshot

TrendChartContainer render (history mode):
  mergedData = useMemo(() => mergeTrendData(data, liveSub.tail), [data, liveSub.tail])

onDataReceived(maxModuleTs):
  if isLive(modeState.mode):
    dispatch({ type: 'tick', nowMs: BigInt(maxModuleTs) })
  → live-trailing: advances viewport, triggers xRange update → TrendChart.setScale('x', ...)
  → live-fixed: auto-promote check in reducer
```

**Key invariants:**
- `rawBuffersRef` is never trimmed by `trimThreshold`. Trimming it moves `minLiveTs` forward, allowing LOCF gapfill from after-prefetch tiles to leak through `mergeRaw`'s cached-drop filter as a flatline gap at tile boundaries.
- `useTrendData` in Live mode has `hookResult.data = null`; the LRU cache is neither read nor written. `activeTilesRef` stays empty, so `ensureCovered` is a no-op. The live-spine effect is gated by `isLiveRef` (ref-synced, not a dep) and `spineFetchInFlightRef` (in-flight deduplication).
- `latestSampleTs = max(sessionHighWaterMark, currentMaxAcrossSubscribedTags)`. Monotonic-non-decreasing within a session. Reset to `null` by `commitAndDrain`.
- Mode transition behavior: spec §10.6 (`dispatchModeAction` wrapper) and §10.8 (eviction-on-live-entry). Subscription lifecycle: spec §10.7.
- `seedFromSpineFetch` distinguishes same-fetch continuation from wholesale replace via `spineMetadataMatches(existing, series)`. On wholesale replace (preset change with different `bucketSMs`, range, or shape), it (a) skips the live-wins-on-coverage clip and (b) clears `accumulatorsRef`, `rawBuffersRef`, and `sessionHighWaterMarkRef` synchronously. See §10 divergences 25 and 26.
- `getBufferSnapshot` returns the spine unchanged when `tailModeRef.current` doesn't match `spine.type` — covers the one-render window before the consumer's `tailMode` catches up to a freshly-seeded spine of a different shape. See §10 divergence 27.

**Stable refs pattern.** `modeStateRef`, `trendDataRef`, `liveSubRef` are updated synchronously during render (not in `useEffect`) so all callbacks read current values without stale closures.

---

## 10. Implementation Divergences from Spec

Divergences from the spec that remain current. Entries absorbed into the spec during Phase 1 audit and subsequent passes have been removed — gaps in numbering are intentional. Rejected design alternatives appear in [Historical decisions](#historical-decisions) below.

14. **Raw path unified into a single SQL query** — in-window samples and bounded-prev run as one UNION ALL query with an `is_in_window` discriminant column. One connection per raw tile.

23. **uPlot `range` function reads from `userScaleRef`** — the xScale `range` function returns `userScaleRef.current` if set, else defers to uPlot's default autoscale. The ref is updated synchronously before every `setScale` call. Required because uPlot clamps an identity `range` return to the data extent, ignoring `setScale` requests that exceed it.

24. **`setSelectHook` updates `userScaleRef` before calling `u.setScale`** — the drag-zoom handler in `uplotConfig.ts` must write `userScaleRef.current` before `u.setScale`. If the ref is stale at fire time, `u.scales['x']` locks at the previous range. Calling `setScale` first then updating the ref is wrong.

25. **`spineMetadataMatches` gates the live-wins-on-coverage clip in `seedFromSpineFetch`** — the clip uses `accState.firstClosedStartMs` to position live data in the new spine's bucket grid. That math is only valid when the accumulator's bucketing matches the new spine's `bucketSMs`. On wholesale replace (preset change crossing `bucketSMs`, e.g., 15m → 5m), the accumulator's `firstClosedStartMs` is from the prior preset's bucketing and would clip the spine at a wrong index — producing `entry.value.length < series.n`. Gating the clip on `spineMetadataMatches(existing, series)` skips it on wholesale replace; the spine retains all `series.n` entries. The clip still applies for same-fetch continuation (subsequent tags within the same `.then` loop, where metadata matches by construction).

26. **`seedFromSpineFetch` clears accumulators / rawBuffers / sessionHighWaterMark on wholesale replace** — when `!isContinuation` AND the new `series.bucketSMs` differs from `bucketSMsRef.current` (aggregate path), or unconditionally on `!isContinuation` (raw path), the buffers are cleared synchronously inside `seedFromSpineFetch` before the spine update. Without this clear, the next render's `getBufferSnapshot` builds a tail from the OLD-bucketing accumulator data using the NEW `bucketSMs` (after the in-render ref sync), and `mergeAggregate` places prior-preset-era buckets at new-grid indices — producing a `totalN` proportional to `time-in-prior-preset` and a corresponding chart gap anchored at preset-press time. The `tailMode` effect's clear runs post-render and is too late. `ringsRef` is NOT cleared — it's the source for the `tailMode` effect's replay.

27. **Type-coherence guard in `getBufferSnapshot`** — before calling `mergeTrendData`, check that `tailModeRef.current` matches `spineRef.current.type`. They can disagree for one render between a new spine landing via `seedFromSpineFetch` and `TrendChartContainer` recomputing `tailMode` from `cachedData.type`. Without the guard, `mergeTrendData` logs a `[mergeTrendData] type mismatch` warning. The guard returns the spine unchanged in that one-render window.

28. **Split live/history paths for `mergedData` in `TrendChartContainer`** — live mode calls `liveSub.getBufferSnapshot()` directly every render (no `useMemo`); history mode uses `useMemo(() => mergeTrendData(data, liveSub.tail), [data, liveSub.tail])`. The live branch requires this because `getBufferSnapshot` reads `spineRef` and `tailModeRef` — both refs, not in any `useMemo` dep set. Memoizing the live branch causes the merge to return cached stale data when `setSwapCounter` triggers a re-render after a new spine arrives. History mode's `data` comes from `useTrendData`'s React state, so the memo's deps catch changes correctly. Cost: one extra `mergeTrendData` call per render in live mode — bounded buffer, trivial.

29. **`lastChartDataRef` bridges chart data across mode transitions** — `TrendChartContainer` maintains a ref of the most recent non-null `chartData`, updated synchronously during render. The chart receives `effectiveChartData = chartData ?? lastChartDataRef.current`. Prevents `<TrendChart>` from unmounting during the brief window where `chartData` is null between transitions (history → live before spine resolves; live → history before history refetch resolves), keeping the uPlot canvas mounted. Initial load (ref still null AND `chartData` null) falls through to the loading-hint placeholder as before.

30. **Symmetric window-vs-live-edge rule supersedes proposal D6 / D7.** The reducer classifies `panApplied`, `zoomApplied`, and `endPickerCommitted` uniformly from any starting state using a single `classifyByWindow(latestSampleTs, action.to)` helper: `to > latestSampleTs` → `live-fixed`; `to <= latestSampleTs` → `fixed`. This departs from the original D6 (endPicker-from-fixed stays `fixed` regardless of picked End) and D7 (zoom always → `fixed`): zoom from `live-*` still → `fixed` per the table (zoom is still exploratory), but the classification is now handled by the same helper branch. `endPickerCommitted` from `fixed` with a future End now enters `live-fixed`. Documented in spec §9.3 and §12.2 as the as-built contract.

31. **`syncDataViewport` hoisted to top of `dispatchModeAction` (Phase 6).** Originally, `syncDataViewport(modeToViewport(next))` was called inline within specific teardown branches (`wasLive && !willBeLive`, `!wasLive && willBeLive`). It is now called unconditionally at the top before any branch logic fires. This fixes blank-window and accumulator-freeze bugs where the `wasLive && willBeLive` (internal Live flip) branch had no `syncDataViewport` call. The per-branch inline calls were retired after the hoist.

### Historical decisions

Design alternatives that were explicitly considered and rejected. Recorded here so future readers understand why the current approach was chosen.

20. **Watchdog null marker dropped** — original plan had `TelemetryIntake.watchdogTick()` emit a synthetic null at `lastSeen + 1 ms` to mark the precise gap start. Dropped: LKV null + synthetic-on-flush achieves the same bucket-null result without per-tag bookkeeping. Trade-off: gap-start timestamp lags by up to one watchdog-tick interval (~500 ms worst case).

21. **Open-tile model rejected** — spec §10.6 described cached tiles mutated as live data accumulated. Rejected in favor of tail-extension: cached tiles are immutable; `useLiveSubscription` owns a separate accumulator; `mergeTrendData` concatenates at render. `evictAll()` on Live entry handles cache freshness; see spec §10.8.

22. **`responseTailTs`-based raw buffer trim dropped for 2×Span** — original plan trimmed raw buffers to `moduleTs >= responseTailTs - 1000` (same threshold as the ring). Dropped: advancing `trimThreshold` as tiles loaded pushed `minLiveTs` forward in `mergeRaw`, letting LOCF gapfill leak through the cached-drop filter. Raw buffers trimmed to `latestTs - 2×viewportSpanMs` in the WS callback instead; cleared on live exit via `commitAndDrain`.

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

**`rawBuffersRef` must never be trimmed on `trimThreshold` advance.** The `trimThreshold` (derived from `responseTailTs - 1000`) advances as new tiles load. If `rawBuffersRef` were trimmed alongside the ring, `minLiveTs` in `mergeRaw` would advance, causing LOCF gapfill from newly-fetched after-prefetch tiles to survive the cached-drop filter and render as a flatline gap at each tile-boundary crossing. Trim only the ring; raw buffers are cleaned via 2×viewportSpanMs in the WS callback and cleared entirely on live exit via `commitAndDrain`.

**`useTrendData` skip guard silences all tile fetches while in Live mode.** While `isTailing && !spanChanged && activeTiles.length > 0`, `useTrendData` returns early without fetching. This is intentional — any tile arriving while in Live mode can have LOCF gapfill past the tile's actual data extent, and merging it against the live buffer creates flatline contamination. The guard eliminates the merge-bug class. Side effect: because `evictAll()` clears the cache on Live entry, the first viewport change in the subsequent fixed mode always triggers a full tile refetch (expected; clean historical data loads correctly).

**`TREND_DELTA` boolean values arrive as `true`/`false`.** The TimescaleDB writer coerces booleans to DOUBLE PRECISION (1.0/0.0), but the WS trend path delivers the raw LKV value which may be a boolean. `toNumericValue` in `useLiveSubscription` applies `true → 1`, `false → 0`. Without this coercion, boolean trend tags render as null gaps in the live tail even when data is arriving correctly.

**`dispatchModeAction` vs direct `dispatch`.** Actions that can exit Live mode (zoom, pan, endPicker) must go through `dispatchModeAction` to trigger `commitAndDrain` atomically before the state transition. The Live button (fixed→live-*) also goes through `dispatchModeAction` to trigger `evictAll()` before entering Live mode. Direct `dispatch` is only for `tick`. Mixing them produces either a stale live buffer in the fixed view (if `dispatchModeAction` is skipped on exit) or a missed cache eviction (if skipped on live entry).

**Pan-back data-loss window.** On live → fixed transition, `commitAndDrain` clears the live buffer immediately. Live values that arrived in the last ~`TIMESCALE_DB_TICK_MS` + FIFO trim buffer (~1.5 s by default: 500 ms DB tick + 1 s trim tolerance) may not yet be committed to TimescaleDB when the next REST fetch fires. Those values are not lost in the historian — they land within the next DB flush cycle — but the brief in-transit window renders as null/gap until the subsequent refetch picks them up. Deliberate property of the tail-extension model: keeping live-exit synchronous and simple outweighs the cost of a sub-2 s null flash on pan-back. Not a bug.

**`commitAndDrain` must reset per-tag arrays in place, not `.clear()` the map.** `rawBuffersRef` is `Map<tagId, Array>`. Calling `.clear()` removes every per-tag key; the subscribe callback's `if (buf)` guard then silently drops every subsequent event until something re-allocates the map keys. Production lifecycle mode-flip + tailMode-effect re-allocation masked the bug, but it surfaces immediately under stable-mode drain (the TG-7 audit test). Fix: `for (const arr of rawBuffersRef.current.values()) arr.length = 0` plus `setTail(null)` for explicit React-state drain. Spec §10.6 documents the contract; the in-place mutation pattern is the implementation choice that matches it. Surfaced + closed during the 2026-05-17 audit pass.

**EXPLAIN of `locf(prev => ...)` hides the prev subquery in TimescaleDB 2.26.3 output.** When validating chunk pruning on the bounded-prev pattern (spec §5.5), `EXPLAIN (FORMAT JSON)` on a `locf()` call does not expose the nested correlated subquery in the plan tree — pruning structure for the `prev` lookup is invisible. The TG-1 plan-assertion test (`packages/db/__tests__/timescale/trends.test.ts`) works around this by extracting the inner prev SQL directly from `buildGapfillSql`'s output via regex and EXPLAIN-ing it as a standalone statement. Future tests of the bounded-prev shape must do the same.

**EXPLAIN with parameter bindings uses the generic plan (statistics-based pruning), not constraint exclusion.** Related to the above: `EXPLAIN (FORMAT JSON) $sql` with `[params]` goes through the Extended Protocol → prepared statement → generic plan after the 5th execution. Generic plans use row-count statistics for chunk pruning, which silently prunes empty chunks regardless of whether the bounded-prev's `INTERVAL '5 minutes'` filter is present. To verify constraint-based exclusion (what production sees), substitute literal values into the SQL before EXPLAIN. Spec §5.5 has the production-side prepared-statement warning; this is the test-side corollary. Surfaced during TG-1 implementation.

---

## 11. Known Issues

Observations from production behavior. Not divergences from spec — document here rather than in delta files.

**A. modeState.nowMs advances at trend-channel flush rate (~4 Hz) instead of 1 Hz.** Each `TREND_DELTA` frame triggers `handleDataReceived` → `dispatch(tick)` → `modeViewport` change → `useZoomState` reset effect → `dataViewport` change → `useTrendData` main effect. The spine-fetch skip guard prevents redundant fetches but the React render chain runs at 4 Hz regardless. The root cause appears to be something downstream of `useLiveSubscription`'s WS flush dispatching a tick on every frame. Worth a separate investigation; the renders are wasted work but not currently causing visible regressions.

**B. Data gaps near right edge after live→fixed transition.**

*Gap A (closed, 2026-05-16).* Originally described as a CAG-lag null band at the right edge of the newly-fixed viewport after live→fixed transition. Closed by future-bucket nulling (spec §6.5): buckets whose `bucketStartMs > responseTailTs` are set to `(null, null, null)` server-side at request entry, so the post-transition right edge shows the chart line trailing off naturally at `responseTailTs` — visually identical to the live-tail's trailing edge. The residual writer-lag gap (`TIMESCALE_DB_TICK_MS = 500 ms` + ~1 s FIFO trim tolerance) sits in `[responseTailTs - 1.5 s, responseTailTs]` and is filled by `time_bucket_gapfill + locf` for bucketed presets. Every bucketed preset has `bucketSMs ≥ 300 ms` (5m and larger), making the lag sub-bucket or sub-perceptual; the 1m raw-COV preset uses no LOCF and is unaffected. The ring-survives-transition follow-up architecture proposed in earlier revisions of this section is no longer needed — watermark-aware fall-through (spec §4.3) combined with future-bucket nulling jointly handle the right-edge case.

*Gap B (cross-session frozen cache nulls) — closed (2026-05-13).* In the prior architecture, CAG-lag nulls could be written to the tile cache and frozen there indefinitely. Users who toggled between live and fixed would see stale nulls accumulate across sessions. Eliminated by eviction-on-live-entry: `dispatchModeAction` calls `evictAll()` on every fixed→live-* (Live button) transition, clearing the cache so each live session starts with a clean slate. See `hmi_trend_viewer_spec.md` §10.8.

**C. ~~`pruneAndAdd` may overwrite real data with flat-line data during drag-zoom-then-pan.~~**
Closed (2026-05-14). Root cause: `ensureCovered` derived `tileSpanMs` from the current viewport rather than the active set's actual tile widths, producing misaligned candidates during the in-flight window of zoom commits. Fixed by anchoring `tileSpanMs` to `active[0]!.endTime - active[0]!.startTime` in `useTrendData.ts` `ensureCovered` (commit 873e2cb). Follow-up b599003 restored `panThresholdCheck` symmetry — both `ensureCovered` and `panThresholdCheck` now use the active set's tile width (via `getActiveRange().tileSpanMs`), eliminating multi-candidate fan-out when wheel-zoom diverges from `dataViewport`. Manual verification: drag-zoom-then-pan, wheel-zoom-then-pan, pan-prefetch at 50%, live→fixed transitions, and over-range suppression all pass with no flat-line artifacts.

**D. Synthetic-on-flush uses HMI server `Date.now()` for `moduleTs` (mixed clock domains).** The synthetic-on-flush mechanism (spec §4.4) exists to propagate LOCF (last-observation-carried-forward) values from the server's LKV to the client's bucket accumulator at `TREND_FLUSH_HZ` cadence. For flatline tags, the LKV is constant by definition — the value at any flush moment equals the value at any other flush moment in the flatline window — so the **synthetic's exact `moduleTs` is not critical**, only that it advances the client's bucket boundaries. Real samples in the same `TREND_DELTA` frame carry the device's `moduleTs` (from MQTT ingest); synthetics carry `Date.now()`. At well-NTP-synced installations the drift is <100 ms — bucket boundary placement for synthetics may shift by that amount relative to real events, but the *value* placed in those buckets is identical regardless of which side of the boundary the synthetic lands. The 1-second `responseTailTs - 1000ms` trim margin (spec §6.2) absorbs typical drift comfortably. Not a fix-target; documented so future readers understand the design intent.

Issues E, F, and G below are architectural consequences of the parallel live-spine vs. history-tile fetch paths. They are not individually patchable in a way that is both cheap and durable — the Phase B unification proposal is the right resolution for all three. See `Docs/trend_unify_live_history_fetch_proposal.md`.

**E. Sometimes left-edge of the visible window is blank in Live mode after zoom-out.** After certain zoom-out sequences within Live mode (specifically, when the viewport's left edge is pushed into a range the spine does not cover), the leftmost portion of the visible window may appear blank even though data exists in the historian. The spine fetch covers only the current viewport at the time of the fetch; a subsequent zoom-out to the left is not covered until the next spine fetch completes. The `syncDataViewport` hoist (Phase 6, divergence 31) closes the most common path — the `wasLive && willBeLive` branch now always syncs `dataViewport` before triggering a new spine fetch. Edge cases involving overlapping zooms that update `dataViewport` before the prior spine fetch settles can still produce a momentary left-blank. Self-resolves when the next spine fetch lands. Tracked in `Docs/trend_unify_live_history_fetch_proposal.md` — Phase B unification will close this by construction.

**F. Sometimes a gap of ~1–3 buckets appears at the spine/tail seam.** At preset-press time or after a zoom that triggers a fresh spine fetch, a brief visual gap can appear at the boundary where the spine ends and the WS accumulator begins. The gap window is bounded by `~500 ms` (writer-lag) plus FIFO trim tolerance. The `seedFromSpineFetch` wholesale-replace clear (divergence 26) addresses the case where a `bucketSMs` change left stale accumulator data bridging across bucket boundaries. The residual gap is inherent to the serial fetch → seed → accumulate pipeline: the accumulator cannot bridge the gap until it receives a `TREND_DELTA` with a timestamp that falls within the seam. At 4 Hz flush rate, the gap resolves within ~250 ms under normal WS delivery. Tracked in `Docs/trend_unify_live_history_fetch_proposal.md` — Phase B unification will close this by construction.

**G. Sometimes live-fixed does not update until a transition to live-trailing forces a refetch.** Rare timing scenario: when `live-fixed` is entered via a pan or zoom action that races with an in-flight spine fetch, the new `dataViewport` may not match the completed spine's coverage. The result is that the chart displays the prior spine's data until the next `commitAndDrain` + `evictAll` cycle (triggered by the user clicking the Live button to re-enter `live-trailing`). The `syncDataViewport` hoist (Phase 6) closes the dominant path by ensuring `dataViewport` is updated before any branch fires. A narrow timing window remains: if the mode reducer fires between the hoist and the spine fetch dispatch, the fetch may use a stale viewport. Operator workaround: click the Live button to force re-entry into `live-trailing`. Tracked in `Docs/trend_unify_live_history_fetch_proposal.md` — Phase B unification will close this by construction.

---

## 12. What Comes Next

> **Note:** `@caro/trend-chart` ships from `dist/`. After editing source, run `npm run build --workspace=packages/trend-chart` before testing in the browser. Tests run against source directly.

| Step | Summary | Spec reference |
|---|---|---|
| 12 | **Tag picker drawer**: tree + search (§11.2), multi-select commit (§11.3), trendable filter (§11.4). | §11 |

> Pool sizing and other operational monitoring watchlist items live in `Docs/platform_todo.md`, not as development steps.

**Reading order for Step 12:**
1. This file (orientation, especially §7 Container Wiring)
2. `apps/caro-hmi/CLAUDE.md` — trendable tag route (`GET /api/v1/tags/trendable`) and WS architecture
3. `Docs/hmi_trend_viewer_spec.md` §11 — Tag Picker spec
4. `packages/trend-chart/src/TrendChartContainer.tsx` — wire point for `tagIds` state (`setTagIds`)
