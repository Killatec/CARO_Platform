# CARO_HMI Trend Viewer — Live-Mode Cache & Merge Architecture (Design Doc)

**Status:** Proposed
**Author:** Live-mode refactor session, 2026-05-12
**Target reader:** Third-party reviewer who may not know the codebase deeply. Some sections reference the existing specs (`hmi_trend_viewer_spec.md` §10) for the canonical detail.

---

## 1. Purpose

The trend viewer's behavior at the boundary between *live mode* (real-time WebSocket-driven tail) and *fixed mode* (cached historical tiles) has been a source of subtle bugs and UX artifacts. This document:

1. Describes the **current architecture** (as of session-end commit `8f96435`) in enough detail for an outside reader to evaluate it.
2. Identifies the **specific gaps and failure modes** the current architecture exhibits.
3. Proposes a **new architecture** with a unified live/cache merge model and self-healing cache invalidation.
4. Documents the **trade-offs and alternatives considered**, so the reviewer can verify the proposal is the right design choice rather than just a reasonable one.

The proposal is non-trivial and warrants design review before implementation. If you only have time to read one section, read §4 (gaps) and §5 (proposed architecture).

---

## 2. Context

### 2.1 What the trend viewer does

The HMI trend viewer is a React-based client embedded in `apps/caro-hmi/` that displays time-series telemetry from industrial tags. Users select one or more tags (up to 8 per chart), pick a time range (via preset buttons like 1m/5m/1h/4h, or by drag-zooming, or by entering a specific end time), and see the data plotted via [uPlot](https://github.com/leeoniya/uPlot).

The trend viewer operates in two **modes**:

- **Live (tailing) mode:** the visible window's right edge tracks "now." Data flows from the server via a dedicated WebSocket trend channel (`SUBSCRIBE_TREND` / `UNSUBSCRIBE_TREND` / `TREND_DELTA`). The chart updates at ~4 Hz as new samples arrive.
- **Fixed mode:** the visible window is anchored to a specific time range. Data is fetched via REST tile requests (`GET /api/v1/trends/tile`) and served from a client-side LRU cache.

The server-side data model is a TimescaleDB hypertable (`tag_samples`) with three **continuous aggregate** (CAG) levels: 1s, 10s, 1min, 10min. CAGs materialize asynchronously — recently-written samples are not immediately visible in a CAG until materialization runs (typically ~10-30 s later, depending on configuration). Raw samples (sub-1s buckets) come directly from the hypertable without CAG materialization lag.

### 2.2 Why CAG materialization lag matters

When a tile request asks for a bucket size ≥ 1 s, the server picks an appropriate CAG and serves bucket-aggregated data. For buckets covering "very recent" times, **the CAG may not have materialized those rows yet** — the server returns those buckets as `null`. The actual samples exist in the raw hypertable, but the CAG-aggregated form does not.

Live mode bypasses this problem by using the WebSocket tail (which carries raw samples) to fill in the recent buckets that the spine fetch (CAG-based) missed. Fixed mode doesn't have a WebSocket tail, so it serves whatever the CAG returned — including the nulls.

### 2.3 Scope of this document

This doc covers the **client-side architecture** of:

- The live-mode WebSocket buffer (`useLiveSubscription`).
- The tile cache (`tileCache`, `useTrendData`).
- The merge function that combines them (`mergeTrendData`).
- The transition behavior between live and fixed modes.

It does **not** cover server-side concerns (the REST endpoint, the WS channel, CAG configuration), UI/UX concerns (preset buttons, end picker), or the chart rendering itself (uPlot integration, axis interactions). Those are documented in `hmi_trend_viewer_spec.md`.

---

## 3. Current Architecture

This section describes the architecture as it stands after the live-mode refactor session that concluded at commit `8f96435`. The earlier `hmi_trend_viewer_spec.md` §10 captures most of this, but for self-containment this doc repeats the salient parts and adds detail.

### 3.1 Key components

| Component | File | Role |
|---|---|---|
| `useTrendData` | `packages/trend-chart/src/useTrendData.ts` | Owns the tile cache and the active tile set. Returns `hookResult.data` (a `TrendData` object) plus methods for pan-extension (`ensureCovered`), eviction (`evictAll`, `evictRange`), and forced refetch (`refetchHistory`). |
| `useLiveSubscription` | `packages/trend-chart/src/useLiveSubscription.ts` | Manages the WebSocket subscription. Owns the FIFO buffer of recent samples per tag. Active only while `isTailing === true`. |
| `mergeTrendData` | `packages/trend-chart/src/mergeTrendData.ts` | Combines cached tile data with live-tail data at render time. Has aggregate-mode and raw-mode paths, each with a tailing-mode and fixed-mode branch. |
| `useZoomState` | `packages/trend-chart/src/useZoomState.ts` | Owns the `dataViewport` state. Computes a viewport for the data-fetch path that may differ from the user's intended view (`modeViewport`) due to drag-zoom snapping. Exposes `syncDataViewport` for forcing alignment with `modeViewport` on transitions. |
| `useTrendMode` | `packages/trend-chart/src/useTrendMode.ts` | Owns the mode state machine (tailing ↔ fixed) and `modeViewport`. Reducer handles `liveClicked`, `panApplied`, `zoomApplied`, `presetClicked`, `endPickerCommitted`, `tick`. |
| `TrendChartContainer` | `packages/trend-chart/src/TrendChartContainer.tsx` | Wires everything together. Owns `dispatchModeAction`, a synchronous wrapper around `dispatch` that handles transition cleanup (`commitAndDrain`, `syncDataViewport`, `refetchHistory`). |
| `tileCache` | `packages/trend-chart/src/tileCache.ts` | LRU cache keyed by `(tagId, startTime, endTime, bucketCount)`. ~50 MB capacity. |

### 3.2 Live mode (steady state)

When `isTailing === true`:

1. **Initial fetch (spine).** `useTrendData`'s main effect runs the **live-spine branch**. It constructs one tile spanning the full viewport with `bucketCount = visibleTilesPerWindow × bucketCount = 1000` (default) and fetches it via REST. The response is *not* written to the LRU cache; it is converted directly into a `TrendData` object via `assembleLiveSpine` and stored in `hookResult.data`. `activeTilesRef.current` remains empty.

2. **WS subscription.** `useLiveSubscription` issues `SUBSCRIBE_TREND` for all current `tagIds`. The server begins pushing `TREND_DELTA` frames at the configured `TREND_FLUSH_HZ` rate (default 4 Hz).

3. **Sample accumulation.** Each `TREND_DELTA` carries one or more samples per tag. The hook appends them to a per-tag FIFO buffer (`fifosRef`, capacity `TREND_FIFO_CAPACITY = 100` entries per tag).

4. **Bucket accumulation (aggregate mode).** When `bucketSMs ≥ 1.0` (i.e., when the viewport's bucket width crosses the 1-second threshold and the server is using a CAG), `useLiveSubscription` runs a bucket accumulator over the FIFO. The accumulator closes a bucket whenever `moduleTs` crosses a `bucketSMs` boundary and emits `{ ts, value, min, max, null_count }` matching the server's three-case rule.

5. **Raw accumulation (raw mode).** When `bucketSMs < 1.0`, there's no bucketing — raw samples flow into a per-tag raw buffer (`rawBuffersRef`), bounded by `2 × viewportSpanMs` of wall-clock coverage.

6. **Single-fetch guarantee.** After the initial spine fetch, no further fetches occur. Three refs gate the live branch:
   - `spineLoadedRef` — set true after spine settles.
   - `spineFetchInFlightRef` — set true while a spine fetch is in flight.
   - `isTailingRef` — read inside the main effect to decide which branch to take. `isTailing` is *not* in the effect's dep array; the effect fires only when `dataViewport` actually changes.

   Together these ensure exactly one spine fetch per fixed→live transition, even under React StrictMode and the ~4 Hz `nowMs` cadence (see §3.5).

7. **Render-time merge.** `TrendChartContainer` calls `mergeTrendData(hookResult.data, liveTail, isTailing=true)` on every render. The merge produces the combined output that `TrendChart` displays.

#### 3.2.1 What `mergeTrendData` does in tailing mode

For aggregate mode:

- `cached` (spine) has range `[Cs, Ce]` with `Ce ≈ click-time`. The most recent buckets near `Ce` may be `null` due to CAG materialization lag.
- `live` (the accumulator's output) has range `[Le, Le_max]` where `Le ≈ Ce` and `Le_max ≈ now` (current sample time).
- The merge **clips cached at `liveEndIndex`** (the bucket index where live's coverage begins). For bucket indices `< liveEndIndex`, use `cached`. For indices `≥ liveEndIndex`, use `live`.

This produces a continuous time-series from the spine's start up to the latest live sample. CAG-lag nulls at the spine's right edge are overwritten by live data.

For raw mode, the analog: drop cached entries with `ts ≥ minLiveTs` (the earliest live sample's timestamp), then prepend live entries. The merge function has separate code paths for aggregate vs. raw and for tailing vs. fixed mode.

### 3.3 Live → Fixed transition

The user can trigger this transition by:

- Panning (drag in the X-axis hit zone). `panApplied` is dispatched.
- Drag-zooming (selection rectangle on the chart). `zoomApplied` is dispatched.
- Committing an end time in the End Picker. `endPickerCommitted` is dispatched.
- Clicking a preset that lands the viewport off the live edge. `presetClicked` is dispatched.

`TrendChartContainer.dispatchModeAction` is the synchronous wrapper that intercepts these dispatches. When it detects a `tailing → fixed` transition, it runs three steps **before** calling `dispatch(action)`:

1. **`liveSubRef.current?.commitAndDrain()`** — issues `UNSUBSCRIBE_TREND`, flushes the WebSocket subscription, and clears `fifosRef` and `rawBuffersRef`. Returns the live tail's range as `{ start, end }`.
2. **`syncDataViewport(modeToViewport(next))`** — forces `dataViewport` to the post-transition `modeViewport`. This bypasses `useZoomState`'s reset effect (which would otherwise skip on `lastIntent === 'pan'`).
3. **`trendDataRef.current.refetchHistory()`** — bumps an internal version state in `useTrendData` that forces the main effect to re-run. The effect reads `isTailingRef.current` (now `false`) and takes the **history branch** with an asymmetric overfetch: `overfetchRightCount: 0`. The result is 2 visible + 1 left prefetch = 3 tiles fetched from the server.

The 3 tiles are stored in the LRU cache. `activeTilesRef` becomes populated. `hookResult.data` is replaced by the assembled `TrendData` from cache.

**Critically:** at this point, `useLiveSubscription` has cleared its FIFO. The live-tail data that was in the WebSocket buffer is **discarded**.

### 3.4 Fixed mode (after transition)

- `mergeTrendData(cached, liveTail=null, isTailing=false)` returns `cached` unchanged (the fixed-mode branch is essentially a passthrough when `liveTail` is null).
- Pan within fixed mode triggers `onXMove` → `checkAndExtendXCoverage` → `ensureCovered`. The threshold check reads cached extent via `getActiveRange()` (tile bounds, not `u.data[0]`). When the threshold is crossed, `ensureCovered` fetches one more tile in the pan direction.
- Drag-zoom or preset clicks while in fixed mode update `modeViewport`. `useZoomState`'s reset effect (or `handleDragZoom`/`handleZoomLevelSwitch`) updates `dataViewport`. The main effect re-runs the history branch with normal symmetric overfetch.

### 3.5 The ~4 Hz `modeState.nowMs` cadence

During live mode, `useTrendMode`'s reducer state contains `nowMs`. This is updated by a `tick` action that fires on every `TREND_DELTA` frame received (~4 Hz, gated by `modeStateRef.current.mode === 'tailing'`). Each tick causes `modeViewport` to recompute, which propagates through `useZoomState` → `dataViewport` → `useTrendData`'s main effect.

The main effect's skip guard (`spineLoadedRef.current && !spanChanged && spineFetchInFlightRef.current === false` returns early) prevents this from triggering refetches. But the *effect itself* runs on every tick, and so do several downstream effects in `TrendChart` (range update, redraw). This is functional but inefficient and is logged in `hmi_trend_viewer_handoff.md` §11.A as a known issue.

---

## 4. Known Gaps

### 4.1 Gap A: CAG-lag null gap on live → fixed transition (visible, transient)

**Symptom.** Right after a `tailing → fixed` transition, the chart's right edge shows a `null` band for ~10-30 s. The exact width depends on CAG materialization timing. After ~30 s the CAG catches up — but the user has to interact (pan/zoom) to trigger a re-fetch that captures the now-materialized data.

**Cause.** `commitAndDrain` discards the live-tail FIFO. The subsequent `refetchHistory` fetches tiles from the server, which serves CAG-aggregated data. The recent buckets that the WebSocket tail was filling are *not* in the CAG yet, so the new tile responses have nulls there.

**Documented in:** `hmi_trend_viewer_handoff.md` §11.B.

### 4.2 Gap B: Stale cached nulls persist after CAG catches up (worse than visible)

**Symptom.** Once a tile is cached with CAG-lag nulls, those nulls are **frozen** in the cache. The cache never refreshes itself. If the user pans into that range later (after the CAG has materialized the underlying samples), the cached tile is served from cache — *with the nulls still in it*. The user sees missing data for buckets that the server would now return correctly if asked.

**Cause.** The tile cache is **write-once, never-refresh** (entries are only removed via LRU eviction). The cache cannot distinguish "this response is final" from "this response had CAG-lag at fetch time and might be incomplete."

**Currently observable when:** the user transitions live → fixed, then pans back into the original viewport range. The chart shows the nulls that were cached at transition time, even though those nulls are now stale.

**Not currently documented** because the original UX (no live data at all post-transition) obscured this — the gap was always visible, masking the cache-staleness aspect.

### 4.3 Gap C: Mode-divergent merge logic creates maintenance friction

**Symptom.** `mergeTrendData` has separate aggregate/raw branches, each with separate tailing-mode and fixed-mode logic, totaling four code paths plus shared edge-case handling. The clip-at-`liveEndIndex` logic exists specifically to defend against LOCF-gapfill leak from after-prefetch tiles — a concern that no longer applies (live mode bypasses the cache and never has after-prefetch tiles).

**Cause.** Historical accretion. The merge logic was designed when live mode used the cache. The current architecture changed that, but the merge function's defensive code was left in place.

### 4.4 Gap D: `pruneAndAdd` flat-line race after drag-zoom-then-pan (intermittent)

**Symptom.** After drag-zooming to a non-preset span and then panning, some regions that previously rendered real data show flat lines instead. Intermittent and timing-dependent.

**Likely cause.** When `pruneAndAdd` inserts a tile from a pan-extension fetch, it may replace an existing tile whose `bucketSMs` doesn't match the new tile's. The replacement tile's data may have sparse or null values for the overlap region, and the chart's assembled output shows the new (incomplete) data over what was previously real.

**Documented in:** `hmi_trend_viewer_handoff.md` §11.C.

**Status:** out of scope for this proposal. Mentioned because the proposed architecture (§5) partially masks its visible impact by overlaying live data when available.

---

## 5. Proposed Architecture

### 5.1 Design principles

1. **The cache is server-derived data.** Server response goes in; nothing else.
2. **The live buffer is the source of truth for recent samples.** While alive, it always wins over cache for overlapping ranges.
3. **The merge function has one rule, not four.** Mode and source type are irrelevant to merge semantics.
4. **The cache self-heals.** When the live buffer can no longer overlay a region, the cache for that region is invalidated, forcing a fresh fetch that captures the now-materialized CAG data.

### 5.2 The unified merge rule

Replace `mergeTrendData`'s mode-branched logic with one rule:

> For each timestamp in the union of `cached`'s and `liveTail`'s coverage:
> - If the timestamp is within `liveTail`'s coverage range, use `liveTail`'s
>   value — null included. Live's null is information (watchdog timeout or
>   spec §6.5 mixed-null bucket); it must not be overridden by cache.
> - Otherwise use `cached`'s value.
>
> Coverage is defined per mode:
> - Aggregate: live's coverage = [liveStartBucketTs, liveEndBucketTs]. Within
>   those bucket indices, live owns value, min, max.
> - Raw: live's coverage = [minLiveTs, maxLiveTs]. Cached entries with
>   ts ≥ minLiveTs are dropped; live's discrete entries are the source.

**Why coverage-based live-wins rather than value-based.** A cached non-null value is not necessarily the materialized CAG aggregate — it can be a LOCF'd last from spec §6.5's empty-bucket case, which represents stale carry-forward, not canonical truth. A live null is not "missing data" but a watchdog timeout or three-case mixed-null bucket — semantically meaningful. The only safe discriminant is whether the timestamp falls in live's coverage range; within that range, live owns the rendering. Outside it, cache is the only source available.

This rule handles every existing scenario:

| Scenario | Cache state | Live state | Output |
|---|---|---|---|
| Live mode steady state | Spine has CAG-lag nulls at right edge | Tail has data | Live wins on coverage range; tail extends past spine |
| Just-transitioned fixed | New tiles have CAG-lag nulls at right edge | Tail still has data (see §5.3) | Live wins on coverage range |
| Pan within fixed, CAG caught up | New tile has real data | Tail dormant or aged out | Cache wins — live coverage has aged out, cache is only source |
| Pure history view | All real data | No tail | Cache wins trivially |

### 5.3 Ring buffer with `moduleTs`-based retention

Rename `fifosRef` → `ringsRef` and `TREND_FIFO_CAPACITY` → `TREND_RING_CAPACITY`. The data structure is semantically a ring buffer (bounded capacity with drop-oldest-on-overflow ordering), not just a FIFO.

**Sizing:** `TREND_RING_CAPACITY = 300` per tag. Rationale: at 4 Hz WS flush rate × 60 s retention target × 1.25 safety margin = 300. This exceeds the CAG materialization lag (worst-case ~30-45 s for the 1-second CAG; longer CAGs aren't used in live mode because live mode requires sub-second `bucketSMs`).

**Lifecycle:** the ring is **not** cleared on `tailing → fixed` transition. `commitAndDrain` is renamed to `commitAndPause`:

- Issues `UNSUBSCRIBE_TREND`.
- Does **not** clear `ringsRef`.
- Does **not** start a timer.

The ring buffer continues to exist. Its entries age out naturally as new entries push the oldest out — but no new entries push, because the subscription is paused. So during paused mode, the ring is frozen at its pre-pause state.

**Eviction policy:** on every WS push, after appending new entries, prune the front of each tag's ring while `entries[0].moduleTs < newestEntry.moduleTs - retentionWindow`. The reference is `newestEntry.moduleTs` (most recent sample's moduleTs), not `Date.now()` — keeping the comparison purely in module-clock space (no client-clock dependency).

If the ring exceeds `TREND_RING_CAPACITY` even after the time-based prune (because the COV rate exceeded the assumption), additionally drop the oldest entries until the count fits. This belt-and-suspenders bound prevents pathological cases from growing the ring unbounded.

**Re-entry to live mode:** if the user clicks Live again before the ring has fully aged out, the subscription resumes and new entries push in. Old entries that are still within retention coexist with new ones. No special "is this stale data?" logic — the retention prune handles it on the next push.

### 5.4 Cache invalidation on ring eviction

Each ring eviction fires a callback that invalidates the corresponding cache tile entries. The callback receives the evicted entry's `moduleTs`. The cache exposes an `invalidateOverlapping(moduleTs)` method that finds tile keys whose `[startTime, endTime]` contains the timestamp and deletes those entries.

**Why this works (and is necessary):**

- **Necessary:** without invalidation, the cache stores CAG-lag nulls forever. When the live overlay fades away, the user sees those nulls (Gap B from §4.2).
- **Works because the retention window is sized > CAG-lag.** By the time a ring entry is evicted (`now - moduleTs > retentionWindow`), the CAG has materialized that bucket. Invalidation triggers a fresh fetch on next read, which returns clean data.

**Batching:** at high WS push rates, many ring entries can evict in one tick, all hitting the same tile. The eviction handler batches: collect the set of tile keys to invalidate within a single `requestAnimationFrame` (or simply within one WS push's processing), then invalidate each tile key at most once.

### 5.5 Container plumbing

`TrendChartContainer`:

- Always pass `liveTail` (the ring snapshot) to `mergeTrendData`. It's `null` if the ring is empty.
- No more `isTailing` parameter to merge. Merge is mode-agnostic.
- The `dispatchModeAction` block for `tailing → fixed` simplifies:

  ```ts
  if (cur.mode === 'tailing' && next.mode === 'fixed') {
    liveSubRef.current?.commitAndPause();
    // syncDataViewport and refetchHistory still needed for the
    // same reasons (lastIntent='pan' skip; refetch trigger).
    syncDataViewport(modeToViewport(next));
    trendDataRef.current.refetchHistory();
  }
  ```

- Revert asymmetric overfetch in `refetchHistory`'s consumption. Use the same `overfetchPerSide = 1` as ordinary history fetches. The merge handles the right-edge gap regardless of how many tiles are fetched.

### 5.6 Bucket-size mismatches (drag-zoom-during-live edge case)

If the user drag-zooms during live mode, the new viewport has a different `bucketSMs` than the live accumulator's. The ring buffer holds *raw samples* with `moduleTs` timestamps — those are clock-aligned and can be re-bucketed at merge time to any `bucketSMs`.

Extract the bucket-closing logic from `useLiveSubscription` into a pure helper:

```ts
function closeBucketsFromRing(
  entries: { moduleTs: bigint; value: number | null }[],
  bucketSMs: number,
  rangeStart: bigint,
  rangeEnd: bigint,
): { ts: bigint[]; value: (number|null)[]; min: (number|null)[]; max: (number|null)[]; nullCount: number[] }
```

The merge function calls this against the *cached data's* `bucketSMs` regardless of what was used during live. Live's own bucket accumulator (the existing `accumulatorsRef`) can be retired in favor of always re-bucketing from the raw ring at merge time. (Alternative: keep `accumulatorsRef` for live mode's hot path performance, and only re-bucket when bucketSMs differs. Pick based on render-time profiling.)

### 5.7 Performance mitigations

The two practical concerns about the proposed architecture are CPU cost (merge runs on every render) and network cost (re-fetches triggered by cache invalidations). Both are mitigated with mechanical changes that don't alter the architectural model.

#### 5.7.1 CPU: avoiding unnecessary merge work

**Fast-path on empty/null ring.** When the ring snapshot is `null` or empty, `mergeTrendData` returns `cached` unchanged without entering the merge body. This is the steady-state during fixed mode after the ring has fully aged out — likely the dominant case across user sessions. Cost: a single null/length check per render.

**Memoize the merge result.** Wrap the `mergeTrendData` call in a `useMemo` keyed on `(cachedRef, liveTailRef)` so the merge only re-runs when one of the references actually changes:

```ts
const mergedData = useMemo(
  () => mergeTrendData(cached, liveTail),
  [cached, liveTail],
);
```

This insulates the merge from renders triggered by unrelated state (cursor moves, legend hover, mode-state ticks that don't change `cached` or `liveTail`).

**Stable ring snapshot reference.** `useLiveSubscription` must expose the ring as a snapshot whose identity changes only when the ring contents change — not on every render. Today's `useRef` doesn't trigger re-renders; a coarse-grained `useState` whose setter is called on each push and each prune batch produces a stable snapshot reference between mutations. The snapshot itself is a shallow projection of `ringsRef` (per-tag arrays of entries) constructed once per mutation, not per render.

**Bound the ring iteration.** Worst-case ring size is `8 tags × 300 entries = 2400` entries. Walking this list to produce per-tag bucket-closed output is ~10k operations. Even at 4 Hz live-mode push frequency, total CPU is well under 1 ms/sec — small enough that finer optimization isn't warranted unless profiling proves otherwise.

**Decision deferred to profiling.** Whether to retire `accumulatorsRef` (the live-mode bucket accumulator) or keep it as a hot-path optimization is left as an open question (§9, item 2). The closure-from-ring helper can produce the same output; the question is whether re-bucketing at every merge is fast enough or whether maintaining a parallel pre-bucketed structure pays off.

#### 5.7.2 Network: avoiding unnecessary re-fetches

**The actual scope of re-fetch cost is smaller than it first appears.** Cache invalidation fires when ring entries age out. Ring entries only age out when new entries are pushed (prune-on-push). New pushes only happen during live mode. So:

- During **live mode**: invalidations fire, but the cache isn't being read (live bypasses cache). Invalidations just shrink the cache; no fetches fire.
- During **fixed mode**: no new pushes, no aging, no invalidations.

The re-fetch is deferred — it only fires when the user pans (in fixed mode) into a range whose tile was previously invalidated. At that point, the fetch returns the now-materialized CAG data (which is what we want). The wire cost is the same as any cache miss — same fetch the user would have triggered by panning into uncached range.

The actual waste: if the user re-views a previously-cached range *within the same session* whose tile was invalidated during a transient live session, they pay for a re-fetch where a cache hit would have served the (now-correct) data. Bounded by the count of stale-suspect tiles, which is small.

**Mitigation A — `hadNullsAtFetch` flag.** When `storeTileResult` writes a tile to cache, also store whether the response had any `null` bucket values:

```ts
const hadNullsAtFetch =
  response.source !== 'raw' && response.series.some(s => s.value.includes(null));
```

The invalidation handler skips tiles where this is `false` — they were fully-materialized at fetch time and need no refresh. This eliminates the bulk of unnecessary re-fetches: ordinary history fetches well after data has materialized never invalidate.

**Mitigation B — batched invalidations.** Multiple ring entries within one WS push that fall in the same tile produce one invalidation, not many. Implement as a `Set<TileKey>` collected during prune-batch processing, drained once at the end of the WS-push handler. Cuts the worst-case invalidation rate from ~32/sec down to a few/sec.

**Mitigation C — per-bucket null tracking (deferred).** A more precise version of Mitigation A: store per-bucket null state in the cache entry, and only invalidate when the evicting entry's `moduleTs` actually falls in a null region. More book-keeping; not implemented unless Mitigation A proves insufficient.

**Mitigation D — stale-while-revalidate (deferred).** Instead of deleting on invalidation, mark stale; the next read returns the stale value immediately *and* triggers a background re-fetch. Eliminates the visible cache-miss latency. More complex; deferred until measured need.

**Mitigation set for shipping:** A + B. ~20 lines of code total. C and D are escalation paths.

---

### 5.8 What gets removed

The proposal allows removing:

- `overfetchLeftCount` / `overfetchRightCount` parameters from `tilesForViewport`. Revert to symmetric `overfetchPerSide`.
- `liveExitRefetchPendingRef` in `useTrendData`. No longer needed; symmetric overfetch is fine.
- The `isTailing` parameter from `mergeTrendData`'s signature. The clip-at-`liveEndIndex` logic is **not** removed — it is the rule under the new architecture, applied unconditionally whenever the ring is non-empty rather than gated on `isTailing`.
- The aggregate-vs-raw mode branching that exists today as four separate code paths. Replaced by one unified rule (clip-at-liveEndIndex for aggregate, drop-cached-≥-minLiveTs for raw), applied whenever the ring is non-empty rather than gated on isTailing.

---

## 6. Trade-offs and Alternatives Considered

### 6.1 Alternative 1: Periodic re-fetch of recent tiles (lighter touch)

**Description.** After a `tailing → fixed` transition, set a 5-second timer that re-fetches the rightmost visible tile. Stop after 30 s or when the response no longer has nulls.

**Pros.**
- ~30 lines of new code.
- No changes to `useLiveSubscription`, `mergeTrendData`, or cache semantics.
- Localized to `TrendChartContainer`.

**Cons.**
- Visible "data appearing" effect — there's a perceivable delay (5 s per poll cycle) before the gap fills.
- 6+ extra server fetches per transition for a feature most users won't notice. Doesn't scale gracefully (every chart on every operator's screen).
- Doesn't fix Gap B (stale cached nulls past the transition) — only fixes the immediate post-transition gap.
- Doesn't unify the merge logic (Gap C remains).

**Why not chosen.** UX is "imperfect-then-becomes-perfect" instead of "instantly perfect." Doesn't address the deeper cache-staleness issue (Gap B).

### 6.2 Alternative 2: Patch the cache at write time (forfeit cache purity)

**Description.** When `storeTileResult` writes a server response to the cache, also overlay any FIFO/ring data from `pendingLiveTailRef` for buckets within the live-tail's range.

**Pros.**
- Cache is "complete" once written. No render-time merge cost.
- No render-time consumer needs to know about the live tail.

**Cons.**
- Cache no longer represents pure server data. A tile's contents depend on what was in the FIFO at the moment of write, which makes the cache contents non-deterministic from a given fetch perspective.
- Two patching mechanisms exist (during live: render-time merge; at transition: write-time patch) — code duplication and semantic drift risk.
- Cache invalidation logic for `pendingLiveTailRef` aging out is more complex (would need to either re-fetch and re-patch, or leave the patched-but-now-stale data in cache).

**Why not chosen.** The "two mechanisms, one for live and one for transition" model is exactly the duplication this proposal eliminates. The render-time-merge-only model is one mechanism applied uniformly.

### 6.3 Alternative 3: Render-time merge with wall-clock TTL

**Description.** Keep `pendingLiveTailRef` alive for a fixed wall-clock duration (e.g., 60 s) after `tailing → fixed`. Start a `setTimeout`, clear the ref when it fires. Render-time merge uses the ref while it's alive.

**Pros.**
- Conceptually simple.

**Cons.**
- Wall-clock TTL is the wrong measure. The relevant question is "is this sample older than the CAG-lag?", which is a module-clock question, not a wall-clock one. Clock skew between client and device could make a TTL fire early or late relative to actual CAG materialization.
- Lifecycle invariants: timer must be cancelled on re-entry to live, on tab close, on page navigation. Easy to get wrong.
- Doesn't solve Gap B — cache still has stale nulls after the TTL fires.

**Why not chosen.** `moduleTs`-based retention is strictly cleaner and clock-skew-immune (§5.3 vs this alternative). And Gap B requires invalidation, which TTL alone doesn't provide.

### 6.4 Why the proposed architecture is the right choice

The proposal **collapses two distinct mechanisms (live merge, cache eviction policy) into one coordinated system.** The same ring buffer that fills cache nulls at render time is also responsible for invalidating those cache slots when it ages out. There's no second mechanism, no separate TTL, no duplicate logic.

The mental model becomes: **"the cache eventually contains only fully-materialized CAG data; the ring temporarily covers the gap; the gap closes by itself."** The ring covers the gap via live-wins-on-coverage: wherever the ring has coverage, live's value (null or non-null) overrides cached data. When the ring ages out and releases its coverage, cache invalidation ensures that any tiles which held CAG-lag nulls at fetch time are evicted and re-fetched — returning the now-materialized CAG data rather than stale carry-forward.

---

## 7. Implementation Plan

The implementation is structured as **five phases**, each independently shippable, each with its own verification gate. Phases can be committed and reviewed separately. Earlier phases lay groundwork without changing behavior; later phases activate the new merge model.

### 7.1 Phased rollout

#### Phase 1 — Foundation: helpers and refs (no behavior change)

Lay the groundwork for later phases. No user-visible change after this phase.

**Changes:**
- Rename `fifosRef` → `ringsRef`. Rename `TREND_FIFO_CAPACITY` → `TREND_RING_CAPACITY`. Keep value at 100 for now (raised in Phase 3).
- Extract `closeBucketsFromRing(entries, bucketSMs, rangeStart, rangeEnd)` as a pure helper in a new file `packages/trend-chart/src/closeBucketsFromRing.ts`. Move the bucket-closing logic from `useLiveSubscription`'s accumulator into this helper. The accumulator continues to use it; no other consumers yet.
- Add `hadNullsAtFetch: boolean` to the cache entry shape (`CachedEntry` in `useTrendData.ts`). Compute it in `storeTileResult`. Don't consume it yet; just store it.

**Verification gate:**
- `tsc --noEmit` clean.
- All 569 existing tests still pass.
- No new tests required (pure refactor; behavior unchanged).

**Commit:** `refactor(trend-chart): rename FIFO→ring; extract bucket-close helper; add hadNullsAtFetch`

#### Phase 2 — Unified `mergeTrendData` rule (live mode unchanged externally)

Replace the mode-branched merge logic with the unified rule. Live mode's render output should be identical (the new rule produces the same result as the old `isTailing=true` path for the same inputs).

**Changes:**
- Rewrite `mergeTrendData` to the single rule: prefer non-null cache; live fills nulls and extends past cache.
- Drop the `isTailing` parameter from the signature. Update all call sites (`TrendChartContainer`).
- For the aggregate path, re-bucket the ring's raw entries at `cached.bucketSMs` via `closeBucketsFromRing` when `cached.bucketSMs !== liveBucketSMs`.
- Add the fast-path: if `liveTail === null` or empty, return `cached` unchanged.

**Verification gate:**
- `tsc --noEmit` clean.
- All existing `mergeTrendData` tests updated to the unified rule. Many will simplify (no `isTailing` parameter; expected output identical).
- Add ~6 new tests exercising: cross-bucketSMs re-bucketing; the fast-path; the cache-wins-over-live-on-overlap rule (different from old behavior where live always won).
- Manual smoke test in HMI: live mode renders correctly; live → fixed transition still shows the CAG-lag gap (Phase 3 will fix this).

**Commit:** `refactor(trend-chart): unified mergeTrendData rule; drop isTailing parameter`

**Risk note for this phase:** The unified rule preserves today's tailing-mode merge semantics (live wins on coverage) and extends them to fixed mode whenever the ring is non-empty. No behavior change in live mode; new behavior in the post-transition window is that live continues to overlay until the ring ages out, instead of being discarded immediately.

#### Phase 3 — Ring buffer lifecycle + cache invalidation (the core change)

Activate the new lifecycle: ring survives transitions, cache invalidates on ring eviction. This is the phase where the visible UX improvement lands.

**Changes:**
- Raise `TREND_RING_CAPACITY` from 100 to 300.
- Add `moduleTs`-based pruning to `useLiveSubscription`'s push handler. Maintain dual bounds (count + time).
- Rename `commitAndDrain` → `commitAndPause`. Remove the FIFO clear. Keep the `UNSUBSCRIBE_TREND` and the range-return (for now — the return is no longer consumed but kept for backward compat in case of test fallout).
- Expose the ring as a stable snapshot from `useLiveSubscription` (coarse-grained state setter on push and prune; snapshot is a per-tag array projection rebuilt only on mutation).
- Add `invalidateOverlapping(moduleTs)` method on the cache (`tileCache` or its consumer `useTrendData`). For each tile key whose range contains the timestamp AND whose `hadNullsAtFetch === true`, delete the entry.
- Wire the invalidation: `useLiveSubscription` accepts a callback in options; calls it batched per WS push with the set of `moduleTs` values evicted.
- `TrendChartContainer`: wire the callback from `useLiveSubscription` to `useTrendData`'s cache-invalidation method. Always pass `liveTail` (the ring snapshot) to `mergeTrendData`.
- Add the `useMemo` wrapper around `mergeTrendData` in `TrendChartContainer`, keyed on `(cached, liveTail)`.

**Verification gate:**
- `tsc --noEmit` clean.
- All existing tests pass with minor updates (the live-mode skip-guard tests may need updating to reflect the new lifecycle).
- Add ~8 new tests:
  - Ring survives `commitAndPause` (entries remain).
  - Ring entries age out by `moduleTs` on push.
  - Cache invalidation fires when ring evicts.
  - Cache invalidation skips tiles where `hadNullsAtFetch === false`.
  - Batched invalidation: multiple evictions in one push hit the same tile once.
  - Stable ring snapshot reference between pushes (memo holds).
  - `useMemo` re-runs when ring contents change.
  - `useMemo` skips when ring contents unchanged.
- Manual smoke test in HMI: live → fixed transition shows continuous data (no CAG-lag gap). Pan within retention window: overlay still works. Wait > retention window in fixed mode, pan back into original range: cache fetches fresh data (verify in DevTools Network).

**Commit:** `feat(trend-chart): ring buffer survives mode transitions; cache self-heals via invalidation`

#### Phase 4 — Revert asymmetric overfetch and live-exit special-cases

Clean up the live-exit-specific machinery now that the unified merge handles the transition correctly.

**Changes:**
- Remove `overfetchLeftCount` / `overfetchRightCount` from `tilesForViewport`'s signature. Revert to a single `overfetchPerSide`. The single `tilesForViewport` test for asymmetric overfetch becomes obsolete; remove it.
- Remove `liveExitRefetchPendingRef` from `useTrendData`. The `refetchHistory` callback still bumps the version state, but no longer flips a flag for asymmetric overfetch.
- The `refetchHistory` history fetch now uses default symmetric `overfetchPerSide = 1`. Result: 4-tile fetch on live exit (was 3 with asymmetric).

**Verification gate:**
- `tsc --noEmit` clean.
- Update tests asserting on asymmetric overfetch tile count (3 → 4).
- Manual smoke test: live → fixed transition still shows continuous data (merge fills the right edge regardless of how many tiles are fetched).

**Commit:** `refactor(trend-chart): revert asymmetric overfetch; merge handles right-edge gap`

#### Phase 5 — Documentation and known-issues update

Final pass.

**Changes:**
- Update `Docs/hmi_trend_viewer_spec.md` §10.6 to reflect the new architecture. Move the obsolete `commitAndDrain` + `evictRange` description to a Revision History note.
- Update `Docs/hmi_trend_viewer_handoff.md` §11 Known Issues: remove §11.B (CAG-lag gap, now fixed) and §11.C may also be partially mitigated (note the partial mitigation in the existing entry).
- Move this design doc (`hmi_trends_live_cache_design.md`) to a `Docs/archive/` folder or rename to indicate it's now "as-built." (Bikeshed at commit time.)

**Verification gate:**
- Spec and handoff documents reflect implementation. No code changes; no test changes.

**Commit:** `docs(trend-chart): propagate live-cache merge architecture to spec and handoff`

### 7.2 File-by-file summary

| File | Phase | Net change |
|---|---|---|
| `packages/trend-chart/src/useLiveSubscription.ts` | 1, 3 | +30 lines (rename + push pruning + invalidation callback) |
| `packages/trend-chart/src/mergeTrendData.ts` | 2 | −50 lines (unified rule replaces four branches) |
| `packages/trend-chart/src/closeBucketsFromRing.ts` | 1 (new file) | +30 lines |
| `packages/trend-chart/src/useTrendData.ts` | 1, 3, 4 | +10 lines (hadNullsAtFetch + invalidateOverlapping; revert liveExitRefetchPendingRef) |
| `packages/trend-chart/src/tileCache.ts` | 3 | +15 lines (invalidateOverlapping method) |
| `packages/trend-chart/src/level.ts` | 4 | −20 lines (revert asymmetric overfetch params) |
| `packages/trend-chart/src/TrendChartContainer.tsx` | 2, 3 | +5 lines (always-pass liveTail; useMemo wrapper; invalidation wiring) |
| Tests across the package | 1, 2, 3, 4 | +80 lines new tests, −30 lines obsolete ones |
| **Total** | | **~+70 lines code, +50 lines tests** |

Earlier estimates suggested net negative line count; revised after accounting for the mitigation infrastructure (useMemo wrapper, snapshot setter, batched invalidation). Still small in absolute terms; the architectural simplification is in *number of code paths*, not *line count*.

### 7.3 Test strategy

Unit tests cover each component in isolation:
- `mergeTrendData` — input/output pairs for every combination of cache state × live state. ~20 tests.
- `closeBucketsFromRing` — entries × `bucketSMs` → bucketed output. ~6 tests.
- `useLiveSubscription` ring lifecycle — push, prune by count, prune by moduleTs, snapshot stability. ~8 tests.
- Cache invalidation — `invalidateOverlapping` with various tile/timestamp combinations. ~5 tests.

Integration tests cover end-to-end flows:
- **Live entry → transition → fixed pan** (the gap-fix path). Assert continuous data through transition; assert cache contents after retention window expires.
- **Live → fixed → re-Live within retention window** (continuity of ring). Assert ring entries from prior live session are still present.
- **Live → fixed → re-Live after retention window** (cold start path). Assert ring is empty and spine re-fetches.
- **Drag-zoom during live → fixed** (bucketSMs change). Assert merge re-buckets correctly.

Smoke tests in the HMI (manual or automated browser test):
- Each transition path produces visually continuous data.
- Network panel shows expected fetch count per transition.
- Console has no warnings related to the merge or invalidation.

### 7.4 Verification gates between phases

Each phase has an explicit verification checklist before merging the next phase. Phases 1, 2, 4 are pure refactor (behavior preserved); Phase 3 is the user-visible behavior change.

After Phase 3, run the **full HMI manual test pass** (the same set of preset clicks, pans, zooms, and transitions that the live-mode refactor session ran against). This phase is the highest risk; if any visible regression is observed, halt rollout and triage before Phase 4.

### 7.5 Rollback strategy

Each phase is a separate commit on a feature branch. If Phase 3 introduces a regression, revert that single commit; Phases 1, 2, 4 stand independently and don't depend on each other beyond the helper extractions.

The pre-Phase-3 state (after Phase 2) is a usable intermediate: unified merge rule, asymmetric overfetch still in place, ring still cleared on transition. The CAG-lag gap still exists at that point, but no regressions.

### 7.6 Migration / external API impact

This change is internal to `packages/trend-chart/` and has **no public API impact**. Existing consumers (`apps/caro-hmi/`) need no changes. The `useTrendData` and `useLiveSubscription` hooks retain their external signatures (modulo the `commitAndDrain` → `commitAndPause` rename, which is a one-line update at each call site, all of which are inside this package).

The cache's internal interface gains `invalidateOverlapping(moduleTs)`. No external consumer uses the cache directly.

---

## 8. Risks and Open Questions

### 8.1 Pathological COV rate

If a tag's change-of-value rate exceeds 4 Hz sustained (e.g., a rapidly oscillating analog signal), the ring buffer's count-based bound (300 entries) may fall short of the time-based retention target. The ring would hold only the most recent ~10 s of data for that tag instead of the desired 60 s.

**Impact.** For that tag, the merge overlay window is shorter. Cache invalidation still works (driven by entry eviction), but the overlay coverage is reduced.

**Mitigation.** Sizing the count-based bound generously (300 is comfortable for typical signals). If a pathological signal is observed in production, either:
- Increase `TREND_RING_CAPACITY`.
- Or implement a per-tag dynamic ring size based on observed push rate.

### 8.2 Cache invalidation cost

At 4 Hz × 8 tags worst-case, ~32 ring entries can age out per second. Each could potentially trigger cache invalidation.

**Mitigated** by §5.7.2 mitigations A and B: invalidations are batched per WS push (Mitigation B), and skip tiles where `hadNullsAtFetch === false` (Mitigation A). Net invalidation rate in practice: a few/sec at most, mostly affecting tiles that genuinely had CAG-lag nulls and benefit from refresh.

The re-fetch cost itself is deferred: invalidation happens during live mode (when the cache isn't being read), so it just shrinks the cache. The actual re-fetch fires only when the user pans into the affected range later. That fetch is the same wire cost as any cache miss and returns clean CAG data.

**Residual concern:** if a user re-views a previously-cached range *within the same session* after a live-mode transient, they pay a re-fetch where a cache hit could have served the (now-correct) data. Bounded by stale-suspect tile count, which is small. Acceptable.

**Escalation:** if measurable bandwidth waste appears in profiling, escalate to Mitigation C (per-bucket null tracking) or Mitigation D (stale-while-revalidate). Neither is implemented for the initial rollout.

### 8.3 Ring buffer iteration during render

The merge function iterates the ring buffer per render. For ~300 entries × 8 tags = 2400 iterations per render. With React's 60 fps target and ~16 ms budget, this is well under 1 ms of CPU.

**Mitigated** by §5.7.1 mitigations: fast-path on empty ring (free in fixed-mode steady state), `useMemo` keyed on `(cached, liveTail)` (merge only re-runs when references change), stable ring snapshot identity (snapshot ref changes only when ring mutates). Combined effect: merge runs at most ~4 Hz during live mode (the WS push rate) and effectively never in fixed-mode steady state.

**Residual concern:** the bucket-close helper does per-entry work during aggregate re-bucketing. If `cached.bucketSMs !== liveBucketSMs` on every merge, the helper runs every time. For typical sessions (user holds a viewport, bucketSMs is stable), this is rare. The drag-zoom-during-live case is the only common path that triggers cross-bucketSMs re-bucketing.

**Open question (§9 item 2):** retire `accumulatorsRef` entirely (re-bucket from raw ring on every merge), or keep it as a hot-path optimization for same-`bucketSMs` merges? Settled by profiling at Phase 3.

### 8.4 Edge case: WS reconnect during paused mode

If the WS disconnects during paused mode (live exit) and reconnects, the existing `useLiveSubscription` reconnect logic only re-subscribes if `isTailing === true`. Behavior unchanged from today. The ring stays at its pre-pause state regardless. Acceptable.

### 8.5 Edge case: tag added/removed during paused mode

If the user changes the tag set while in fixed mode (e.g., removes a tag from the chart), the existing tag pruning logic clears that tag's ring buffer. New tags don't get ring data until they're live-subscribed (next `tailing` entry). Acceptable.

### 8.6 Untested interaction: drag-zoom-during-paused-mode followed by Live click

Sequence: user pans to fixed → drag-zooms to a new range → clicks Live to return to tailing.

The ring buffer's state during paused mode is from the *previous* live session at the *previous* viewport's bucketSMs. After drag-zoom and Live click, the new viewport has a different bucketSMs. The merge's re-bucket helper handles this (re-bucket from raw moduleTs samples). But there may be a transient where the ring's old data and the new live subscription's data coexist with different push patterns. Worth a targeted test.

---

## 9. Open Decision Points for the Reviewer

1. **Retention window value.** Is 60 s with 50% margin (i.e., `TREND_RING_CAPACITY = 300`) the right number, or should it be tuned to observed CAG materialization lag in the actual deployment?
2. **Retire `accumulatorsRef`?** Always re-bucket from `ringsRef` at merge time, or keep the live-mode accumulator for hot-path performance? Decision should be informed by render-time profiling.
3. **Always-pass ring snapshot to merge.** This means every render in fixed mode does a no-op merge call. Worth a memoization layer (return cached merge output if ring snapshot and cached data haven't changed) or trust React's reconciliation?
4. **Cache invalidation batching strategy.** Per-WS-push tick, per-RAF, or just amortized through the cache's existing access patterns? See §8.2.
5. **Backporting to `hmi_trend_viewer_spec.md` §10.6.** This proposal supersedes the current §10.6 architecture. The spec update should land in the same commit as the implementation.

---

## 10. Glossary

- **CAG (Continuous Aggregate)** — TimescaleDB's mechanism for pre-aggregating time-series data at fixed bucket sizes. Materialization is asynchronous; recently-written samples are not immediately visible.
- **CAG materialization lag** — the time delay between a sample being written to the hypertable and it appearing in a CAG. Typically ~10-30 s.
- **Live mode (tailing)** — viewer mode where the right edge of the visible window tracks "now" and data flows via WebSocket.
- **Fixed mode** — viewer mode where the visible window is anchored to a specific time range; data is REST-fetched.
- **Spine** — the initial REST tile fetched on entering live mode, covering the full viewport at history-mode resolution. Serves as the "historical baseline" for live mode.
- **Ring buffer (was: FIFO)** — bounded per-tag buffer of recent raw samples, retained by `useLiveSubscription`.
- **`moduleTs`** — the sample's timestamp as reported by the device (module). Module-clock time, distinct from client wall-clock time.
- **Tile** — a unit of cached data covering a specific `(startTime, endTime, bucketCount)` range for a specific tag.
- **Active tile set** — the tiles currently driving the chart's visible data. Maintained as a sorted array in `activeTilesRef`.
- **`bucketSMs`** — bucket size in milliseconds, derived from viewport span and bucket count.
- **dataViewport vs modeViewport** — `modeViewport` is what the user intends to see; `dataViewport` is what the fetch path uses (may differ due to drag-zoom snapping). See `useZoomState`.

---

*End of design doc.*
