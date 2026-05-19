# Trend Viewer — Unify Live and History Fetch Paths

**Status:** Draft proposal (Phase B work, post Phases 3–5)
**Author:** PM / Claude
**Date:** 2026-05-19
**Related:** `hmi_trend_viewer_spec.md` §6 (Tile API), §10 (Cache Strategy); `hmi_trend_viewer_handoff.md` §5 (Data Fetch), §8 (Live Tail Runtime Architecture), §10 divergences 25–29

---

## 1. Summary

Collapse the two parallel data-fetch paths in `@caro/trend-chart` — `runLiveSpineFetch` (used in Live mode) and `runHistoryTileFetch` (used in fixed mode) — into a single tile-based pipeline. Live mode becomes a tile-mode consumer that additionally stitches the WS-driven accumulator at the right edge. The LRU tile cache becomes a single shared store across both modes; the spine concept (a single uncached "full-viewport" fetch owned by `useLiveSubscription`) is retired.

The proposal is **architectural cleanup** — it does not introduce a new operator-facing feature. The user-visible benefit is uniform zoom-and-pan refetch behavior across Live and fixed modes (mostly delivered by Step 1 + Step 2 of the incremental fixes); the developer-facing benefit is a single fetch contract, half the orchestration code, and the removal of an entire class of "missing-piece" bugs that surfaced repeatedly during Phases 2–4.

---

## 2. Motivation

### 2.1 Bug-class repetition

During Phases 2–4 of the live-trailing decouple work, the same shape of bug surfaced four times:

