# Trend Viewer — Unified Tile Architecture

**Status:** Design proposal — implementation-ready
**Author:** PM / Claude
**Date:** 2026-05-19
**Supersedes:** `trend_unify_live_history_fetch_proposal.md` v0.1
**Related:** `hmi_trend_viewer_spec.md` §6 (Tile API), §10 (Cache Strategy), §11 (Issues E/F/G); `hmi_trend_viewer_handoff.md` §5 (Data Fetch), §8 (Live Tail Runtime Architecture), §10 divergences 25–29 / 31; `trend_viewer_audit_2026-05-19.md`

---

## 1. Summary

Replace the dual-path data architecture in `@caro/trend-chart` (spine fetch for Live mode + tile fetch for History mode) with a single tile-based pipeline governed by the **terminal-cache rule**: a tile is cacheable iff `responseTailTs >= tile.endTime`. The "live-edge" tile is held uncached in the active-tile-entry until a deterministic refetch trigger converts it to a terminal tile in the LRU. Failure paths cache a synthesized null tile to prevent retry loops.

The architecture preserves the operator-facing live-tail experience while closing five observable bugs in the current spine model and eliminating four audit-tracked divergences by construction.

This proposal is the resolved version of the design discussion captured during the 2026-05-19 audit conversation. All open design points from the v0.1 proposal (`§6.2`, `§8 Q1`, `§8 Q2`, `§8 Q3`) are resolved.

---

## 2. Motivation

### 2.1 Observed bugs in the current spine model

The current implementation produces five user-facing bugs in fixed-live transitions and long live-trailing sessions:

| # | Bug | Root cause in spine model |
|---|---|---|
| 1 | Traces not updating in `live-fixed` mode after pan-right | `liveSpineFetch.ts:133` short-circuits on `!spanChanged`. Pan from `live-trailing` to `live-fixed` preserves `sizeMs`, so `spanChanged === false`. Spine is not refetched for the new viewport; `spineRef` retains data from the prior viewport. |
| 2 | Empty (null) tiles accessible from fixed mode | `refetchHistory()` at Live exit fetches tiles whose `endTime` extends just past `responseTailTs` due to tile-grid alignment. Server applies future-bucket-nulling. The future-nulled tiles enter the LRU and persist across panning, with no accumulator to override them in fixed mode. |
| 3 | Visible gap between tile and live data | Handoff §11.F. Spine's right edge is at fetch-time `responseTailTs`; accumulator's `firstClosedStartMs` lands at the next bucket boundary after the first WS sample. If `firstSampleTs > responseTailTs + bucketSMs`, a 1+ bucket null window appears at the seam. |
| 4 | Missing tiles at left edge in `live-fixed` after zoom-out | Handoff §11.E. Spine covers a single tile-sized range. Wheel-zoom-out widens the viewport without changing `sizeMs`. The new viewport's left edge falls outside the spine's coverage. No spine refetch fires because the `spanChanged` guard does not catch wheel-zoom widening with `lastIntent='zoom'`. |
| 5 | No traces displayed in long `live-trailing` (x-axis rolling) | Spine fetched once on Live entry, never refetched (`spanChanged` is false in pure live-trailing). After `2 × sizeMs` of session time, the spine's right buckets are stale future-nulls; the accumulator's coverage drifts forward; LOCF carries spine's terminal null into the gap between spine end and accumulator start. The visible window converges to "only the rightmost bucket has data." |

Bugs 1, 2, 4, 5 are closed by construction in the unified architecture (§5). Bug 3 is reduced to a transient at-most-one-bucket window per refetch, no longer a persistent gap.

### 2.2 Bug-class repetition

During Phases 2–4 of the live-trailing decouple work, the same shape of bug surfaced four times, all rooted in dual-path state coupling:

- Wholesale-replace gap (Phase 2c): `seedFromSpineFetch` clip used stale `firstClosedStartMs` after `bucketSMs` change.
- Fixed → Live freeze: `evictAll` did not sync `dataViewport`; new fetch never dispatched.
- Zoom-within-Live not refetching: same shape — internal Live-flip branch missing `syncDataViewport`.
- `isFreshLiveLanding` scoping: cross-mode teardown branch caught the wrong transition pattern.

Each fix added a divergence entry to handoff §10 (currently 25–29 / 31). The bug class repeats because the spine path and the tile path maintain overlapping state (viewport bounds, generation counters, accumulator/cache reset triggers) without a single source of truth. Unifying the paths eliminates the class structurally.

### 2.3 Performance asymmetry

History mode benefits from tile-grid alignment, LRU reuse, asymmetric overfetch, and discrete bucketSMs levels with explicit 1.5× threshold switching. Live mode has none of these — every span change is a fresh full-viewport fetch with no reuse. Unifying paths exposes Live to all of History's performance properties at no additional infrastructure cost.

