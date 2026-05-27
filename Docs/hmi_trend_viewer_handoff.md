# CARO_HMI Trend Viewer — Subsystem Handoff
**Updated:** 2026-05-27 | **Phase A Steps 1–12 complete** | **Next:** TBD (see `Docs/platform_todo.md`)

---

## 1. What Was Built

Phase A Steps 1–11 are complete. Steps 1–6 delivered the server-side trends API and TimescaleDB CAGs. Steps 7–10 delivered the `@caro/trend-chart` client package. Step 11 wired the live tail end-to-end.

| Step | Deliverable | Status |
|---|---|---|
| 1 | T005 1s CAG replacement (delivered as `T006_replace_1s_cagg.sql` — drops `caro_samples_1s`, creates `tag_samples_1s_cagg` with `null_count` column and correct chunk intervals) | ✅ Done |
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
| 12 | Tag picker modal: gear icon in Legend's `<thead><th colSpan={5}>` opens modal; flat alphabetical trendable-tag list (left pane) + Trending list (right pane); click-to-stage, × to unstage, search filter, 16-tag stage cap; OK commits to `setTagIds`; inline-style chrome via `@caro/ui Modal` | ✅ Done |

**Test coverage (2026-05-27):** 770 passing in `@caro/trend-chart`, 67 in `@caro/hmi-context`, 156 in `@caro/db`, 301 in the HMI server, 33 in the HMI client.

**Audit remediation pass (2026-05-15 → 2026-05-17):** all items from the May 2026 trend-viewer audit landed across Phases 1–5. Notable architectural change: **M1 metadata-as-return-value** — `getTrendTile()` now returns `Promise<{ tile, meta }>` (see spec §4.1 / §14.7); the `__test_lastUsedSources` module singleton is gone, with per-segment source/timing/rowCount now flowing through `meta.segments[]`. Operational hardening: F5 per-tag outbox cap (spec §4.4), TG-7 `commitAndDrain` bug fix (§10 gotcha below), TG-1 plan-pruning regression test (§10 gotcha below). All other items were refactors, test additions, or comment cleanup with no observable behavior change.

**Unified-tile refactor (2026-05-21).** The Step 8 / Step 11 fetch architecture — a separate live-spine path and history-tile path — was replaced by a single tile pipeline (`runTileFetch`) governed by the **terminal-cache rule**: a tile enters the LRU only once it is terminal, and the live-edge tile is held uncached in `activeTilesRef`. This closed handoff Issues E, F, and G by construction and removed `liveSpineFetch.ts`, `historyTileFetch.ts`, `seedFromSpineFetch`, `getBufferSnapshot`, `evictAll`, `refetchHistory`, the spine generation counter, and `commitAndDrain` (now `drainBuffers`). §5 and §8 describe the as-built unified architecture; spec §10.6 is the design reference. A follow-up fix (audit H4) keeps `drainBuffers` from clearing the ring.

**Unified-viewport + storm-fix arc (2026-05-24).** `dataViewport` eliminated from `useZoomState`; `useTrendData` is now driven by `modeViewport` + an explicit `bucketSMs` — fetch coverage follows the display viewport directly, closing the blank-tile-on-zoom-out regression. `tilesForViewport` now takes an explicit `tileSpanMs` (= `currentBucketSMs × bucketCount`) and emits a variable 2–4 tile count (left-anchor strategy) covering the full viewport; `ensureCovered`, `checkAndExtendXCoverage`, `panThresholdCheck`, and `getActiveRange` were removed. `MAX_VISIBLE_TILES = 16` cap makes tile storms structurally impossible. `useZoomState` derives the non-zoom resolution at render time (`derivedBucketSMs = modeViewportSpan / buckets`), eliminating the one-render transient that fired ≥1000 tile requests when clicking a wide preset after a narrow zoom. `mergeAggregate` gained a `liveStartIndex >= 0` guard preserving cached data when `live.startMs < cached.startTime`. Test count: 586 → 694.

---

## 2. `packages/trend-chart/` — Actual File Map