| Bug | Cause | Affected branch |
|---|---|---|
| Wholesale-replace gap in Phase 2c | `seedFromSpineFetch` clip used stale `firstClosedStartMs` after `bucketSMs` change | seedFromSpineFetch |
| Fixed → Live freeze | `evictAll` did not sync `dataViewport`; new fetch never dispatched | `dispatchModeAction !wasLive && willBeLive` branch |
| Zoom-within-Live not refetching | Same shape — internal Live-flip branch missing `syncDataViewport` | `dispatchModeAction wasLive && willBeLive` branch |
| (And one we've not seen yet but is structurally present) | Symmetric — preset-from-Live keeping prior `bucketSMs` data through accumulator | seedFromSpineFetch (already addressed in Phase 2c fix) |

The common shape is that **live mode has its own fetch path with its own state machine**, separate from history mode's well-tested tile/cache machinery. Every time we modify the mode reducer or the dispatch wrapper, we have to reason about both paths independently. The history path is mature and stable; the live path is younger and has been the source of every regression in this arc.

### 2.2 Performance asymmetry

History mode benefits from:
- Tile-grid alignment (cache stability across operators and sessions)
- Overfetch (2 visible + 1 prefetch each side, covering 2× viewport span)
- LRU cache reuse on pan and sub-threshold zoom
- Discrete bucketSMs levels with explicit 1.5× threshold switching

Live mode has none of these. Every span change is a fresh full-viewport fetch with no reuse, and continuous wheel-zoom would cause one fetch per RAF tick if we didn't artificially skip dataViewport updates on `lastIntent='zoom'`.

### 2.3 Spec coherence

Spec §6 defines a single tile API. Spec §10 defines a single cache strategy. The proposal §10.6 Live Tail Architecture deliberately bypassed both because at the time of writing, the live-spine fetch was new and the team chose to keep it separate to avoid cache-eviction complexity. With the post-Phase-2 unified buffer in `useLiveSubscription` and the per-render `getBufferSnapshot` model, that complexity has been re-internalized in a different layer. The original separation is no longer load-bearing.

---

## 3. Current State (as of 2026-05-19)

### 3.1 History path

```
useTrendData.ts
  └── runHistoryTileFetch (historyTileFetch.ts)
        ├── tilesForViewport → 2 visible + 1 prefetch each side
        ├── fetch each tile via gatedFetchTile
        ├── store results in LRU TileCache
        └── update activeTilesRef + finalizeRef
```

Storage: `TileCache` (LRU, 50 MB cap, keyed by `(tagId, startTime, endTime, bucketCount)`).
Reuse: pan/zoom within cached range → no fetch. Cross-level zoom → `handleZoomLevelSwitch` → new tiles.

### 3.2 Live path

```
useTrendData.ts
  └── runLiveSpineFetch (liveSpineFetch.ts)
        ├── single tile spanning full viewport
        ├── bucketCount = visibleTilesPerWindow × bucketCount (1000)
        ├── fetch via gatedFetchTile
        ├── assembleLiveSpine + seedFromSpineFetch
        └── update spineRef in useLiveSubscription
```

Storage: `spineRef` (single ref in useLiveSubscription, NOT in TileCache).
Reuse: none — every span change → fresh fetch.
Right-edge stitching: `useLiveSubscription` accumulator extends the spine via `mergeTrendData` at render time.

### 3.3 Shared

Both paths use `gatedFetchTile` (the same `CLIENT_OVER_RANGE` / `CLIENT_UNDER_RANGE` / `CLIENT_PRE_EPOCH` gate), `assembleLiveSpine` (for the response → TrendData transform — also used by history's per-tile path indirectly via tileCache `storeTileResult`), and the same response wire format. The divergence is purely in orchestration, storage, and reuse.

---

## 4. Target Architecture

### 4.1 One fetch path

Replace `runLiveSpineFetch` and `runHistoryTileFetch` with one `runTileFetch`. The function:

1. Computes tile-aligned ranges via `tilesForViewport({ visibleTilesPerWindow: 2, bucketCount: 500, overfetchPerSide: 1 })` regardless of mode.
2. Issues fetches for missing tiles via `gatedFetchTile` and stores results in the LRU `TileCache`.
3. Updates `activeTilesRef` to the set of visible tiles.
4. Bumps `swapCounter` and updates `responseTailTs` on completion.

The pipeline is mode-agnostic. The same orchestration handles both modes' tile fetches.

### 4.2 Live mode adds accumulator stitching at render

`useLiveSubscription`'s role narrows: it owns only the WS-accumulator (and the high-water-mark, generation counter, etc.). It no longer owns spine data. `getBufferSnapshot` is replaced (or repurposed) so that:

- In Live mode: chart data = `mergeTilesFromCache(activeTilesRef, tagIds)` + `accumulator` stitched at the right edge.
- In fixed mode: chart data = `mergeTilesFromCache(activeTilesRef, tagIds)` — no accumulator.

The `mergeTilesFromCache` helper assembles the tile cache's contents for a given tag set into a single `TrendData`. The accumulator-stitching part remains mostly the same as today's `mergeAggregate` / `mergeRaw` — only the spine input changes from `spineRef.current` to the merged tile set.

### 4.3 Tile-cache freshness in Live mode

Tiles fetched while in Live mode are flagged `liveFreshness: timestamp` so `evictAll` can target them on Live → fixed transition (eliminating the "stale CAG-lag null" risk that Phase 2's `evictAll`-on-Live-entry was designed to handle). The flag is informational; LRU eviction by capacity still applies.

### 4.4 Dispatch wrapper simplification

`dispatchModeAction` collapses to two distinguishing actions:

```
if (wasLive !== willBeLive) {
  // mode boundary crossed in either direction
  liveSubRef.current?.commitAndDrain();   // no-op if not in Live
  trendDataRef.current.evictAll();
  // syncDataViewport happens at top regardless (Phase B Step 1 fix)
  if (!willBeLive) trendDataRef.current.refetchHistory();
}
```

No `isFreshLiveLanding` special case. No internal-flip vs cross-boundary asymmetry. The internal-flip case (live ↔ live) is identical to history's pan/zoom internal-flip — the tile cache absorbs viewport changes that stay within cached coverage. The post-Phase-2 fix arc's "isFreshLiveLanding" branch is retired.

### 4.5 What this gains

- **Single fetch contract.** New developer reading the trend-chart code learns one path.
- **Same overfetch / threshold behavior** in both modes — no surprises when zooming in Live vs fixed.
- **Cache reuse in Live mode.** Pan-left into already-seen territory doesn't refetch. The "cache holds slightly stale near-live tiles" concern is bounded by the `liveFreshness` flag + `evictAll`-on-mode-change.
- **No more "missing-branch" bug class.** The dispatch wrapper has 2 paths instead of 5.

### 4.6 What this costs

- Significant refactor of `useTrendData`, `useLiveSubscription`, `mergeTrendData`, `liveSpineFetch.ts` (deleted), `historyTileFetch.ts` (renamed and generalized).
- `getBufferSnapshot` API on `useLiveSubscription` changes shape (or moves elsewhere). External callers must update.
- Test churn: most live-vs-history split tests consolidate. Estimated test count change: +30 / -50 (net negative).
- Regression risk in the cache-vs-stale-data area — specifically the eviction-on-live-entry semantics that Phase 2 explicitly designed. The `liveFreshness` flag is the proposed replacement, but it adds a new state field that must be respected by every cache read.

---

## 5. Migration Plan

The migration is split into self-landable steps to avoid a single mega-PR.

### 5.1 Preparatory cleanup (Phase B.0)

Run after Phases 4–5 land cleanly.

- Remove the temporary `__spineDiag.ts` infrastructure if still in place.
- Audit test files for live-vs-history symmetry; flag any pairs that should converge.

### 5.2 Step A — Generalize `tilesForViewport` for live mode

`tilesForViewport` already accepts an `overfetchLeftCount` / `overfetchRightCount` override (used by history's live-exit refetch). Live can call it with `overfetchRightCount: 0` (no future overfetch — the accumulator handles right-edge extension).

Add a `mode: 'live' | 'history'` arg if the alignment policy differs (TBD whether live needs TS_BUCKET_ORIGIN_MS alignment for cache stability — probably yes).

Deliverable: `tilesForViewport` accepts live-mode call without changes to history-mode call sites.

### 5.3 Step B — Tile-cache accepts live tiles

Add a `liveFreshness?: number` (ms epoch) field to `CachedEntry`. Tile fetches in Live mode set it; history-mode fetches leave it null. `evictAll` can either evict all entries or only `liveFreshness != null` entries based on context. The existing `evictAll` is "evict all" — keep that behavior; the freshness field is informational for future selective eviction.

Deliverable: `TileCache` API unchanged; entries carry an optional freshness timestamp.

### 5.4 Step C — Move live-spine data into TileCache

This is the load-bearing step. Live-mode fetches go through `runTileFetch` (renamed from `runHistoryTileFetch`) instead of `runLiveSpineFetch`. Results land in TileCache with `liveFreshness` set. `seedFromSpineFetch` is removed; the accumulator-stitching shifts from `getBufferSnapshot`'s "spine + tail" merge to a "tile cache + tail" merge.

`useLiveSubscription`:
- `seedFromSpineFetch` removed.
- `getBufferSnapshot` replaced with `getAccumulatorTail()` (returns just the accumulator portion as an `AggregateTail` | `RawTail`).
- Spine-related refs and helpers removed.

`TrendChartContainer`:
- `mergedData` becomes `mergeTrendData(tileCachedData, liveSub.tail)` in both modes. Live's `tileCachedData` is the active-tile-set merged from TileCache; history's is the same.
- The split-path useMemo from the post-Phase-2 bug fix becomes unnecessary (single path).

Deliverable: live mode uses tile cache. Spine concept retired.

### 5.5 Step D — Dispatch wrapper simplification

Per §4.4. Remove the `isFreshLiveLanding` branch and the internal-flip special-case. Both modes share `evictAll` on mode boundary.

### 5.6 Step E — Spec and handoff updates

Update `hmi_trend_viewer_spec.md` §6 / §10 to reflect the unified path. Retire `hmi_trend_viewer_handoff.md` §10 divergences 28 (mergedData split) and 29 (lastChartDataRef bridge — may still be needed; reevaluate). Replace §8 "Live Tail Runtime Architecture" diagram with the unified flow.

### 5.7 Step F — Test consolidation

Merge live-vs-history test files where they cover the same path. New tests for `liveFreshness` flag and accumulator-stitching with tile-merged spine.

---

## 6. Risks

### 6.1 Cache-staleness in Live mode

Tiles fetched at responseTailTs = T may have null trailing buckets (future-bucket nulling per §6.5). If the operator pans-left and back, the cached tile is reused — including the trailing nulls. The accumulator should override those nulls if it has live data for the same range. Merge logic must handle this correctly. (Note: today's `mergeTrendData` already handles live-wins-on-coverage for the spine model; the same rule applies to tile-merged data.)

### 6.2 Generation counter complications

Today's `useTrendData`'s generationRef and `useLiveSubscription`'s generationRef are separate (one for tile-fetch staleness, one for spine-fetch staleness). Unifying paths may or may not require unifying generation counters. Probably not — they serve different lifecycles (fetch vs. seeded buffer). Investigate during Step C.

### 6.3 Spec section §10.6 (Live Tail) rewrites

§10.6's "Cache-bypass for live mode" wording is load-bearing in the current spec. Step E must rewrite this carefully — the new contract is "live mode uses the cache but adds an accumulator-stitching pass." Make sure the rewrite makes the freshness semantics explicit so future implementers don't reinvent the spine model.

### 6.4 Performance under continuous wheel-zoom

Step 2 of the incremental work (live spine overfetch with ±25% tolerance gate) already addresses the 30-fetch-per-gesture problem. The full unification preserves the threshold-switch behavior. No new perf concern expected, but worth validating with the same smoke test (count network requests during a 1-second continuous wheel zoom — should be 1-3).

---

## 7. Out of Scope

- Tile-level prefetch in Live mode (i.e., fetching `overfetchRightCount > 0` to anticipate the live edge advancing). The accumulator handles right-edge extension; explicit right-prefetch would duplicate that work.
- Per-mode bucket-size dispatch optimizations beyond Phase 6's existing rules.
- LRU cache size tuning. The 50 MB cap is set by `DEFAULT_CACHE_CAPACITY` and is generous for both modes' combined working set.
- Replacing `useLiveSubscription` entirely with `useEffect` + `useReducer`. The hook still owns the WS subscription lifecycle, accumulator, and HWM; only its data-buffer role is reduced.

---

## 8. Open Questions

1. **Should tile-grid alignment apply in Live mode?** History aligns to `TS_BUCKET_ORIGIN_MS` for cross-client cache key stability. Live's spine bypasses alignment because the viewport rolls with `now` and alignment would cause off-by-one bucket flips per tick. Under the unified model, live tiles need either (a) alignment plus tolerance for the right-edge tile's "shifting" coverage, or (b) live-specific keys that include a "live anchor" timestamp.

   Recommended resolution during Step C: align live tiles to the grid (same as history); the rightmost tile may be partially "future-nulled" but that's already how the server handles it. Cache key remains `(tagId, startTime, endTime, bucketCount)` with `bucketCount` distinguishing live (1000) from history (500). No special key fields needed.

2. **What's the `liveFreshness` field actually used for?** If `evictAll` always evicts everything regardless of mode, the flag is informational only. Future selective-eviction policies (e.g., "evict only live tiles older than N seconds") could use it, but Phase B doesn't need them.

   Recommended resolution: ship the field as nullable / informational. Don't add selective eviction in this proposal.

3. **Does `liveSub.tail` change shape?** Today `tail` is `AggregateTail | RawTail | null`. Under the unified model, the tail is still the accumulator state — same shape. `getAccumulatorTail()` returns this. No wire-format change. Verify during Step C.

---

## 9. Estimated Effort

Step A: 0.5 day (parameterize `tilesForViewport`).
Step B: 0.5 day (`TileCache` freshness flag).
Step C: 2-3 days (the real work — refactor `useTrendData`, `useLiveSubscription`, `mergeTrendData`; consolidate fetch logic; update `TrendChartContainer`).
Step D: 0.5 day (`dispatchModeAction` simplification).
Step E: 0.5 day (spec / handoff updates).
Step F: 1 day (test consolidation).

Total: ~5-6 days of focused work. Test churn is the biggest unknown — the number could grow if the live-vs-history test split has more drift than expected.

---

## 10. Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 2026-05-19 | PM / Claude | Initial draft. Captured after the syncDataViewport hoist (Step 1) and live-spine overfetch (Step 2) incremental fixes. |