### 2.4 Spec coherence

Spec §6 defines a single tile API. Spec §10 defines a single cache strategy. Today's §10.6 ("Cache-bypass for live mode") explicitly notes the spine path was kept separate to defer cache-eviction complexity. The post-Phase-2 unified buffer in `useLiveSubscription` re-internalized that complexity in a different layer. The original separation is no longer load-bearing — the audit's handoff §10 divergences 25–29 testify to its cost.

---

## 3. Current state (recap)

### 3.1 Spine path

```
useTrendData.ts
  └── runLiveSpineFetch (liveSpineFetch.ts)
        ├── single tile spanning full viewport
        ├── bucketCount = visibleTilesPerWindow × bucketCount (1000)
        ├── fetch via gatedFetchTile
        ├── assembleLiveSpine + seedFromSpineFetch
        └── update spineRef in useLiveSubscription
```

Storage: `spineRef` in `useLiveSubscription`; not in `TileCache`. Reuse: none — every span change fetches fresh.

### 3.2 History path

```
useTrendData.ts
  └── runHistoryTileFetch (historyTileFetch.ts)
        ├── tilesForViewport → 2 visible + 1 prefetch each side
        ├── fetch each tile via gatedFetchTile
        ├── store results in LRU TileCache
        └── update activeTilesRef + finalizeRef
```

Storage: `TileCache` (LRU, 50 MB, keyed by `(tagId, startTime, endTime, bucketCount)`). Reuse: pan/zoom within cached range → no fetch.

### 3.3 State in `useLiveSubscription`

Today: spineRef, accumulators, raw buffers, ring, HWM, generation counter, sessionHighWaterMark.

---

## 4. Design decisions

This section records the resolved answers to the v0.1 proposal's open questions. The full discussion appears in the audit conversation; this section captures conclusions.

### 4.1 Cache rule — terminal-cache-only

**Decision:** A tile is written to the LRU iff `responseTailTs >= tile.endTime`. Tiles where `responseTailTs < endTime` are held in `activeTilesRef` only, used by `mergeTrendData` for rendering, but never cached.

**Rationale:** The future-bucket-nulling issue (cached entries with server-side nulls becoming stale as time advances past their `responseTailTs`) reduces to one binary predicate: *can a cache entry contain server-side nulls that will later become wrong?* The predicate is satisfied iff the response was captured before the tile's right edge was real. The cache rule encodes the predicate exactly. Once a tile is cacheable, it is **terminal** — no future merge can resurrect stale data because there's no future region to be stale about.

**Implication:** Spec §10.8 (Cache Freshness on Mode Transition) is deleted entirely. Gap B (cross-session frozen CAG-lag nulls) cannot occur — live-edge tiles never enter the cache. `evictAll` is removed from production code paths.

### 4.2 Refetch trigger — HWM-driven, per-active-tile scan

**Decision:** On every WS sample, after `sessionHighWaterMark` is bumped, scan `activeTilesRef.current` for entries with `responseTailTs < endTime`. If any such entry satisfies `HWM >= entry.tile.endTime + REFETCH_LAG_MS` and no refetch is in flight, fire a refetch for the entry with the earliest `endTime`. One in-flight refetch at a time (single `refetchInFlightRef` flag).

`REFETCH_LAG_MS = 1000` — matches the existing `responseTailTs - 1000` ring trim threshold from spec §6.2. The same constant tracks writer-lag absorption; defined once in `level.ts`, referenced from both call sites.

**Rationale:** HWM is monotonic-non-decreasing within a Live session. Once the trigger threshold is crossed, the predicate stays true until the tile is cached or removed from the active set. Per-tile state (rather than a single global pending-refetch ref) handles the rolling-rightmost-tile transition cleanly: when viewport rolls past a previously-uncached tile's endTime, the new rightmost tile is uncached AND the old rightmost (now interior) is also uncached. Both await refetch eligibility; the scan picks them up in `endTime` order.

**Implication:** The active-tile-entry structure carries `responseTailTs` and `shape` (see §4.6). The WS subscribe callback gains one bounded scan per sample (active set is ≤4 entries; cost negligible).

### 4.3 Refetch failure — null-tile-on-failure

**Decision:** On refetch failure, synthesize a null tile with same `(startTime, endTime, bucketCount)` keys as the failed tile and `responseTailTs = Number(tile.endTime)`. Cache it. The terminal predicate is now satisfied, so the refetch trigger predicate becomes false. Log via `console.error`. No retry loop, no exponential backoff.

**Rationale:** Spec §14.3 prescribes "failed → null gap; operator interaction drives re-fetch" for History fetch failures. The null-tile approach is the natural application of that pattern to the refetch path — the failed range renders as nulls (same visual contract as History failures), the trigger predicate becomes false (preventing the 4 Hz retry storm that an unguarded HWM-driven trigger would produce), and operator-driven recovery (panning to a different alignment) creates a fresh active-tile-entry with a new fetch attempt.