```
packages/trend-chart/
  src/
    index.ts                      # all public exports
    types.ts                      # Tile, Viewport, AggregateSeriesData, RawSeriesData, TrendData
    api.ts                        # fetchTile() — typed REST fetch; TileApiResponse discriminated union

    # ── Core primitives (no React) ─────────────────────────────────────────────
    level.ts                      # alignedTilesInRange, tilesForViewport (explicit tileSpanMs,
                                  # left-anchor grid, variable 2–4 visible tiles, startTime<0n
                                  # filter, MAX_VISIBLE_TILES=16 defense-in-depth cap),
                                  # TREND_VIEWER_DEFAULTS, TS_BUCKET_ORIGIN_MS,
                                  # MAX_BUCKET_S (mirror of @caro/db), MAX_VIEWPORT_SPAN_MS,
                                  # floorDiv, ceilDiv
    tileCache.ts                  # TileCache (LRU, 50 MB cap), makeTileCacheKey
    colorAssign.ts                # colorAssign(tagId), PALETTE, PALETTE_SIZE
                                  # (date formatting lives in @caro/ui — formatDateTime / formatDate)
    bigintMath.ts                 # clampLowerBound + bigint helpers

    # ── Axis interaction helpers (pure, no React) ─────────────────────────────
    axisInteractions.ts           # pruneRemovedTagOverrides, isInYAxisHitZone, panYScale,
                                  # zoomYScale, isInXAxisHitZone, panXScale, zoomXScale
                                  # (panThresholdCheck and checkAndExtendXCoverage removed
                                  # in unified-tile refactor)

    # ── useTrendData sub-modules (F15, 2026-05-14) ───────────────────────────
    tileActiveSet.ts              # ActiveTileEntry / CachedEntry / HookState types;
                                  # assembleData, storeTileResult, storeNullTile,
                                  # synthesizeNullTile, makeActiveTileEntry[FromCache],
                                  # computeCommittedThroughTs, pruneAndAdd, chunkArray
    gatedFetchTile.ts             # buildGatedFetchTile factory —
                                  # CLIENT_OVER_RANGE / CLIENT_UNDER_RANGE / CLIENT_PRE_EPOCH
                                  # sentinel logic; GatedFetchFn type alias
    runTileFetch.ts               # runTileFetch — the unified fetch pipeline (live + history):
                                  # tilesForViewport, needsFetch freshness predicate,
                                  # terminal-cache rule, run-independent resolve flow

    # ── React hooks ───────────────────────────────────────────────────────────
    useTrendData.ts               # hook shell: state/ref allocation, the single fetch
                                  # useEffect (calls runTileFetch), the commit callback,
                                  # the 2s live heartbeat; re-exports pruneAndAdd.
                                  # returns { data, isLoading, error, swapCounter,
                                  #           activeTileCount, lastFetchMs, committedThroughTs,
                                  #           activeTilesRef, invalidateNonTerminalTiles }
    useTrendMode.ts               # live/fixed three-state mode machine; exports reducer for unit
                                  # testing; tick action dispatched by TrendChartContainer on
                                  # TREND_DELTA receipt
    useLiveSubscription.ts        # trend WS subscription + ring buffer + bucket
                                  # accumulator (aggregate) + raw buffer (raw mode);
                                  # drainBuffers() clears accumulator + rawBuffers (NOT the
                                  # ring); TREND_RING_CAPACITY=20 per tag; returns LiveTail
                                  # (AggregateTail | RawTail | null)
    mergeTrendData.ts             # Step 11: merges cached TrendData + LiveTail; unified
                                  # coverage rule — live wins on its range (null included);
                                  # aggregate clips to liveEndIndex, raw drops ts>=minLiveTs;
                                  # no isTailing parameter
    useZoomState.ts               # zoom level state (currentBucketSMs, zoomAnchorSpan);
                                  # render-time derivation for non-zoom intents
                                  # (derivedBucketSMs = modeViewportSpan / buckets);
                                  # sticky gestureBucketSMs ONLY while lastIntent='zoom';
                                  # exports computeDragZoomViewport (pure)

    # ── Components ────────────────────────────────────────────────────────────
    TrendChart.tsx                # uPlot canvas wrapper; manages rebuild lifecycle,
                                  # X-scale preservation across rebuilds, per-trace Y-scale
                                  # overrides, wheel/drag handlers, cursor state;
                                  # accepts bucketSMs/lastFetchMs props and forwards to Legend
    TrendChartContainer.tsx       # stateful wiring layer: useTrendMode + useZoomState +
                                  # useTrendData + TrendChart + footer row components;
                                  # passes bucketSMs/lastFetchMs to TrendChart (no cursorTsMs
                                  # state — cursor row lives in Legend)
    SpanBucketIndicator.tsx       # kept for backward-compat export; superseded by the
                                  # SpanIndicator + BucketFetchIndicator split below
    SpanIndicator.tsx             # footer: viewport span only (e.g. "Span: 4 h")
    BucketFetchIndicator.tsx      # legend strip (below tag table): bucket size + last fetch;
                                  # null-displayed ("—") until first fetch
    SpanPresets.tsx               # footer: 8-preset strip (1m/5m/15m/1h/4h/24h/7d/14d);
                                  # highlight: lastIntent!==null && lastIntent!=='zoom' && sizeMs match
                                  # (any size-preserving intent stays highlighted; zoom excluded)
    EndPicker.tsx                 # footer: End datetime picker button + Live/Go Live button
    Legend.tsx                    # right-side strip; top-to-bottom:
                                  #   (0) <thead><th colSpan={5} scope="colgroup"> — "Signals"
                                  #       label + gear button (opens TagPickerModal); bottom
                                  #       border on the th
                                  #   (1) Cursor row — "Cursor: HH:MM:SS" or "Cursor: --";
                                  #       formatDateTime from @caro/ui; siteTimezone prop
                                  #   (2) Value header — "Value: Max @ Cursor" / "Value: Last
                                  #       Sample" / "Value: N/A" / "Value: @ Cursor"
                                  #   (3) 5-column <table>: swatch(18px) | label(auto) |
                                  #       value(computed px, right-aligned) | unit(auto) |
                                  #       remove(20px); valueColPx = useMemo([tagIds, tagMap])
                                  #       via charsForTag(); label = tag_name with Tag-<id>
                                  #       fallback; value via formatValue(v, tag.format, isBool)
                                  #       (%.Nf support); unit = tag.unit; selected row has
                                  #       outline: colored, outlineOffset: -1 (draws inside
                                  #       border to survive overflow:auto clip)
                                  #   (4) BucketFetchIndicator (12px gap above) — bucket size
                                  #       + last fetch; bucketSMs/lastFetchMs props
                                  # All four label groups use unified style: 12px, #374151,
                                  # monospace, lineHeight 16px
    TagPickerModal.tsx            # modal opened by Legend gear button; flat alphabetical
                                  # trendable-tag list (left pane) + Trending list (right
                                  # pane); both panes width = max(MIN_PANE_PX, longest
                                  # tag_name × FONT_WIDTH_PX + PANE_PADDING_PX); outer
                                  # wrapper width = paneWidth × 2 + PANE_GAP_PX; height
                                  # pinned at calc(90vh - 8rem); 16-tag stage cap; inline-
                                  # style chrome via @caro/ui Modal outerStyle/headerStyle/
                                  # bodyStyle
    CursorDisplay.tsx             # range-message-only bar above the footer preset row;
                                  # renders "Range too wide…" or "Range too narrow…" in red
                                  # when the viewport span is out of bounds; otherwise empty;
                                  # lineHeight:16px pinned so toggling does not reflow

    render/
      uplotConfig.ts              # builds uPlot Options; onCursorChange callback (idx, tsMs);
                                  # Y_AXIS_SIZE_PX=60 (fixed axis width, prevents left-edge
                                  # jitter on trace selection); Y_AXIS_LABEL_SIZE_PX=16
                                  # (label area always reserved; label=' ' when unit absent)
      yScales.ts                  # per-trace Y-scale defaults (eng_min/max, autoscale, bool)
      bandsFromTrendData.ts       # maps TrendData → uPlot always-band arrays (xs, mins, maxs)
      formatBucketS.ts            # bucket size → human-readable (e.g. "3.8 min buckets")
      formatValue.ts              # formatValue(value, format, isBoolean) → display string;
                                  # format is the tag_registry %.Nf pattern or null (→ "%.4f")
      formatTickLabel.ts          # X-axis tick label formatting
      formatSpanMs.ts             # viewport span → human-readable (e.g. "1 h")
      formatFetchMs.ts            # last-fetch duration → human-readable

    __tests__/
      level.test.ts               # alignedTilesInRange, tilesForViewport, deriveBucketSMs
      tileCache.test.ts           # LRU eviction, cache key, size accounting
      colorAssign.test.ts         # deterministic palette assignment
      api.test.ts                 # fetchTile wire format + error handling
      tileActiveSet.test.ts       # direct-seam: pruneAndAdd geometry (empty, below-capacity,
                                  # left-end, right-end, middle gap-fill at capacity — no warn)
      useTrendData.test.ts        # fetch orchestration, fan-out, tag-generation guard,
                                  # bucketSMs integer invariant, gatedFetchTile
                                  # CLIENT_OVER_RANGE / CLIENT_PRE_EPOCH sentinels
      useTrendMode.test.ts        # trendModeReducer pure unit tests
      useLiveSubscription.test.ts # Step 11: ring buffer lifecycle, bucket accumulator close,
                                  # raw buffer, viewportSpanMs trim, rawBuffers NOT trimmed
                                  # on threshold, boolean coercion, drainBuffers (ring kept)
      mergeTrendData.test.ts      # Step 11: unified coverage rule, aggregate clip at
                                  # liveEndIndex, raw live-wins overlap, bucketSMs mismatch
                                  # passthrough
      axisInteractions.test.ts    # all 7 helper functions
      TrendChartContainer.test.tsx # container behavior: presets, Live, End picker, tag remove,
                                  # loading hints; computeDragZoomViewport pure tests
      trendChart.test.tsx         # TrendChart render, Y-scale defaults, legend display
      legend.test.tsx             # Legend component unit tests (cursor row, value header,
                                  # table, BucketFetchIndicator integration)
      SpanBucketIndicator.test.tsx # legacy: span + bucket size display (SpanBucketIndicator)
      SpanIndicator.test.tsx      # SpanIndicator: span formatting
      BucketFetchIndicator.test.tsx # BucketFetchIndicator: bucket + fetch display
      SpanPresets.test.tsx        # preset highlight rule, mode-aware behavior
      EndPicker.test.tsx          # End picker interaction, snap-back on invalid input
      CursorDisplay.test.tsx      # range-message-only: over-range / under-range message
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
| `live-*` | `presetClicked` | — | `live-trailing` | re-anchor to live edge; tiles refetched |
| `fixed` | `liveClicked` | — | `live-trailing` | enter Live; tiles fetched |
| `live-*` | `liveClicked` | — | `live-trailing` | re-anchor to live edge; tiles refetched |
| `fixed` | `endPickerCommitted` | `to > latestSampleTs` | `live-fixed` | enter Live; no teardown |
| `fixed` | `endPickerCommitted` | `to <= latestSampleTs` | `fixed` | re-anchor `from = to - sizeMs` |
| `live-*` | `endPickerCommitted` | `to > latestSampleTs` | `live-fixed` | no teardown |
| `live-*` | `endPickerCommitted` | `to <= latestSampleTs` | `fixed` | `drainBuffers`; tiles refetched |
| `fixed` | `zoomApplied` | — | `fixed` | no teardown |
| `live-*` | `zoomApplied` | — | `fixed` | `drainBuffers`; tiles refetched |
| `fixed` | `panApplied` | — | `fixed` | (pan-in-fixed preserved) |
| `live-*` | `panApplied` | `to > latestSampleTs` | `live-fixed` | no teardown |
| `live-*` | `panApplied` | `to <= latestSampleTs` | `fixed` | `drainBuffers`; tiles refetched |
| `live-trailing` | `tick` | — | `live-trailing` | advance `nowMs`, preserve `lastIntent` |
| `live-fixed` | `tick` | `nowMs >= state.to` | `live-trailing` | **auto-promote**: snap viewport, set `lastIntent = 'live'` |
| `live-fixed` | `tick` | `nowMs < state.to` | `live-fixed` | no-op |
| `fixed` | `tick` | — | `fixed` | no-op (container guard prevents dispatch) |

**Symmetric window-vs-live-edge rule (supersedes proposal D6 + D7).** The reducer classifies `panApplied`, `zoomApplied`, and `endPickerCommitted` from **any** starting state uniformly: `to > latestSampleTs` → `live-fixed`; `to <= latestSampleTs` → `fixed`. A `classifyByWindow(latestSampleTs, action.to)` helper is extracted from the three action branches. This means `endPickerCommitted` from `fixed` with a future End now enters `live-fixed` — the original D6 asymmetry is superseded. Spec §9.3 and §12.2 document this as the contract.

**`latestSampleTs === null` fallback.** When `latestSampleTs` is unavailable (the window before the first `TREND_DELTA` of the session), `panApplied` and `endPickerCommitted` use `state.modeViewport.end` as the reference. Preserves gesture semantics before the first live sample arrives.

**Auto-promote `lastIntent` synthesis.** Auto-promote (`live-fixed` tick where `nowMs >= state.to`) sets `lastIntent = 'live'`, not the prior value — this ensures `useZoomState` re-derives `currentBucketSMs` and `zoomAnchorSpan` from the post-snap clean span (`isZooming` becomes `false`; `derivedBucketSMs` re-computes from the new `modeViewportSpan`). Spec §9.3 documents this as contract behavior.

`modeToViewport(state)` derives `Viewport { start: bigint; end: bigint }`:
- `live-trailing`: `{ start: nowMs - sizeMs, end: nowMs }`
- `fixed` / `live-fixed`: `{ start: from, end: to }`

**`tick` is the live-advance action.** `TrendChartContainer.handleDataReceived` guards on `isLive(modeStateRef.current.mode)` before dispatching `tick { nowMs: maxModuleTs }`. The `useZoomState` reset effect skips on `lastIntent === 'live'` so bucket size is not clobbered on each tick.

---

## 4. Zoom State (`useZoomState.ts`)

`useZoomState` exposes two derived values and two handlers:

| Value | Type | Role |
|---|---|---|
| `currentBucketSMs` | `bigint` | Current bucket size in ms — drives tile resolution |
| `zoomAnchorSpan` | `bigint` | Full viewport span at the current zoom level — drives uPlot autoscale |

**Render-time derivation (storm fix).** For non-zoom intents, `currentBucketSMs` is derived at render time as `derivedBucketSMs = modeViewportSpan / (visibleTilesPerWindow × bucketCount)`. This eliminates the one-render lag where a wide `modeViewport` was paired with the previous narrow `bucketSMs`, which caused `tilesForViewport` to emit hundreds of tiles at the old tiny resolution. A single `gestureBucketSMs` state is held sticky **only** while `lastIntent === 'zoom'` — continuous wheel-zoom must not re-derive from a growing viewport, as that would change tile IDs mid-gesture. A sync effect `[derivedBucketSMs, isZooming]` keeps `gestureBucketSMs` in sync with the derived value while not zooming (correct baseline for the next gesture), but does NOT fire when `handleZoomLevelSwitch` fires alone (neither dep changes until `zoomApplied` sets `lastIntent = 'zoom'`).

`handleDragZoom(selStart, selEnd)` and `handleZoomLevelSwitch('in'|'out')` update `gestureBucketSMs` only; `handleZoomLevelSwitch` uses a functional updater with `[]` deps (stable callback, no stale capture). `computeDragZoomViewport` is exported for direct testing.

---

## 5. Data Fetch (`useTrendData.ts`)

`useTrendData({ viewport, tagIds, isLive, bucketSMs })` drives **every** tile fetch through one pipeline — there is no live-spine vs. history split. The hook is a thin shell: it allocates state and refs, runs a single fetch `useEffect`, and returns the assembled result. Orchestration lives in `runTileFetch.ts`; the pure tile/cache helpers in `tileActiveSet.ts`.

**One fetch effect.** A single `useEffect` keyed on `(tagIdsKey, viewportStart, viewportEnd, bucketCount, tileSpanMs, …, isLive, heartbeat, commit)` calls `runTileFetch`. It is the only writer of `activeTilesRef` and the only caller of the fetch path. In history mode the effect short-circuits when the viewport is out of range (`isViewportOverRange` / `isViewportUnderRange`); in live mode the range guard is skipped — live tiles may legitimately extend past now.

**`runTileFetch` (per run).** Computes the required tile set via `tilesForViewport` (live mode passes `overfetchRightCount: 0`); resolves each tile to an `ActiveTileEntry` — existing active entry with data > LRU cache hit > placeholder; bumps `tagGenerationRef` only on a `tagIds` change; selects the tiles that `needsFetch` reports stale and that are not already in `inFlightTilesRef`; early-returns on a pure no-op (same tiles, same tags, nothing to fetch); otherwise publishes the new `activeTilesRef` and calls `commit()`; then fires the fetches.

**Terminal-cache rule.** On resolve: a **terminal** response (`committedThroughTs >= tile.endTime`) is written to the LRU (`storeTileResult`) and the entry is marked terminal (`data: null`). A **non-terminal** response (live-edge tile) keeps its assembled data on the entry (`entry.data`) and is never cached. A failed fetch stores a synthetic null tile (`storeNullTile`, `committedThroughTs = tile.endTime`) so the freshness predicate stops retrying (§4.3).

**`needsFetch` freshness predicate.** A tile needs a fetch when: no LRU entry covers it; or its active entry has not resolved (`committedThroughTs === null`); or it has rolled `REFETCH_LAG_MS` into the past (refetch once more for a terminal, cacheable copy); or — in history mode — its `committedThroughTs` is short of the viewport end. In live mode the predicate returns `false` — the WS tail handles the live-edge tile in steady state, `invalidateNonTerminalTiles` handles Fixed→Live transitions, and `REFETCH_LAG_MS` handles tiles that have rolled into the past. `needsFetch` is exported for direct unit testing.

**Run-independent resolve flow.** `inFlightTilesRef` is the cross-run dedup (added before a fetch, deleted on settle, `has`-checked before re-firing). Resolve handlers do not capture the run: a terminal resolve writes the LRU and patches `activeTilesRef` unconditionally; a non-terminal resolve patches in place only if `tagGenerationRef` still matches and the tile is still in the active set. `commit` re-assembles `data` from the active set (`assembleData`), preserves the previous `data` as a bridge render while visible tiles are still pending, and updates `committedThroughTs`, `swapCounter`, `activeTileCount`, and `lastFetchMs`.

**Live-mode heartbeat.** While `isLive`, a 2 s `setInterval` bumps a `heartbeat` state value that sits in the effect dep array, so the freshness predicate is re-evaluated even when the viewport is pinned (`live-fixed`). This keeps `REFETCH_LAG_MS`-based refetches firing in live mode even without a viewport change.

**`invalidateNonTerminalTiles` — Fixed→Live transition.** On a `!isLive → isLive` mode transition, `dispatchModeAction` calls `trendData.invalidateNonTerminalTiles()` before dispatching the action. This resets `committedThroughTs` to `null` on every non-terminal active entry, so `needsFetch`'s "entry not resolved" branch fires immediately on the next heartbeat or viewport change — the preserved tiles from Fixed mode are re-fetched with a fresh `committedThroughTs` from the server. Terminal entries are left untouched (they are LRU-cached and correct by construction). This is symmetric to the `drainBuffers()` call on Live→Fixed.

**Key behaviors:**

- **Tile geometry**: `TREND_VIEWER_DEFAULTS.bucketCount = 500`, `visibleTilesPerWindow = 2`, `overfetchPerSide = 1`.
- **`gatedFetchTile` wrapper**: built once via `buildGatedFetchTile()` in `gatedFetchTile.ts`; every fetch in `runTileFetch` delegates through it. Rejects with `CLIENT_PRE_EPOCH` (`startTime < 0n`, silent skip), `CLIENT_UNDER_RANGE` (`tileSpanMs / bucketCount === 0`, sub-ms tile), and `CLIENT_OVER_RANGE` (`bucketS > MAX_BUCKET_S`). `runTileFetch`'s catch handlers recognize the sentinels by `error.code` and skip silently. Out-of-range UX is owned by `TrendChartContainer` via `modeViewport`-derived booleans.
- **`swapCounter`**: incremented on every `commit`; `TrendChart` uses it to trigger a full uPlot rebuild when the tile set / bucket size changes.
- **`activeTileCount`**: count of tiles in the active set — used by `SpanBucketIndicator` and tests.
- **`bucketSMs` integer invariant**: `assembleData` throws if the assembled `bucketSMs` is non-integer — a regression guard at the assembly boundary, before any downstream `BigInt()` conversion.
- **`committedThroughTs`**: max `committedThroughTs` across the active set (`computeCommittedThroughTs`), returned from the hook. `TrendChartContainer` uses it directly as the ring trim threshold — it is the real data edge (no additional fudge offset needed).
- **`invalidateNonTerminalTiles`**: stable callback returned from the hook; called by `dispatchModeAction` on `!isLive → isLive` to force re-fetch of preserved non-terminal tiles.

**Merge in `TrendChartContainer`.** `mergedData = useMemo(() => mergeTrendData(data, liveSub.tail, { seamCommittedThroughTs }), [data, liveSub.tail, swapCounter])` — a single path for both modes. There is no live/history split and no `getBufferSnapshot`. `seamCommittedThroughTs` is derived from `getSeamCommittedThroughTs(trendData.activeTilesRef)` — the `committedThroughTs` of the rightmost active tile.

**Raw-vs-bucketed dispatch (Phase 6 unified rule, see `Docs/trend_dispatch_unified_rule_proposal.md`).** The server's shape decision is unaffected by the unified-tile refactor:

It is the Phase 6 two-step rule:

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
useZoomState(...)      →  currentBucketSMs, zoomAnchorSpan,
                          handleDragZoom, handleZoomLevelSwitch
useTrendData(...)      →  data, isLoading, swapCounter, activeTileCount,
                          lastFetchMs, committedThroughTs, activeTilesRef,
                          invalidateNonTerminalTiles
```

