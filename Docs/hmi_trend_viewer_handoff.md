# CARO_HMI Trend Viewer — Subsystem Handoff
**Updated:** 2026-05-01 | **Phase A Steps 1–10 Complete** | **Next:** Step 11 (Live tail)

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
| 9 | `TrendChart` static rendering: uPlot wrapper, per-trace Y-scales, legend, tooltip, ResolutionIndicator | ✅ Done |
| 10 | Mode state machine + time-range UI: tailing/fixed transitions, preset strip, custom picker, Live button, pan/zoom interactions | ✅ Done |

**Test coverage (2026-05-01):** 254 passing in `@caro/trend-chart` (14 test files), 93 in `@caro/db`, 226 in the HMI server.

---

## 2. `packages/trend-chart/` — Actual File Map

```
packages/trend-chart/
  src/
    index.ts                      # all public exports
    types.ts                      # Tile, Viewport, AggregateSeriesData, RawSeriesData, TrendData

    # ── Core primitives (no React) ─────────────────────────────────────────────
    level.ts                      # alignedTilesInRange, tilesForViewport, deriveBucketSMs,
                                  # TREND_VIEWER_DEFAULTS, TS_BUCKET_ORIGIN_MS, floorDiv, ceilDiv
    tileCache.ts                  # TileCache (LRU, 50 MB cap), makeTileCacheKey
    colorAssign.ts                # colorAssign(tagId), PALETTE, PALETTE_SIZE

    # ── React hooks ───────────────────────────────────────────────────────────
    useTrendData.ts               # REST fetch orchestration; owns the TileCache instance;
                                  # returns { data, isLoading, error, ensureCovered,
                                  #           swapCounter, activeTileCount }
    useTrendMode.ts               # tailing/fixed mode state machine; exports reducer
                                  # for unit testing; NEAR_NOW_MS, LIVE_MODE_ENABLED (dormant)
    useZoomState.ts               # zoom level state; exports computeDragZoomViewport (pure,
                                  # tested separately); syncs to modeViewport via useEffect

    # ── Axis interaction helpers (pure, no React) ─────────────────────────────
    axisInteractions.ts           # pruneRemovedTagOverrides, isInYAxisHitZone, panYScale,
                                  # zoomYScale, panThresholdCheck, isInXAxisHitZone,
                                  # panXScale, zoomXScale, checkAndExtendXCoverage

    # ── Components ────────────────────────────────────────────────────────────
    TrendChart.tsx                # uPlot canvas wrapper; manages rebuild lifecycle,
                                  # X-scale preservation across rebuilds, per-trace Y-scale
                                  # overrides, wheel/drag handlers, cursor state
    TrendChartContainer.tsx       # stateful wiring layer: useTrendMode + useZoomState +
                                  # useTrendData + TimeRangeBar + TrendChart
    TimeRangeBar.tsx              # preset buttons (15m/1h/4h/24h/7d/14d) + Custom picker +
                                  # Live button; dispatches mode actions up via callbacks
    Legend.tsx                    # per-trace rows with color swatch, value, remove button
    ResolutionIndicator.tsx       # shows current bucketS in human-readable form (e.g. "3.8 min")

    render/
      uplotConfig.ts              # builds uPlot Options; onCursorChange callback (idx, tsMs)
      yScales.ts                  # per-trace Y-scale defaults (eng_min/max, autoscale, bool)
      seriesFromTrendData.ts      # maps TrendData → uPlot series definitions
      formatters.ts               # formatBucketS, formatValue, formatTimestamp

    __tests__/
      level.test.ts               # alignedTilesInRange, tilesForViewport, deriveBucketSMs
      tileCache.test.ts           # LRU eviction, cache key, size accounting
      colorAssign.test.ts         # deterministic palette assignment
      api.test.ts                 # aggregated wire format parsing
      useTrendData.test.ts        # fetch orchestration, fan-out, stale-gen, ensureCovered
      useTrendMode.test.ts        # trendModeReducer pure unit tests
      axisInteractions.test.ts    # all 9 helper functions
      TrendChartContainer.test.tsx # container behavior: presets, Live, Custom, tag remove,
                                  # loading hints; computeDragZoomViewport pure tests
      trendChart.test.tsx         # TrendChart render, Y-scale defaults, legend display
      legend.test.tsx             # Legend component unit tests
      render/yScales.test.ts      # yScales helpers
```

---

## 3. Mode State Machine (`useTrendMode.ts`)

Two modes: `tailing` and `fixed`. The reducer is pure and unit-tested separately.

```typescript
type ModeState =
  | { mode: 'tailing'; sizeMs: bigint; nowMs: bigint }
  | { mode: 'fixed'; from: bigint; to: bigint; sizeMs: bigint }  // sizeMs preserved for liveClicked
```

**Actions:** `presetClicked`, `liveClicked`, `customCommitted`, `viewportChanged`, `tick`.