For `live-trailing` (the common case), the accumulator's `2 × sizeMs` coverage extends back past the tile's `startTime` — synthetic nulls in the active set are fully overridden by the accumulator on merge. The user sees no visual difference; the chart keeps rendering correctly.

**Implication:** No retry/backoff state on the active-tile-entry. The terminal-cache rule and the failure handling produce the same end state (`responseTailTs >= endTime`), simplifying both the data model and the test surface.

### 4.4 Generation counter — single source

**Decision:** Delete `useLiveSubscription.generationRef`, `getCurrentGeneration()`, and the `dispatchGeneration` parameter on `seedFromSpineFetch`. Keep `useTrendData.generationRef` for tile-fetch staleness. `useLiveSubscription`'s `commitAndDrain` (renamed `drainBuffers`) no longer bumps any counter.

**Rationale:** Under the unified path, `seedFromSpineFetch` is deleted along with `spineRef`. The live counter's sole consumer disappears. Race-condition analysis confirms no remaining consumer needs identity tracking in `useLiveSubscription`: the `isLiveRef` synchronous ref-update during render gates bucketing across mode flips; the `if (state)` guard at `useLiveSubscription.ts:430` covers the in-flight window between mode change and accumulator allocation. Tile-fetch staleness is handled by `useTrendData.generationRef`, including the refetch path.

**Implication:** v0.1's §6.2 ("Generation counter complications") is closed. Spec §19 glossary entry for `Generation counter` is rewritten to refer to `useTrendData` only.

### 4.5 `dispatchModeAction` simplification

**Decision:** `dispatchModeAction` reduces to:

```ts
const dispatchModeAction = useCallback((action: TrendModeAction) => {
  const prev = modeStateRef.current;
  const next = trendModeReducer(prev, action);
  const wasLive = isLive(prev.mode);
  const willBeLive = isLive(next.mode);

  syncDataViewport(modeToViewport(next));  // unconditional (Phase 6 hoist preserved)

  if (wasLive && !willBeLive) {
    // Live → fixed: clear accumulator; natural effect re-run on syncDataViewport
    // covers the new viewport's tile fetch.
    liveSubRef.current?.drainBuffers();
  }
  // !wasLive && willBeLive (fixed → Live): no teardown.
  //   - No evictAll: terminal-cache rule guarantees no stale entries to evict.
  //   - No drainBuffers: accumulator is already empty in fixed mode.
  // wasLive && willBeLive (internal Live flip): no teardown.
  //   - Active set absorbs viewport change via tilesForViewport.
  // !wasLive && !willBeLive (fixed → fixed): no teardown.

  dispatch(action);
}, [dispatch, syncDataViewport]);
```

**Rationale:** `evictAll` is no longer needed (§4.1). `commitAndDrain → drainBuffers` no longer bumps a counter (§4.4). The `isFreshLiveLanding` branch retires — it existed to handle wholesale-replace clip-state, which `seedFromSpineFetch` deletion removes. `refetchHistory()` is removed; the `syncDataViewport` hoist ensures the natural effect re-run fires on every transition.

**Implication:** Four teardown branches → one. The dispatch wrapper is auditable in 20 lines.

### 4.6 Active-tile-entry shape

**Decision:** Replace `activeTilesRef.current: Tile[]` with `activeTilesRef.current: ActiveTileEntry[]`:

```ts
interface ActiveTileEntry {
  tile: Tile;
  responseTailTs: number | null;        // null until first fetch resolves
  shape: 'raw' | 'aggregate' | null;    // captured from first fetch; used by synthesizeNullTile on refetch failure
}
```

Two fields beyond `tile`. The shape field is required to synthesize a correctly-typed null tile on refetch failure (the discriminated union has different per-series shapes for raw vs. aggregate).

**Rationale:** Per-tile `responseTailTs` is required by the refetch trigger predicate (§4.2). Per-tile `shape` is required by the failure-path synthesis (§4.3). Together they support the terminal-cache rule and the failure handling without additional state.

### 4.7 Bucketing-while-fixed — preserve current behavior

**Decision:** The subscribe callback continues to update the ring and bump HWM in all modes; bucketing remains gated on `isLive(mode)`. Subscriptions stay warm in fixed mode. No code change required.

**Rationale:** The ring's pre-charge role during fixed mode is mostly redundant under the refined design (the live-edge tile fetched at Live re-entry covers the ring's range; replay produces redundant but correct data). The cost of pre-charging (20 entries per tag, FIFO, at 4 Hz) is trivial. The cost of removing it (subscribe-callback branch on `isLiveRef`, additional state-dependent behavior, more test surface) outweighs the marginal benefit.