`dispatchModeAction` wraps `dispatch` for all mode transitions. It computes `next = trendModeReducer(prev, action)` and applies two conditional side effects before dispatching:
- **Live → fixed** (`isLive(prev) && !isLive(next)`): calls `liveSubRef.current.drainBuffers()` to clear the accumulator, raw buffers, and session high-water mark.
- **Fixed → live** (`!isLive(prev) && isLive(next)`): calls `trendData.invalidateNonTerminalTiles()` to reset non-terminal active entries so they are re-fetched with a fresh watermark.

There is no `syncDataViewport`, no `evictAll`, no `refetchHistory`, and no `isFreshLiveLanding` branch.

`liveEdgeBehindWindow` is derived per-render as `latestSampleTs !== null && latestSampleTs < modeState.from` using `liveSubRef.current.getLatestSampleTs()` and passed to `EndPicker` as a prop for the orange button state.

It also renders:
- `TrendChart` (with `onXRangeChange` → `handleXRangeChange` RAF-coalesced → `zoomApplied`; `onXPan` → `handleXPan` RAF-coalesced → `panApplied`); receives `bucketSMs` and `lastFetchMs` props, which it forwards to `Legend`
- `CursorDisplay` (range-message bar — rendered above the footer, below the chart canvas)
- Footer row: `SpanPresets` | `SpanIndicator` | `EndPicker + Live button`