**Key transition rules:**
- `presetClicked` → always tailing, `sizeMs = preset duration`, `nowMs = now`
- `liveClicked` from fixed → tailing, `sizeMs = state.sizeMs` (preserves prior window size)
- `customCommitted` with `to ≥ nowMs - NEAR_NOW_MS` (60s) → tailing; otherwise → fixed
- `viewportChanged` follows the same near-now heuristic as `customCommitted`
- `tick` → only advances `nowMs` in tailing (dormant: `LIVE_MODE_ENABLED = false` at module scope)

`modeToViewport(state)` derives `Viewport { start: bigint; end: bigint }` from state:
- Tailing: `{ start: nowMs - sizeMs, end: nowMs }`
- Fixed: `{ start: from, end: to }`

**`LIVE_MODE_ENABLED = false`** — the 1 Hz interval that dispatches `tick` is disabled pending Step 11 (WebSocket). The `tick` reducer case and `viewportChanged` action are preserved for Step 11. Setting `LIVE_MODE_ENABLED = true` re-enables auto-advance.

---

## 4. Zoom State (`useZoomState.ts`)

`useZoomState` owns three pieces of state:

| State | Type | Role |
|---|---|---|
| `currentBucketSMs` | `bigint` | Current bucket size in ms — drives `computeDragZoomViewport` |
| `zoomAnchorSpan` | `bigint` | Full viewport span at the current zoom level — drives uPlot autoscale |
| `dataViewport` | `Viewport` | The aligned viewport passed to `useTrendData` |

A `useEffect` keyed on `modeViewport.start/end` resets all three whenever the mode changes (preset click, Live click, custom commit). This ensures preset/Live/Custom always start from a clean zoom level.

`handleDragZoom(selStart, selEnd)` and `handleZoomLevelSwitch('in'|'out', cursorMs)` update all three atomically. `computeDragZoomViewport` is exported for direct testing.

---

## 5. Data Fetch (`useTrendData.ts`)

`useTrendData({ viewport, tagIds })` drives tile fetches. Key behaviors:

- **Tile geometry**: `TREND_VIEWER_DEFAULTS.bucketCount=500`, `visibleTilesPerWindow=2`, `overfetchPerSide=1`. `deriveBucketSMs(viewport)` derives the bucket size from viewport span.
- **`ensureCovered`**: called by TrendChart's wheel/pan handlers to request additional tiles. Anchors candidate tiles to the *active-set edges* (`cachedStart`/`cachedEnd`) rather than re-computing from `TS_BUCKET_ORIGIN_MS` — walks outward from the current cache boundary.
- **`swapCounter`**: incremented each time the tile set swaps on a bucket-size change (zoom across a §6.3 dispatch threshold). TrendChart uses this to trigger a full uPlot rebuild.
- **`activeTileCount`**: count of tiles currently in the active set — used by `ResolutionIndicator` and tests.
- **Stale-generation guard**: each fetch call captures a generation at dispatch; if `viewport` or `tagIds` change before the fetch resolves, the result is discarded.

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

It owns `tagIds` state (initialized from `initialTagIds` prop; removes come from `Legend` via `TrendChart.onTagRemove`). It derives `xRange` (the imperative X-scale update value) from `modeViewport` via `useMemo`.

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

See `Docs/hmi_trends_deltas.md` for the canonical list. Key items:

1. **`TrendChartContainer`** — spec §7.1 calls the wrapper `TrendChartProvider`; renamed because it is not a React Context provider.
2. **`ModeState.sizeMs` on fixed branch** — spec §9.3 union omits it; required to implement "liveClicked preserves prior sizeMs".
3. **Axis interaction gating = hover-zone, no modifier key** — spec §9.1/§9.2 described a Shift-key modifier; the implementation uses hit-zone detection (`isInYAxisHitZone` / `isInXAxisHitZone`) instead. Hover the Y-axis margin for Y pan/zoom; hover the X-axis margin for X wheel-zoom; drag anywhere on the plot area for drag-zoom.
4. **Custom range picker uses `Intl.DateTimeFormat`** with `siteTimezone` for `datetime-local` interpretation.
5. **Tile alignment origin = `TS_BUCKET_ORIGIN_MS = 946_857_600_000n`** (2000-01-03 UTC) — TimescaleDB's actual `time_bucket()` default origin, not Unix epoch.
6. **`ensureCovered` anchors to active-set edges** — does not re-derive from `TS_BUCKET_ORIGIN_MS`; imported `floorDiv`/`ceilDiv`/`TS_BUCKET_ORIGIN_MS` removed from `useTrendData.ts`.
7. **`getTrendTile` LOCF cutoff at `MAX(ts)`** — outer CASE expression nulls any gapfill bucket past the data extent, preventing LOCF propagating into future buckets.

---

## 10. What Comes Next

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