The spec §19 glossary entry for `sessionHighWaterMark` is reworded from "highest moduleTs observed since Live entry" to "highest moduleTs observed since the last `drainBuffers` reset, regardless of mode" — one-line update.

### 4.8 Tile-grid alignment in Live mode

**Decision:** Live tiles use the same `tilesForViewport` alignment policy as History — right-anchor on `TS_BUCKET_ORIGIN_MS`. The rightmost tile's `endTime` is the first tile-boundary at or after `viewport.end`, possibly extending into the future by up to one `tileSpanMs`. The terminal-cache rule (§4.1) ensures future-extending tiles are not cached; the refetch trigger (§4.2) converts them to terminal as time advances.

**Rationale:** Tile-grid alignment is the cache-stability property — identical logical tiles produce identical wire keys across operators and sessions, enabling LRU hits. The historical concern (rightmost tile drifting `tileSpanMs` into the future) is exactly the case the terminal-cache rule addresses.

`overfetchRightCount: 0` for Live mode (no right-side prefetch — the accumulator handles right-edge extension). `overfetchLeftCount: 1` retained for left-pan prefetch coverage.

### 4.9 Multi-tile `responseTailTs` aggregation

**Decision:** No aggregation needed. Each active-tile-entry carries its own `responseTailTs`. The client-side trim threshold for the WS ring uses the **maximum** across active entries — corresponds to "the most recent server observation across the active set."

**Rationale:** v0.1 §8 Q3 deferred this. Under per-entry storage (§4.6), there is no decision to defer — `max(entry.responseTailTs)` is well-defined and updates naturally as fetches and refetches resolve.

---

## 5. Target architecture

### 5.1 Single fetch path

Replace `runLiveSpineFetch` and `runHistoryTileFetch` with one `runTileFetch`:

1. Computes tile-aligned ranges via `tilesForViewport({ visibleTilesPerWindow: 2, bucketCount: 500, overfetchPerSide: 1, overfetchRightCount: isLive ? 0 : 1 })`.
2. For each tile, check LRU. Cache hit → skip fetch, attach cached entry to active set.
3. For each cache miss, fire `gatedFetchTile`. On resolve, evaluate the terminal predicate (`responseTailTs >= endTime`):
   - True → cache the response and add to active set.
   - False → add to active set with the response data but do NOT cache.
4. Update `activeTilesRef` to the assembled active set.
5. Bump `swapCounter` and update React state to trigger render.

### 5.2 Refetch trigger

`useLiveSubscription`'s subscribe callback gains a post-HWM-bump scan:

```ts
// After: sessionHighWaterMarkRef.current = mTs
if (!refetchInFlightRef.current) {
  const eligible = activeTilesRef.current
    .filter(e =>
      e.responseTailTs !== null &&
      BigInt(e.responseTailTs) < e.tile.endTime &&
      sessionHighWaterMarkRef.current! >= e.tile.endTime + REFETCH_LAG_MS
    )
    .sort((a, b) => Number(a.tile.endTime - b.tile.endTime));

  if (eligible.length > 0) {
    fireRefetch(eligible[0]!);
  }
}
```

`fireRefetch` issues the request via the same `runTileFetch` orchestration as initial fetches. On success: terminal predicate is satisfied; entry transitions to cached; active set retains it as cached entry. On failure: §4.3 null-tile path fires.

### 5.3 Live mode adds accumulator stitching at render

`useLiveSubscription`'s role narrows: WS subscription lifecycle + ring + accumulator + HWM. No spine, no seed, no per-render buffer snapshot.

`mergeTrendData(activeData, liveSub.tail)`:
- `activeData` = `mergeActiveTiles(activeTilesRef.current, tagIds)` — assembles cached + uncached active-tile-entries into a single TrendData (cached entries from LRU, uncached entries from their own `data` field).
- `liveSub.tail` = accumulator state (`AggregateTail | RawTail | null`).
- Merge applies live-wins-on-coverage as today.

The `mergedData` is computed once per render via `useMemo` keyed on `activeTilesRef.current.length`, `swapCounter`, and `liveSub.tail`. Single code path; no live-vs-history split.

### 5.4 `useLiveSubscription` API after refactor

Kept:
- `commitAndDrain` → renamed `drainBuffers`. Clears ring, accumulators, raw buffers, sessionHighWaterMark. Does not bump any counter.
- `getLatestSampleTs()` — unchanged.
- `tail` — unchanged.

Deleted:
- `seedFromSpineFetch`
- `getBufferSnapshot`
- `getCurrentGeneration`
- `spineRef`
- `generationRef`

---

## 6. How the bugs close