It owns `tagIds` state (initialized from `initialTagIds` prop; removes come from `Legend` via `TrendChart.onTagRemove`; additions come from `TagPickerModal.onCommit`). It also owns `isPickerOpen` state; the gear click in `Legend` → `onSettingsClick` → `setIsPickerOpen(true)`. `<TagPickerModal>` is mounted as a sibling to `<TrendChart>`, receiving `isOpen={isPickerOpen}`, `onClose={() => setIsPickerOpen(false)}`, `onCommit={setTagIds}`, `currentTagIds={tagIds}`, and `tagMap`. It derives `xRange` from `modeViewport` via `useMemo`. It passes `showLastWhenIdle={isLive(modeState.mode)}`, `bucketSMs={bucketSMsIndicator}`, and `lastFetchMs={lastFetchMs}` to `TrendChart` (all forwarded to `Legend`). There is no `cursorTsMs` state in the container — the cursor row is owned entirely by `Legend`.

Props: `tagIds: number[]`, `siteTimezone?: string`, `height?: number` (default 420). Width is measured via `ResizeObserver` inside `TrendChart`.

---

## 8. Live Tail Runtime Architecture

`useLiveSubscription` is the live-tail orchestrator, wired in `TrendChartContainer` alongside `useTrendData`. It owns the dedicated trend WS channel and the per-tag buffers; it does not fetch tiles.

```
SUBSCRIBE_TREND — sent on tag-list change / chart mount; warm across all modes.
                  UNSUBSCRIBE_TREND on tag removal / chart unmount.

TREND_DELTA frame received:
  → push every sample to the per-tag ring (TREND_RING_CAPACITY = 20) — in ALL modes
  → bump sessionHighWaterMark
  → if isLive(mode):
      aggregate: feed the sample into the bucket accumulator; close buckets on
                 bucketSMs boundaries → { ts, value, min, max, null_count }
      raw:       push to the raw buffer; trim it to 2 × viewportSpanMs
  → flushTail() → setTail(buildAggregateTail | buildRawTail | null)

tailMode effect (re-runs on isLive / tagIdsKey / bucketSMs / tailMode change):
  → clears accumulator + raw buffers, then reseeds them from the ring
    (filtered to ≥ trimThreshold) — so an excursion through fixed and back
    does not lose recent tail history

ring-trim effect (on trimThreshold change; trimThreshold = committedThroughTs):
  → prunes ring entries older than trimThreshold

TrendChartContainer render:
  mergedData = useMemo(() => mergeTrendData(data, liveSub.tail, { seamCommittedThroughTs }), …)

onDataReceived(maxModuleTs):  if isLive → dispatch({ type: 'tick', nowMs })

drainBuffers()  — called only on a Live → fixed transition:
  → clears accumulator + raw buffers + sessionHighWaterMark; setTail(null)
  → does NOT clear the ring
```

**Key invariants:**
- **The ring fills in every mode** — the WS push runs before the `isLive` check — and `drainBuffers` does **not** clear it. The ring is the seed source the accumulator / raw buffer are rebuilt from on Live re-entry; clearing it on `Live → fixed` opened a transient coverage gap on a fast `live-trailing → fixed → live-trailing` round-trip (audit finding H4, see `hmi_trend_viewer_deltas.md`). Bucketing is the only thing gated on `isLive(mode)`.
- `latestSampleTs = max(sessionHighWaterMark, currentMaxAcrossSubscribedTags)`. Monotonic-non-decreasing within a session; `null` before the first `TREND_DELTA`; reset by `drainBuffers`.
- The **raw buffer** is trimmed by `2 × viewportSpanMs` in the WS callback — never by `trimThreshold`. Trimming it on `trimThreshold` would advance `minLiveTs` in `mergeRaw` and let LOCF gapfill leak through the cached-drop filter as a flat-line gap at tile boundaries. Only the **ring** is trimmed by `trimThreshold`.
- The merge is a single `useMemo`. `mergeTrendData` applies the unified coverage rule: live wins on its coverage range; at the seam bucket the tile and accumulator `min`/`max` are combined (spec §10.6); raw mode drops cached samples at/after the tail's first timestamp.
- Mode-transition behavior and the terminal-cache rule: spec §10.6 / §10.8. Subscription lifecycle: spec §10.7.

**Stable refs pattern.** `modeStateRef`, `liveSubRef` (and the other container refs) are updated synchronously during render, not in `useEffect`, so callbacks read current values without stale closures.

---

## 10. Implementation Divergences from Spec