| # | Bug | Resolution |
|---|---|---|
| 1 | Traces not updating in `live-fixed` after pan-right | `tilesForViewport` re-runs on every viewport change; new active set reflects panned position; cache hits on left tiles, fetch for new rightmost. **Closed structurally.** |
| 2 | Empty (null) tiles cached from fixed mode | Terminal-cache rule (§4.1) prevents future-nulled tiles from entering the LRU. **Closed structurally.** |
| 3 | Gap between tile and live data | Refetch trigger (§4.2) keeps the rightmost tile fresh at `endTime + 1s` cadence. Maximum staleness reduced from "indefinite spine lifetime" to "one tileSpanMs window." The WS-arrival-timing transient (up to one bucket) remains; bounded to ~60ms at 1m preset, scaling proportionally for larger presets. **Reduced; QA gate in §10.** |
| 4 | Missing tiles at left edge in `live-fixed` after zoom-out | Tile-aligned active set covers the post-zoom-out viewport on the next `tilesForViewport` call; cache hits on previously-fetched ranges. **Closed structurally.** |
| 5 | No traces displayed in long `live-trailing` (x-axis rolling) | Active set rolls naturally with viewport via `tilesForViewport`; refetch trigger keeps live-edge fresh. No accumulator-spine coverage divergence. **Closed structurally.** |

---

## 7. Audit-finding consequences

This section is the durable record for how each finding in `trend_viewer_audit_2026-05-19.md` is resolved. Once Step E lands and H3 is routed to its own track (§7.3), the audit file's only remaining content will be informational observations and the closed-by-construction set — at that point it can be deleted; this section supersedes it.

### 7.1 Closed by construction

The unified-tile refactor eliminates these findings structurally — no separate fix needed:

| Finding | Status under proposal |
|---|---|
| H4 (skip-guard description) | Deleted — no separate Live path needing a skip guard |
| M2 (`seedFromSpineFetch` wholesale-replace conditional) | Deleted — function does not exist post-Step C |
| Handoff §10 divergence 25 | Retired — `spineMetadataMatches` gate not needed |
| Handoff §10 divergence 26 | Retired — wholesale-replace clear not needed |
| Handoff §10 divergence 27 | Retired — type-coherence guard in `getBufferSnapshot` not needed (function deleted) |
| Handoff §10 divergence 28 | Retired — split live/history `mergedData` path collapses to single `useMemo` |
| Handoff §10 divergence 29 (`lastChartDataRef` bridge) | Likely retained — cross-boundary fetches still produce brief null window |
| Handoff §10 divergence 31 (`syncDataViewport` hoist) | Retained — still required by `dispatchModeAction` |

### 7.2 Absorbed into Step E (doc rewrite during spec/handoff updates)

These are documentation-only fixes that fold into the Step E spec/handoff rewrite. Each carries a recommended direction; pick during Step E execution:

| Finding | Step E action | Recommended direction |
|---|---|---|
| H5 (aggregate merge `liveEndIndex > 0` guard described as "unconditional") | Rewrite spec §10.6 / handoff §1 phrasing to "Clip cached at `max(0, liveEndIndex)` when live data extends past `cached.startTime`." Drop the "unconditional" framing. | Doc-only. The guard is load-bearing in `mergeTrendData.ts:71-74` (without it, `Math.min(cached.n, Math.max(0, 0)) = 0` would zero out cached when the live tail doesn't overlap). Wording was over-strong; code is correct. |
| M1 (`endPickerCommitted` from `fixed` with a future End enters `live-fixed`) | Reconcile spec §9.3 transition table row, §12.2 prose, and `useTrendMode.ts` reducer. | **(a) — match docs to code.** The §9.3 symmetric-classification prose already says the rule applies uniformly from any starting state; only the transition-table row and §12.2 prose disagree. Update both to read "from `fixed`, `to > latestSampleTs (= state.to fallback)` → `live-fixed`." The reducer behavior is conceptually cleaner than carving a `fixed`-special case. |
| M3 (initial mode is `live-trailing`, spec §13.5 implies blank-fixed) | Reconcile §13.5 wording with `useTrendMode.ts` initial state. | **(b) — match docs to code.** Update §13.5 to "initial mode is `live-trailing`; the empty-state prompt appears whenever `tagIds.length === 0`." User-visible state is correct either way (`useTrendData` short-circuits on empty tagIds). Switching initial mode to `fixed` would force a wasted `fixed → live-*` transition on first tag add (with `evictAll` under the current spine model — moot post-terminal-cache, but the docs-match path avoids the question entirely). |
| M4 (stale `bucketCount=250` / "4×250" wording in spec §17.1, §16.3, §19 and parts of §10.4) | Sweep the spec for `bucketCount=250`, "4×250", "4-range parallel" residues. Replace with `bucketCount=500`, "2×500 + 1 prefetch each side", "`windowSec / (2 × 500)`". | Pure find-and-replace; no design decision. |

### 7.3 Out of scope for this proposal

| Finding | Disposition |
|---|---|
| H3 (WS trend listener is per-ingest, not per-COV) | Server-side change to `TelemetryIntake` and `WsServer.handleTrendDelta`. Independent of client-side fetch unification. **Logged in `Docs/platform_todo.md`** (Trend Viewer — Deferred section) with the file:line refs and direction-decision detail. Behavior is currently correct (LOCF propagates correctly); only the documented wire-shape and outbox-growth model are wrong. |
| H1, H2 | Closed 2026-05-19 — listed in audit closure table. |
| M5, M6, M7 / L1 | Closed 2026-05-19 — listed in audit closure table. |
| L2, L3, L5 | Closed 2026-05-19 — listed in audit closure table. |
| L4, N1–N3 | No action (observations or unit-convention notes). |

---

## 8. Migration plan

### 8.1 Step A — Parameterize `tilesForViewport` (0.5 day)

`tilesForViewport` already accepts `overfetchRightCount`. No code change needed for Live's `overfetchRightCount: 0` call. Verify by writing a unit test that exercises the Live call site with the expected geometry.

### 8.2 Step B — Active-tile-entry shape (0.5 day)

Refactor `activeTilesRef: Tile[]` → `activeTilesRef: ActiveTileEntry[]`. Update `tileActiveSet.ts` (`pruneAndAdd`, `assembleData`, `storeTileResult`, `computeResponseTailTs`) to handle the new shape. The `responseTailTs` field replaces the existing per-tile computation in `computeResponseTailTs` with a direct lookup. The `shape` field is set on first successful fetch by reading the response's `source` discriminant.

### 8.3 Step C — Unified fetch orchestration (3 days)

Load-bearing step.

- Create `runTileFetch` consolidating `runLiveSpineFetch` and `runHistoryTileFetch` logic.
- Implement the terminal-cache predicate at the storage decision point: `if (responseTailTs >= tile.endTime) cache.set(...) else activeTileEntry.data = response`.
- Implement `synthesizeNullTile(tile, shape, tagIds)` for the failure path.
- Wire the refetch trigger scan into `useLiveSubscription`'s subscribe callback after HWM bump.
- Delete `liveSpineFetch.ts`, `seedFromSpineFetch`, `getBufferSnapshot`, `spineRef`, `useLiveSubscription.generationRef`, `getCurrentGeneration`.
- Rename `commitAndDrain` → `drainBuffers`.
- Update `TrendChartContainer`:
  - Single `mergedData` path via `mergeTrendData(activeData, liveSub.tail)`.
  - Remove live-vs-history split useMemo.
  - Wire active-set-aware `responseTailTs` trim threshold (max across entries).

### 8.4 Step D — `dispatchModeAction` simplification (0.5 day)

Apply the §4.5 form. Remove `evictAll`, `refetchHistory`, `isFreshLiveLanding`. Keep `syncDataViewport` hoist and `drainBuffers` on Live → fixed.

### 8.5 Step E — Spec and handoff updates (1.5 days)

**Audit absorption.** Fold in the §7.2 items as part of this step: H5 wording fix in spec §10.6 / handoff §1, M1 reconciliation of §9.3 transition table + §12.2 prose with the reducer (recommended direction (a) — match docs to code), M3 update to §13.5 (recommended (b) — match docs to code), and M4 sweep of `bucketCount=250` / "4×250" residues. None are load-bearing on the unified-tile refactor itself; they ride along to close out the audit.

**Core rewrites:**

- `hmi_trend_viewer_spec.md`:
  - §6.5 — future-bucket-nulling clause retained server-side; client-side wording updated to reflect terminal-cache rule.
  - §10.1 — cache key namespace section retained; add note that live-mode entries are subject to terminal-cache rule.
  - §10.6 — rewritten end-to-end:
    > Tiles are cached iff `responseTailTs >= endTime`. The "live-edge" tile (rightmost in Live mode, where `endTime > responseTailTs`) is held in `activeTilesRef` only. A refetch trigger fires when `HWM >= endTime + REFETCH_LAG_MS` and the tile is uncached, converting it to a terminal cached tile. On refetch failure, a synthetic null tile is cached to satisfy the terminal predicate; further refetches do not fire for this entry. Operator action (pan/zoom to a different alignment) recovers via fresh tile keys.
  - §10.7 — preserved; subscriptions remain warm in all modes.
  - §10.8 — deleted entirely.
  - §11.E, §11.F, §11.G — annotated as closed (or reduced for §11.F).
  - §14.3 — extended one sentence: "On refetch failure, the same null-tile-on-failure rule applies — the failed tile is cached as a synthetic null entry; operator action drives recovery."
  - §19 glossary:
    - `sessionHighWaterMark` — clarify "since last `drainBuffers` reset, regardless of mode."
    - `Generation counter` — refer to `useTrendData` only.
    - Add entry for `terminal-cache rule`.
    - Add entry for `REFETCH_LAG_MS`.
- `hmi_trend_viewer_handoff.md`:
  - §5 — rewrite as unified `runTileFetch`.
  - §8 — replace "Live Tail Runtime Architecture" diagram with the unified flow.
  - §10 divergences 25–28 — delete.
  - §10 divergence 29 — re-evaluate; likely retain.
  - §10 divergence 31 — retain (still in code).
  - §11.E, §11.F, §11.G — mark as closed/reduced with reference to the proposal.

### 8.6 Step F — Test consolidation (1 day)

- Delete: spine-specific tests in `useLiveSubscription.test.ts`, `useTrendData.test.ts`. Estimated ~30 tests.
- Add: terminal-cache predicate tests, refetch trigger scan tests, null-tile-on-failure tests, rolling-rightmost-tile transition tests, multi-tile responseTailTs aggregation tests. Estimated ~30 tests.
- Smoke test for Bug 3 transient (§10): verify WS-arrival-timing gap at fresh-fetch boundary is < 1 bucketSMs for all preset values.

---

## 9. Risks and design considerations

### 9.1 Cache pollution from extended outages

During multi-hour network outages in `live-trailing`, tiles roll about once per `tileSpanMs`. Each roll produces a refetch attempt; each fails; each writes a synthetic null tile. At the 1m preset (`tileSpanMs = 30s`), this is 120 null entries per hour. At 50 MB / ~2 KB per entry = 25,000-entry cap, this is operationally insignificant. LRU evicts naturally as the operator pans into other ranges.

### 9.2 Same-key persistent failures

If the operator pans back into a range containing a synthetic null tile, the cache hit returns nulls. Pan/zoom to a different alignment to force fresh keys. This matches §14.3's existing operator-driven recovery pattern. No automatic retry — accepted as a deliberate simplicity tradeoff vs. exponential backoff.

### 9.3 Bug 3 transient

The WS-arrival-timing gap at fresh-fetch boundaries (up to one `bucketSMs` at the seam between newly-fetched tile data and accumulator data) is reduced from "persistent and growing" (spine model) to "transient at refetch boundaries." For 1m preset (`bucketSMs ≈ 60ms`), the gap is sub-perceptual. For larger presets (`bucketSMs ≥ 1s`), the gap could be a full bucket visible. If QA reveals this is observable, a follow-up enhancement could have the server emit the bucket containing `responseTailTs` with its partial data; this is a server-side change, not a client architecture change.

### 9.4 Mental-model shift

Today's invariant: "Live mode bypasses the cache; spine is in its own ref." Simple.
Refined: "Live-edge tile uncached in active-tile-entry; refetch trigger converts to terminal cached tile after `endTime + REFETCH_LAG_MS`; synthetic null tile cached on failure." More moving parts, each individually justified, but the cognitive load is higher. Mitigated by clear spec §10.6 rewrite and the terminal-cache predicate being a single binary rule.

### 9.5 One small lie in the cache

The LRU now contains synthesized null entries on refetch failure. The cache is no longer "what the server returned" — it's "what the session decided this range should look like." This is a real contract change. Accepted because the alternative (no caching of failed entries) reintroduces the 4 Hz retry storm.

### 9.6 Concentrated Step C risk

Step C touches every trend-chart hook simultaneously. Cannot land in isolation. Mitigation: Steps A and B land first as preparation; the refactor in Step C is constrained by the well-specified design above (Issues #1–#6 from the audit conversation resolved); test coverage for the refactor is the primary gate.

---

## 10. Test strategy

### 10.1 Unit tests (Vitest)

New test cases:

- **Terminal-cache predicate.** Verify cache.set() called iff `responseTailTs >= endTime`; verify uncached entries in activeTilesRef carry response data.
- **Refetch trigger scan.** Verify scan fires on WS sample after HWM bump; fires only when predicate satisfied; respects in-flight guard; picks earliest-endTime when multiple eligible.
- **Null-tile-on-failure.** Verify failure synthesizes a tile with `responseTailTs = endTime`, all-null series; verify it's cached; verify refetch predicate becomes false.
- **Rolling-rightmost-tile.** Verify active set transitions cleanly when viewport rolls past current rightmost; verify the new rightmost is uncached and the previous-rightmost gets refetch-eligible.
- **Multi-tile responseTailTs aggregation.** Verify max across active entries drives the WS ring trim threshold.
- **Bug 5 regression.** Simulate a multi-minute live-trailing session; verify accumulator coverage extends to the visible left edge throughout.

### 10.2 Integration tests

- End-to-end Live → fixed → Live cycle with cache reuse on the historical portions; verify no stale-tile leakage.
- Pan-into-failed-range; verify cached null entry is returned; verify pan to different alignment recovers.
- Zoom-out in `live-fixed`; verify active set widens correctly; verify left-edge tiles render.

### 10.3 Empirical gates

- Bug 3 transient measurement: at each preset, time a fresh-fetch refetch and observe whether the spine/tail seam shows a visible gap. If `bucketSMs ≥ 1s` produces a perceptible gap, follow up with server-side bucket-containing-responseTailTs emission.
- Long live-trailing soak test: 30-minute session at 1m preset; verify continuous trace rendering throughout.

---

## 11. Estimated effort

| Step | Description | Duration |
|---|---|---:|
| A | Parameterize `tilesForViewport` | 0.5 day |
| B | Active-tile-entry shape | 0.5 day |
| C | Unified fetch orchestration | 3 days |
| D | `dispatchModeAction` simplification | 0.5 day |
| E | Spec and handoff updates (incl. audit §7.2 absorption) | 1.5 days |
| F | Test consolidation + new tests | 1 day |
| **Total** | | **7 days** |

Risk concentration: Step C. The design is well-specified so the estimate is reliable, but unforeseen edge cases during the refactor could extend Step C to 4 days. Steps A and B should land first as separate PRs to derisk; Step C lands as a single large PR; Steps D, E, F follow incrementally.

---

## 12. Open questions

All design questions from v0.1 are resolved:

| v0.1 ref | Question | Resolution |
|---|---|---|
| §6.1 | Cache-staleness in Live mode | §4.1 terminal-cache rule |
| §6.2 | Generation counter complications | §4.4 single counter in `useTrendData` |
| §6.3 | §10.6 rewrite carefully | §8.5 spec rewrite scoped |
| §6.4 | Continuous wheel-zoom perf | Validated; one fetch per level transition, same as today |
| §8 Q1 | Tile-grid alignment in Live | §4.8 same as History |
| §8 Q2 | `liveFreshness` field consumer | Field deleted; not needed under terminal-cache rule |
| §8 Q3 | `liveSub.tail` shape | Unchanged |

No new open questions surfaced during the design discussion.

---

## 13. Revision history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-05-19 | PM / Claude | Initial proposal. Supersedes `trend_unify_live_history_fetch_proposal.md` v0.1. Incorporates resolved design from audit conversation: terminal-cache-only rule, Variant C refetch trigger with per-tile scan, null-tile-on-failure, single generation counter, simplified `dispatchModeAction`. Motivated by five observed bugs in the spine model (§2.1) — four closed by construction, one reduced. |

---

## 14. Appendix — Call-site enumeration

Files modified during Step C:

| File | Nature of change |
|---|---|
| `packages/trend-chart/src/useTrendData.ts` | Major: consolidate Live and History paths into `runTileFetch`; integrate terminal-cache predicate; remove live-spine branch |
| `packages/trend-chart/src/useLiveSubscription.ts` | Major: delete `spineRef`, `seedFromSpineFetch`, `getBufferSnapshot`, `generationRef`, `getCurrentGeneration`; add refetch-trigger scan; rename `commitAndDrain` → `drainBuffers` |
| `packages/trend-chart/src/liveSpineFetch.ts` | Deleted |
| `packages/trend-chart/src/historyTileFetch.ts` | Renamed `runHistoryTileFetch` → `runTileFetch`; generalized to handle Live and History uniformly |
| `packages/trend-chart/src/tileActiveSet.ts` | Update `pruneAndAdd`, `assembleData`, `storeTileResult`, `computeResponseTailTs` to use `ActiveTileEntry[]` instead of `Tile[]` |
| `packages/trend-chart/src/tileCache.ts` | Add terminal-cache predicate check at `cache.set` call site (or at caller); no API change to `TileCache` itself |
| `packages/trend-chart/src/mergeTrendData.ts` | Possibly minor; merge contract unchanged |
| `packages/trend-chart/src/TrendChartContainer.tsx` | Consolidate `mergedData` to single `useMemo`; simplify `dispatchModeAction`; remove live-vs-history split |
| `packages/trend-chart/src/level.ts` | Add `REFETCH_LAG_MS = 1000` constant |
| `packages/trend-chart/src/types.ts` | Add `ActiveTileEntry` interface |
| `packages/trend-chart/src/api.ts` | No change |
| `packages/trend-chart/src/__tests__/*` | See §10.1 |
| `Docs/hmi_trend_viewer_spec.md` | See §8.5 |
| `Docs/hmi_trend_viewer_handoff.md` | See §8.5 |
| `Docs/hmi_trend_viewer_deltas.md` | Add entry on Step C landing |

External consumers of deleted `useLiveSubscription` API: `TrendChartContainer.tsx` (one call site each for `getBufferSnapshot`, `getCurrentGeneration`, `seedFromSpineFetch` via `useTrendData` parameter). Tests use the public API only. No external consumers outside `packages/trend-chart`.