Divergences from the spec that remain current. Entries absorbed into the spec during Phase 1 audit and subsequent passes have been removed — gaps in numbering are intentional. Rejected design alternatives appear in [Historical decisions](#historical-decisions) below.

14. **Raw path unified into a single SQL query** — in-window samples and bounded-prev run as one UNION ALL query with an `is_in_window` discriminant column. One connection per raw tile.

23. **uPlot `range` function reads from `userScaleRef`** — the xScale `range` function returns `userScaleRef.current` if set, else defers to uPlot's default autoscale. The ref is updated synchronously before every `setScale` call. Required because uPlot clamps an identity `range` return to the data extent, ignoring `setScale` requests that exceed it.

24. **`setSelectHook` updates `userScaleRef` before calling `u.setScale`** — the drag-zoom handler in `uplotConfig.ts` must write `userScaleRef.current` before `u.setScale`. If the ref is stale at fire time, `u.scales['x']` locks at the previous range. Calling `setScale` first then updating the ref is wrong.

29. **`lastChartDataRef` bridges chart data across mode transitions** — `TrendChartContainer` maintains a ref of the most recent non-null `chartData`, updated synchronously during render. The chart receives `effectiveChartData = chartData ?? lastChartDataRef.current`. Prevents `<TrendChart>` from unmounting during the brief window where `chartData` is null between transitions (history → live before spine resolves; live → history before history refetch resolves), keeping the uPlot canvas mounted. Initial load (ref still null AND `chartData` null) falls through to the loading-hint placeholder as before.

30. **Symmetric window-vs-live-edge rule supersedes proposal D6 / D7.** The reducer classifies `panApplied`, `zoomApplied`, and `endPickerCommitted` uniformly from any starting state using a single `classifyByWindow(latestSampleTs, action.to)` helper: `to > latestSampleTs` → `live-fixed`; `to <= latestSampleTs` → `fixed`. This departs from the original D6 (endPicker-from-fixed stays `fixed` regardless of picked End) and D7 (zoom always → `fixed`): zoom from `live-*` still → `fixed` per the table (zoom is still exploratory), but the classification is now handled by the same helper branch. `endPickerCommitted` from `fixed` with a future End now enters `live-fixed`. Documented in spec §9.3 and §12.2 as the as-built contract.

31. **`invalidateNonTerminalTiles` on Fixed→Live.** `dispatchModeAction` calls `trendData.invalidateNonTerminalTiles()` on `!isLive(prev) && isLive(next)` transitions (symmetric to `drainBuffers` on Live→Fixed). Resets `committedThroughTs` to `null` on non-terminal active entries; `needsFetch`'s "entry not resolved" branch immediately re-fetches them with a fresh watermark. Terminal LRU entries are untouched. Without this, tiles preserved from Fixed mode carry a stale `committedThroughTs` and never re-fetch in live mode.

32. **`mergeTrendData` `totalN` cap prevents white-gap at the live-edge tile seam.** During the ~1-bucket window before the WS accumulator closes its first bucket in a new tile's range, the live-edge tile has non-null buckets from a prior fetch but the accumulator's coverage starts at 0. Without capping, `totalN = liveEndIndex + 1` extended past the cached tile's actual data, emitting null future-coverage buckets that rendered as a white gap. Fix: when `liveStartIndex < 0 && seamBucketIndex >= 0 && liveEndIndex <= seamBucketIndex`, cap `totalN = seamBucketIndex`. Implemented in `mergeTrendData.ts`.

34. **Click-to-stage / ×-to-unstage (supersedes spec §11.3 checkbox multi-select + "Add N" commit).** Staging is immediate on click; the right (Trending) pane reflects insertion order. Clicking an already-staged row in the left pane is a no-op. Unstaging via × in the right pane. OK commits the full staged set via `commitTagIds` (see div. 39).

35. **16-tag picker stage cap.** The spec §11 did not specify a picker stage cap. The 17th add attempt shows an inline error row; removing a tag clears it. The chart UX cap (§2: max plotted tags = 20) is unchanged.

36. **Modal, not drawer (supersedes spec §11.1).** The picker is a content-sized modal, not a right-side drawer. The chart-visible-while-picking property is preserved because the modal is sized to content rather than full-screen.

37. **Non-trendable tags filtered out entirely (supersedes spec §11.4 grayed + footer hint).** Tags with `trendable === false` are absent from the left pane. The "N matching tags are not trendable" footer hint is not implemented.

38. **Inline-style modal chrome (supersedes spec §11.5, which was unspecified).** `TagPickerModal` uses `@caro/ui Modal`'s `outerStyle`/`headerStyle`/`bodyStyle` props rather than Tailwind class strings — consistent with `@caro/trend-chart`'s inline-style-pure convention.

39. **`commitTagIds` single-mutation contract (supersedes spec §10.7 / §11.3).** All `tagIds` mutations in `TrendChartContainer` route through `commitTagIds`, which calls `invalidateNonTerminalTiles()` before `setTagIds()`. This keeps the live-edge tile's `committedThroughTs` fresh after a tag-list change and prevents a merge-seam gap where stitched data is anchored to a stale watermark. Both the modal OK callback and the legend-remove handler use `commitTagIds`. The spec described direct `setTagIds` calls at both sites without the invalidation requirement.

40. **Empty-tagIds preserves full chart layout (supersedes spec §13.5 "Add tags" button).** When `tagIds.length === 0` — first-time open or after all tags are removed — the chart renders its full layout unchanged: blank plot area at normal height, Legend strip with Signals header + gear icon, footer. There is no separate "Add tags" button; the gear icon in the Legend header is the sole entry point. Achieved via three co-ordinated fixes: (A) `TrendChartContainer` extends the placeholder-data ternary to include `tagIds.length === 0`, preventing uPlot destruction attempts; (B) `TrendChart` renders `Legend` unconditionally (not behind a `tagIds.length > 0` guard); (C) `TrendChart` always passes `style={{ height }}` to the `containerRef` div so the plot area retains its vertical footprint when uPlot is absent.

33. **`querySegment` absent-tag bounded-prev fallback.** Tags whose `time_bucket_gapfill` output has zero in-window rows (COV tags in windows narrower than the mandatory 60 s snapshot interval) receive a dedicated bounded-prev query (`DISTINCT ON (tag_id) … WHERE timeCol < startTime AND timeCol >= startTime − 5 min`) and are filled flat at the prior value. Only tags with no prior history in the 5-minute window remain `null × n`. The spec's §5.5 `prev` subquery only seeds the LOCF carry-forward within the gapfill range; this fallback handles the degenerate case where the gapfill emits nothing to carry forward. Implemented in `packages/db/timescale/trends.ts`; 2 integration tests added.

### Historical decisions

Design alternatives that were explicitly considered and rejected. Recorded here so future readers understand why the current approach was chosen.

20. **Watchdog null marker dropped** — original plan had `TelemetryIntake.watchdogTick()` emit a synthetic null at `lastSeen + 1 ms` to mark the precise gap start. Dropped: LKV null + synthetic-on-flush achieves the same bucket-null result without per-tag bookkeeping. Trade-off: gap-start timestamp lags by up to one watchdog-tick interval (~500 ms worst case).

21. **Open-tile model rejected** — an early design had cached tiles mutated in place as live data accumulated. Rejected in favor of tail-extension: cached tiles are immutable; `useLiveSubscription` owns a separate accumulator; `mergeTrendData` concatenates at render. Cache freshness is now structural via the terminal-cache rule — see spec §10.6 / §10.8.

22. **`committedThroughTs`-based raw buffer trim dropped for 2×Span** — original plan trimmed raw buffers to `moduleTs >= committedThroughTs` (same threshold as the ring). Dropped: advancing `trimThreshold` as tiles loaded pushed `minLiveTs` forward in `mergeRaw`, letting LOCF gapfill leak through the cached-drop filter. Raw buffers trimmed to `latestTs - 2×viewportSpanMs` in the WS callback instead; cleared on live exit via `drainBuffers`.

---

### Dead-tag detection — replacement for removed LOCF cutoff

**Context.** The LOCF cutoff query (`SELECT MAX(ts) FROM tag_samples WHERE tag_id = ANY(...)`) and its associated past-extent CASE wrapper were removed because they paid **814ms of planning time per CAG request** on the production-scale `tag_samples` table (251 chunks × 8 tag_ids → catalog enumeration). The cost was the dominant per-request overhead and CAG perf had regressed 5-10x from the spec's gate-test baseline as data accumulated.

**What was lost.** With the cutoff removed, LOCF carries the last known value forward through all empty trailing buckets in any aggregate query. A recently-stopped tag will show a flat line at its last value extending through the full requested window. Interior dead periods and multi-tag mixed live/dead queries were already not handled by the cutoff and are unchanged.

**What still works.** Watchdog NULLs (when the watchdog writes continuous NULLs while telemetry is silent) still produce gap rendering via §5.4 null-as-gap. For tags with reliable continuous-NULL watchdogs, dead periods render correctly today.

**Replacement options to evaluate:**

1. **Per-tag freshness lookup alongside the tile response** — a `freshness` field (last sample timestamp per tag) returned in the aggregate tile; client-side legend renders a "stale" indicator or dims the line beyond the last fresh sample.
2. **Watchdog contract guarantee** — confirm that the current watchdog reliably writes continuous NULLs while telemetry is silent, and document this as the guaranteed mechanism. For tags with compliant watchdogs no UI change is needed.
3. **Per-tag freshness tag** (`Trend_Info`-style) — a separate tag tracking per-tag last-write time, queried client-side at chart-load and periodically refreshed.

Probably some combination of (2) and (1): a watchdog contract guarantee for the common case, plus an optional freshness indicator for tags whose modules went silent without triggering the watchdog.

---

### Gotchas

Hard-won lessons from the min/max upgrade and perf engineering work.

**uPlot `width: 0` disables `_paths.band` computation.** A series with `width: 0` is treated by uPlot as "nothing to draw," and the renderer skips path generation for it — including the band path geometry. Bands referencing such a series produce no visible fill regardless of fill color or alpha. Use `stroke: 'transparent'` (with default `width: 1`) to hide a stroke while keeping the path computed for band participation.

**uPlot `bands[].series` is directional.** The array is `[upperSeriesIdx, lowerSeriesIdx]` — fill is drawn from the upper edge downward, clipped by the lower. Inverting the order produces an empty intersection. Code comment at `render/uplotConfig.ts` near the bands registration documents this in-line.

**dotenv import order matters.** `import 'dotenv/config'` must execute before ANY module that reads `process.env` at the top level. Top-level `const X = process.env.Y === '1'` lines capture the env state at module-load time. The `@caro/hmi-server` `index.ts` puts `import 'dotenv/config'` at line 1 for this reason. The `LOG_TILE_QUERIES` constant in `packages/db/timescale/trends.ts` is the canonical example of this pattern.

**Workspace packages ship from `dist/`.** `@caro/db` and `@caro/trend-chart` are TypeScript workspace packages that build to `dist/`. Source changes don't reach the running HMI server (which imports from `dist`) without `npm run build --workspace=<package>`. Restart and hard-refresh after a rebuild. Always run both builds before testing a server-side change end-to-end.

**PostgreSQL planning cost grows with chunk count for unbounded `tag_id = ANY(...)` queries.** A `MAX(ts) WHERE tag_id = ANY(...)` over `tag_samples` paid 814ms of planning time at 251 chunks (2008 plan-time chunk evaluations against the catalog). Always bound such queries by time (`AND ts >= now() - INTERVAL 'X minutes'`) so the planner can prune via `_ts_meta_max` constraints to ≤2 chunks. The bounded-prev pattern in §5.5 demonstrates this.

**TimescaleDB `cagg_watermark()` has cold-cache cost.** First call to `_timescaledb_internal.cagg_watermark()` on a fresh process pays 130–300ms at production data scale (catalog enumeration). Subsequent calls are <1ms. Always memoize watermarks in process memory if you call them per-request — the watermark advances slowly (refresh cadence) so a 30s TTL stays well within freshness.

**Pool starvation looks identical to slow SQL at the wall-clock level.** When diagnosing perf, use `TIMESCALE_LOG_TILE_QUERIES=1` to compare DB-side `elapsed_ms` against client-side wall-clock. Large gap with small DB time = queueing or app-layer overhead. Roughly equal = SQL itself is the cost.

**Multi-VM Hyper-V contention.** When TimescaleDB runs in Docker on Windows, `docker-desktop` and any user WSL distros are separate Hyper-V VMs that compete for CPU/memory/network scheduling (visible as `Vmmem` in Task Manager). Doesn't break anything but adds noise to perf measurements — close idle WSL instances before running gate tests.

**`rawBuffersRef` must never be trimmed on `trimThreshold` advance.** The `trimThreshold` (derived directly from `committedThroughTs`) advances as new tiles load. If `rawBuffersRef` were trimmed alongside the ring, `minLiveTs` in `mergeRaw` would advance, causing LOCF gapfill from newly-fetched after-prefetch tiles to survive the cached-drop filter and render as a flatline gap at each tile-boundary crossing. Trim only the ring; raw buffers are cleaned via 2×viewportSpanMs in the WS callback and cleared entirely on live exit via `drainBuffers`.

**`TREND_DELTA` boolean values arrive as `true`/`false`.** The TimescaleDB writer coerces booleans to DOUBLE PRECISION (1.0/0.0), but the WS trend path delivers the raw LKV value which may be a boolean. `toNumericValue` in `useLiveSubscription` applies `true → 1`, `false → 0`. Without this coercion, boolean trend tags render as null gaps in the live tail even when data is arriving correctly.

**`dispatchModeAction` vs direct `dispatch`.** Actions that can exit Live mode (zoom, pan, endPicker) must go through `dispatchModeAction` so `drainBuffers` runs atomically before the state transition. Direct `dispatch` is only for `tick`. Skipping `dispatchModeAction` on a Live → fixed transition leaves a stale live tail bleeding into the fixed view.

**Pan-back data-loss window.** On live → fixed transition, `drainBuffers` clears the live tail immediately. Live values that arrived in the last ~`TIMESCALE_DB_TICK_MS` + FIFO trim buffer (~1.5 s by default: 500 ms DB tick + 1 s trim tolerance) may not yet be committed to TimescaleDB when the next REST fetch fires. Those values are not lost in the historian — they land within the next DB flush cycle — but the brief in-transit window renders as null/gap until the subsequent refetch picks them up. Deliberate property of the tail-extension model: keeping live-exit synchronous and simple outweighs the cost of a sub-2 s null flash on pan-back. Not a bug.

**`drainBuffers` must reset per-tag arrays in place, not `.clear()` the map.** `rawBuffersRef` is `Map<tagId, Array>`. Calling `.clear()` removes every per-tag key; the subscribe callback's `if (buf)` guard then silently drops every subsequent event until something re-allocates the map keys. Production lifecycle mode-flip + tailMode-effect re-allocation masked the bug, but it surfaces immediately under stable-mode drain (the TG-7 audit test). Fix: `for (const arr of rawBuffersRef.current.values()) arr.length = 0` plus `setTail(null)` for explicit React-state drain. Spec §10.6 documents the contract; the in-place mutation pattern is the implementation choice that matches it. Surfaced + closed during the 2026-05-17 audit pass.

**EXPLAIN of `locf(prev => ...)` hides the prev subquery in TimescaleDB 2.26.3 output.** When validating chunk pruning on the bounded-prev pattern (spec §5.5), `EXPLAIN (FORMAT JSON)` on a `locf()` call does not expose the nested correlated subquery in the plan tree — pruning structure for the `prev` lookup is invisible. The TG-1 plan-assertion test (`packages/db/__tests__/timescale/trends.test.ts`) works around this by extracting the inner prev SQL directly from `buildGapfillSql`'s output via regex and EXPLAIN-ing it as a standalone statement. Future tests of the bounded-prev shape must do the same.

**EXPLAIN with parameter bindings uses the generic plan (statistics-based pruning), not constraint exclusion.** Related to the above: `EXPLAIN (FORMAT JSON) $sql` with `[params]` goes through the Extended Protocol → prepared statement → generic plan after the 5th execution. Generic plans use row-count statistics for chunk pruning, which silently prunes empty chunks regardless of whether the bounded-prev's `INTERVAL '5 minutes'` filter is present. To verify constraint-based exclusion (what production sees), substitute literal values into the SQL before EXPLAIN. Spec §5.5 has the production-side prepared-statement warning; this is the test-side corollary. Surfaced during TG-1 implementation.

**Legend cursor values resolve by timestamp, not by uPlot's data index.** uPlot's `cursor.idx` is the *nearest* data point; in raw mode it indexes the sorted-union grid `bandsFromTrendData` builds (every tag's timestamps + `prev` seeds), not any single tag's `value` array — so a per-tag `series.value[cursorIdx]` is wrong, and even resolving against the nearest union point snaps across step/bucket boundaries to a value the drawn line does not have at the cursor. `Legend.tsx`'s `getLegendDisplayText` instead resolves from the cursor's X-axis timestamp (`cursorTsMs`, from `posToVal`): raw uses LOCF seeded by `prev`; aggregate uses `floor((cursorTsMs − startTime) / bucketSMs)`. The raw upper bound is the **union extent** — the max timestamp across all traces, including `prev` seeds — because `bandsFromTrendData` forward-fills every trace out to that edge; bounding by a trace's own last sample wrongly blanks quiet setpoints and `prev`-only flat traces. See spec §8.5.

**Legend selected-row outline uses `outline-offset: -1px`, not `0`.** With `outline-offset: 0`, the outline draws 1 px outside the row's outer edge — which is at the same x-position as the table's right border. The two collide visually; combined with the STRIP's `overflowY: 'auto'` (which per CSS spec implicitly computes `overflow-x: auto` and clips the extra pixel), the colored outline's right edge disappears. Pulling the outline 1 px inside the row (`outline-offset: -1px`) draws it over the row's own `border-bottom` (selected row's bottom becomes colored — desirable) and stays clear of both the table border and the STRIP's horizontal clip. All four edges of the selected row remain visible.

---

## 11. Known Issues

Observations from production behavior. Not divergences from spec — document here rather than in delta files.

**A. modeState.nowMs advances at trend-channel flush rate (~4 Hz) instead of 1 Hz.** Each `TREND_DELTA` frame triggers `handleDataReceived` → `dispatch(tick)` → `modeViewport` change → `useTrendData` main effect. `runTileFetch`'s no-op guard prevents redundant fetches, but the React render chain still runs at the WS flush rate. The root cause appears to be something downstream of `useLiveSubscription`'s WS flush dispatching a tick on every frame. Worth a separate investigation; the renders are wasted work but not currently causing visible regressions.

**B. Data gaps near right edge after live→fixed transition.**

*Gap A (closed, 2026-05-16).* Originally described as a CAG-lag null band at the right edge of the newly-fixed viewport after live→fixed transition. Closed by future-bucket nulling (spec §6.5): buckets whose `bucketStartMs > committedThroughTs` are set to `(null, null, null)` server-side at request entry, so the post-transition right edge shows the chart line trailing off naturally at `committedThroughTs` — visually identical to the live-tail's trailing edge. The residual writer-lag gap (`TIMESCALE_DB_TICK_MS = 500 ms` + ~1 s FIFO trim tolerance) sits in `[committedThroughTs - 1.5 s, committedThroughTs]` and is filled by `time_bucket_gapfill + locf` for bucketed presets. Every bucketed preset has `bucketSMs ≥ 300 ms` (5m and larger), making the lag sub-bucket or sub-perceptual; the 1m raw-COV preset uses no LOCF and is unaffected. The ring-survives-transition follow-up architecture proposed in earlier revisions of this section is no longer needed — watermark-aware fall-through (spec §4.3) combined with future-bucket nulling jointly handle the right-edge case.

*Gap B (cross-session frozen cache nulls) — closed.* CAG-lag nulls could once be written to the tile cache and frozen there indefinitely; users toggling between live and fixed saw stale nulls accumulate across sessions. Now closed structurally by the **terminal-cache rule** (spec §10.8): a non-terminal tile — the only kind that can carry CAG-lag nulls — never enters the LRU. (The interim fix was eviction-on-live-entry via `evictAll`; the terminal-cache rule supersedes it.)

**D. Synthetic-on-flush uses HMI server `Date.now()` for `moduleTs` (mixed clock domains).** The synthetic-on-flush mechanism (spec §4.4) exists to propagate LOCF (last-observation-carried-forward) values from the server's LKV to the client's bucket accumulator at `TREND_FLUSH_HZ` cadence. For flatline tags, the LKV is constant by definition — the value at any flush moment equals the value at any other flush moment in the flatline window — so the **synthetic's exact `moduleTs` is not critical**, only that it advances the client's bucket boundaries. Real samples in the same `TREND_DELTA` frame carry the device's `moduleTs` (from MQTT ingest); synthetics carry `Date.now()`. At well-NTP-synced installations the drift is <100 ms — bucket boundary placement for synthetics may shift by that amount relative to real events, but the *value* placed in those buckets is identical regardless of which side of the boundary the synthetic lands. The `committedThroughTs` trim threshold (spec §6.2) absorbs typical drift comfortably — the watermark only advances on confirmed DB commits, so it naturally reflects the real data edge. Not a fix-target; documented so future readers understand the design intent.

**E, F, G — closed by the unified-tile refactor (2026-05-21).** Issues E (left-edge blank in Live after zoom-out), F (~1–3 bucket gap at the spine/tail seam), and G (`live-fixed` not updating until a forced refetch) were all architectural consequences of the parallel live-spine vs. history-tile fetch paths. The unified-tile refactor — the Phase B unification — removed those paths and closed all three by construction: there is one tile pipeline, the live-edge tile is part of the active set and kept fresh by the freshness predicate, and the spine/tail seam no longer exists (the live tail is merged onto the active tile data by `mergeTrendData`, §8). A residual raw-mode seam *coverage* gap on a fast `live-trailing → fixed → live-trailing` round-trip turned out to be a separate ring-clearing defect, fixed under audit finding H4 (see `hmi_trend_viewer_deltas.md`).

---

## 12. What Comes Next

> **Note:** `@caro/trend-chart` ships from `dist/`. After editing source, run `npm run build --workspace=packages/trend-chart` before testing in the browser. Tests run against source directly.

Phase A Steps 1–12 are complete. Next priority TBD. See `Docs/platform_todo.md` for the current open items list.

> Pool sizing and other operational monitoring watchlist items live in `Docs/platform_todo.md`, not as development steps.
