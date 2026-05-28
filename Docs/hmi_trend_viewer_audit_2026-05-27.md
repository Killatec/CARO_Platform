# HMI Trend Viewer — Deep Audit
**Date:** 2026-05-27
**Scope:** `hmi_trend_viewer_spec.md` (v2.2) and `hmi_trend_viewer_handoff.md` (Phase A Steps 1–12) vs the as-built implementation in `apps/caro-hmi/server/`, `packages/db/timescale/`, and `packages/trend-chart/`.
**Method:** Direct read of route, DB layer, hooks, components, WS server, and migrations; cross-checked against the spec contract and handoff divergence list.

The implementation is in good shape overall — the unified-tile architecture and terminal-cache rule have been delivered, the bounded-`prev` SQL is in place, and the contract surfaces (REST envelope, tile geometry, mode machine, persistence schema) all match what the spec promises. The findings below are real but mostly mid-tier: a couple of behavior divergences that materially affect bandwidth and synthetic-event semantics, a handful of doc/comment drifts, dead code that should be either wired up or removed, and a few defensive-coding gaps worth closing.

---

## 1. Behavior divergences (real, not cosmetic)

### 1.1 WS trend listener is per-ingest, not per-COV — already in `platform_todo.md` but worth re-flagging

`apps/caro-hmi/server/src/telemetry-intake.ts:41,110` defines the listener signature as `((moduleTs: number, moduleId: string) => void) | null` and fires `this.trendDeltaListener?.(message.timestamp, moduleId)` once per MQTT ingest. `WsServer.handleTrendDelta` (`ws-server.ts:123-148`) then iterates **every trendable tag of the module** and pushes the current LKV value into every subscribing client's per-tag outbox.

Spec §4.4 reads as if the common path is per-COV (real samples) and synthetic-on-flush is the rare fallback for "tags with no real event in the flush window." In reality the listener never sees per-tag values — every ingest pushes one entry per (trendable tag in module × subscribed client), regardless of whether that tag changed. The synthetic-on-flush branch is virtually never taken at a busy module. Behaviour is currently correct (LOCF still propagates), but the wire shape and outbox-growth model both diverge from the docs.

**Recommendation.** Pick a direction and follow through:
- **(a)** Update spec §4.4 and handoff §8 to match the per-ingest as-built. Cheaper; also forces `MAX_TREND_OUTBOX_PER_TAG=500` justification to be re-examined under the real worst-case (active 50-tag module × N clients).
- **(b)** Change `TelemetryIntake.ingest()` to call the listener per COV write with `(moduleTs, tagId, value)`. Touches the ingest hot path but cuts outbox bandwidth dramatically at flatline modules and aligns with the documented contract.

This is the highest-impact divergence on the list.

### 1.2 Tag-ID-validity check uses `id <= 0` in both layers — disagrees with spec on `id === 0`

The route (`routes/trends.ts:88`) and `getTrendTile` (`packages/db/timescale/trends.ts:801`) both reject `id <= 0`, which is consistent with each other. The spec §6.1 says "positive integers," so this is correct in spirit, but the API spec error code lists "non-integer" only — a request with `tag_ids=0` returns `INVALID_TAG_IDS` with the message "must be 1–8 comma-separated positive integers," which is fine. Document the zero-rejection explicitly in §6.1 to remove the ambiguity (it's currently a behavior-level guarantee with no test/spec assertion at the boundary).

### 1.3 `useLiveSubscription.bucketSMs` change without `tailMode` change can race the WS callback

`bucketSMsRef.current` is updated synchronously during render (`useLiveSubscription.ts:261`). The subscribe callback reads `bucketSMsRef.current` and feeds samples into the accumulator (`processEventIntoAccumulator`, line 325). The accumulators themselves are not re-allocated until the tailMode effect re-runs after the render commit — but its dep array is `[isLive, bucketSMsStr, tagIdsKey, tailMode]`, so a `bucketSMs` change does re-run it.

Race window: a `TREND_DELTA` arrives synchronously between the render (which writes the new `bucketSMsRef.current`) and the tailMode effect cleanup that re-allocates the accumulator. During that window the callback calls `processEventIntoAccumulator` with the new `bucketSMs` against an accumulator whose `openBucket.startMs` was aligned to the old `bucketSMs`. The "out-of-order: drop" branch (line 180) silently drops the sample, or worse, the bucket-comparison math produces a misaligned bucket that the next reseed throws away.

Practically the window is a few milliseconds and the next reseed-from-ring corrects state, so user-visible impact is near zero. But the pattern is fragile. Two options:
- Read `bucketSMs` and accumulator-state together at the top of the callback (snapshot pattern), or
- Detect mismatch between `openBucket.startMs % bucketSMs === 0n` at the top of `processEventIntoAccumulator` and skip-and-let-reseed-handle-it.

### 1.4 `accumulatorsRef.current.clear()` in `drainBuffers` — same lurking pattern as the TG-7 raw-buffer bug the handoff warns about

`useLiveSubscription.ts:455` clears the accumulators map outright. The handoff's "Gotcha" section explicitly warns that `rawBuffersRef.current.clear()` is a bug because the subscribe callback's `if (buf)` guard would silently drop events thereafter. The same logic applies to `accumulatorsRef.current.get(tagId)`: after `.clear()`, any sample arriving before the tailMode effect re-allocates accumulators is dropped by the `if (state)` guard (line 324).

In production this is masked because `drainBuffers()` is only called on `Live → fixed`, at which point `isLiveRef.current` becomes false and bucketing is gated off anyway — so the drop is correct. But the pattern violates the handoff's own gotcha rule by inspection. If a future caller invokes `drainBuffers()` from any other state transition, the bug returns.

**Recommendation.** Mirror the rawBuffers in-place reset:

```ts
for (const state of accumulatorsRef.current.values()) {
  state.openBucket = null;
  state.closed.value.length = 0;
  state.closed.min.length   = 0;
  state.closed.max.length   = 0;
  state.firstClosedStartMs  = null;
  state.lastKnownValue      = null;
}
```

…or call out in a comment that `drainBuffers` is **only ever** called on a transition that flips `isLiveRef` to false.

### 1.5 `getLatestSampleTs()` walks every ring on every call — quadratic in subscribed-tag count if invoked from a hot path

`useLiveSubscription.ts:463-476` iterates `ringsRef.current.values()` on every call, doing one BigInt comparison per (tag × ring tail). `TrendChartContainer` reads it from `liveSubRef.current?.getLatestSampleTs()` inside multiple callbacks (`handleXRangeChange`, `handleXPan`, `handleEndCommitted`, `handleDragZoom`) and inside the `liveEdgeBehindWindow` derivation (`TrendChartContainer.tsx:222-227`) which re-runs on every render. At 16 tags and ~4 Hz render cadence under live mode, the overhead is sub-microsecond — not a perf concern today.

The smell is that `sessionHighWaterMark` already exists as the per-session monotonic floor and is bumped on every WS sample. The "current max across rings" portion of the formula is redundant during a live session: the high-water mark is by definition ≥ any current ring tail. The currentMax-vs-HWM logic only matters during the first frame before HWM is set — which is the `null` case anyway.

**Recommendation.** Either drop the ring walk and return `sessionHighWaterMarkRef.current` directly, or cache the result and invalidate on each WS sample. Reduces every container render-pass call from O(tags) to O(1).

---

## 2. Stale documentation / comments inside source

These are not behavior bugs — they're stale comments inside production source files that mislead future readers about what the code is doing.

### 2.1 `level.ts:83` — `MIN_VIEWPORT_SPAN_MS` comment references the removed live-spine path

```ts
 * Derived to keep bucketSMs ≥ 1ms in the live-spine path (bucketCount=1000):
 * below 1s, Math.round produces 0 and the chart breaks visually downstream.
```

The live-spine path was removed in the unified-tile refactor (2026-05-21, handoff §1). `bucketCount=1000` is the effective `visibleTilesPerWindow × bucketCount = 2 × 500` total, not a literal `bucketCount` value. The comment was correct at the time; today it points at architecture that no longer exists. Suggested rewrite:

```ts
 * At defaults (visibleTilesPerWindow=2, bucketCount=500 → 1000 total buckets per viewport),
 * a viewport below 1 s would round per-tile bucketSMs to 0 and the chart would break.
```

### 2.2 `gatedFetchTile.ts:44-46` — same live-spine reference

```ts
// For the live-spine (bucketCount=2×500=1000): triggers at span < 1000n ms = MIN_VIEWPORT_SPAN_MS.
// For history tiles (bucketCount=500): triggers at span < 500n ms (viewport < MIN_VIEWPORT_SPAN_MS
// is caught by the main-effect pre-check; this guards any bypass path).
```

Same issue — the "live-spine" and "history tiles" distinction stopped existing once the unified pipeline shipped. Update to refer to the unified tile geometry.

### 2.3 Handoff §2 file map says `axisInteractions.ts` has 9 exports; actual count is 7

```
axisInteractions.ts           # pruneRemovedTagOverrides, isInYAxisHitZone, panYScale,
                              # zoomYScale, isInXAxisHitZone, panXScale, zoomXScale
                              # (panThresholdCheck and checkAndExtendXCoverage removed
                              # in unified-tile refactor)
```

Handoff §2 *near the top* says `# pure axis pan/zoom helpers (9 exported functions)`. Either drop the count line or update to 7.

### 2.4 Handoff §2 says tests live at `src/__tests__/`; they actually live at `__tests__/` (sibling of `src/`)

Compare handoff §2 `__tests__/` block (rendered inside `src/`) to actual `packages/trend-chart/__tests__/` location. Minor but every reader who copy-pastes that path will get a "no such file" error. Easy fix — pull the `__tests__/` block one indent left in the §2 tree.

### 2.5 Handoff §1 audit-pass note mentions `commitAndDrain` → `drainBuffers` but TG-7 fix is described as still present

The note is fine in itself; the actual `drainBuffers` was implemented and the function is what `dispatchModeAction` invokes today. But §10 div.20 and the "Historical decisions" still mention the original mutation pattern by name. A pass to remove the stale name references would tighten the doc.

---

## 3. Dead or near-dead code

### 3.1 `pruneAndAdd` in `tileActiveSet.ts` is exported and tested but never called

`pruneAndAdd` is exported from `tileActiveSet.ts:386`, re-exported from `useTrendData.ts:12`, re-exported again from `index.ts:18`, and exercised by `tileActiveSet.test.ts` ("direct-seam: pruneAndAdd geometry"). The actual fetch pipeline (`runTileFetch`) replaces `activeTilesRef.current = nextActive` wholesale — `pruneAndAdd` is no longer invoked anywhere in production code paths.

If it's kept intentionally as a primitive for future re-use, fine — leave a comment saying so. If not, remove it along with its tests and the `MAX_ACTIVE_TILES` constant (also unused).

### 3.2 `synthesizeNullTile` exported but only referenced in comments and a type doc-string

`tileActiveSet.ts:292` defines `synthesizeNullTile`. The fetch-failure handler in `runTileFetch.ts:339-345` calls `storeNullTile` (a different function) instead. `synthesizeNullTile`'s only callers are tests; production code never invokes it. Same call: comment-as-intent or delete.

### 3.3 `SpanBucketIndicator` kept "for backward compatibility" but no consumer remains in this repo

Handoff §2 says "kept for backward-compat export; superseded by SpanIndicator + BucketFetchIndicator split." `TrendChartContainer` uses the split components; `SpanBucketIndicator.tsx` is only referenced by its own test. Either drop the file (no external consumers because the package isn't published outside this monorepo) or freeze it with a `@deprecated` JSDoc tag so the next reader knows the contract.

### 3.4 `TileMetaSegment.source` includes `'tag_samples'` distinct from `'raw'`, but the route never logs `meta`

The whole `TileMeta` plumbing — `TileMeta`, `TileMetaSegment`, segment-level timing — is set up correctly in `getTrendTile` and returned in `TileResult`. The route destructures only `tile` (`routes/trends.ts:122`) and discards `meta`. Spec §14.7 promises a `TIMESCALE_LOG_TILE_QUERIES`-gated structured log; that log already fires inside `getTrendTile` itself (line 938) using `meta`, so the data is reaching the log path. But the route's `console.error('[trends/tile] internal error', raw)` on the error branch doesn't pull anything from `meta`, and the success branch could be using `meta` to drive a route-side log (e.g. wall-clock vs DB elapsed comparison per the "Pool starvation looks identical to slow SQL" gotcha).

**Recommendation.** Either delete the unused `meta` return from `getTrendTile` (it's only used internally for the existing DB-side log) and simplify the public type back to `Promise<TrendTile>`, or actually consume it at the route level and emit a complementary client-observable log line that includes `network_elapsed_ms = total_elapsed_ms − meta.totalDbElapsedMs`. The current state — exposing the type, then ignoring it at the only public caller — invites a future contributor to assume `meta` is consumed somewhere.

---

## 4. Defensive-coding gaps worth closing

### 4.1 Route bigint parsing accepts strings with leading `+` and `.0` but rejects scientific notation silently

`routes/trends.ts:96-99` uses `BigInt((q.start_time as string).trim())`. `BigInt('1.0e3')` throws, which the catch maps to `INVALID_RANGE`. `BigInt('+1234')` succeeds. `BigInt('1234.0')` throws. `BigInt(' 1234 ')` works because of `.trim()`. Behavior is mostly fine but the error message says "must be a positive integer (ms since epoch)" without echoing the offending value — adds a debug pain-point. Suggestion: include the raw value in the error message (sanitized — first 32 chars max).

### 4.2 `BigInt(q.start_time as string)` cast — typescript-only, runtime trust

`q[name]` is `string | undefined`; the cast to `string` is correct only after the presence check on line 78. If a future contributor moves the presence check or relaxes the loop bounds, the cast silently allows `undefined` through to `BigInt(undefined)`. Replace with an explicit local narrowing:

```ts
const startRaw = q.start_time;
if (typeof startRaw !== 'string') bad('MISSING_QUERY_PARAM', 'Missing required query parameter: start_time');
```

### 4.3 `getTrendTile` deserializes watermark via `Number(BigInt(wmUs) / 1000n)`

`packages/db/timescale/trends.ts:298`. Pgsql's `cagg_watermark` returns microseconds-since-epoch as a bigint. The current code returns 0 when `wmUs === null` — the comment says "fall through entirely" — but a brand-new CAG that has never refreshed will return `null`, and `splitBoundaryMs = 0` then routes through the `splitBoundaryMs <= Number(startTime)` branch (line 701) which recurses to the next-finer source for the entire range. That's correct behavior. But the code path is non-obvious; a single-line comment at the `?? null` site would help.

Also: `Number(BigInt(wmUs) / 1000n)` does integer division, dropping sub-millisecond precision. For watermarks rounded to bucket boundaries this is fine, but if a CAG ever exposes a sub-ms watermark the rounding shifts it down. Microseconds at ms-since-epoch scale exceed `Number.MAX_SAFE_INTEGER` only past year ~285,419, so the bigint-first conversion is the right pattern. Just worth a comment.

### 4.4 `nullFutureBuckets` mutates in place — defensible but undocumented at the public boundary

`packages/db/timescale/trends.ts:767-784` mutates `series[].value[i] = null`. This is fine inside the closed `getTrendTile` boundary, but the function is `export`ed and could be called from `__tests__` or future helpers with shared array references. Add a `@param` note clarifying that arrays are mutated, or convert to a pure copy.

### 4.5 `mergeAggregate` LOCF seed at the gap can leak stale data when `effectiveCachedN === 0`

`mergeTrendData.ts:113-115`:

```ts
const lastCachedV   = cachedArrs ? (cachedArrs.value[effectiveCachedN - 1] ?? null) : null;
```

When `effectiveCachedN === 0`, `cachedArrs.value[-1]` is `undefined`, coalesces to `null` — fine. When `effectiveCachedN === cached.n` and the last bucket in `cachedArrs.value` is `null` (a real null marker), the LOCF carries forward a `null`, which is what null-as-gap demands. But when the last bucket is `0` or `false`-coerced numeric `0`, the `?? null` is fine because `0` is not nullish. So the logic is correct. But the comment "LOCF seed for gap" doesn't capture that the seed is only used in the `i < liveStartIndex` gap, not in the `i ≥ liveEndIndex` extension. The conditional that consumes it is the `else` branch at line 144-148; clarify that the seed is for cached-absent-tag and gap-between-cached-end-and-live-start, not for the right edge.

### 4.6 `assembleData` `bucketSMs` integer-invariant throw

`tileActiveSet.ts:248` throws if `bucketSMs` is non-integer. The fallback branch at line 245 calls `Math.round` precisely to keep it integer. Outside that fallback, `bucketSMs` comes from `cached.bucketSMs` (server-derived integer) or `entry.data.bucketSMs` (assembled by `assembleResponses` — also integer-or-Math.round). The throw is defensive against future drift; fine. Worth a one-line comment that the invariant is upstream-enforced in two places and the throw is a last-mile guard.

---

## 5. Spec-vs-code drift items already on a backlog

For completeness — these are listed in `Docs/platform_todo.md` and `Docs/hmi_trend_viewer_handoff.md` and need no new action from this audit:

- **WS per-ingest vs per-COV** (item 1.1 above; `platform_todo.md`)
- **Dead-tag detection / LOCF cutoff replacement** (handoff §10 "Dead-tag detection")
- **Pool sizing watchlist** (`platform_todo.md`)
- **Flaky integration tests under cumulative DB load** (`platform_todo.md` 2026-05-17)
- **Platform-wide error-management refactor** (`platform_todo.md`)
- **NULL `prev` rate monitoring** (`platform_todo.md`)

---

## 6. Architectural observations (not bugs, but worth surfacing)

### 6.1 `TrendChartContainer` is doing a lot of work — over 560 lines

Container responsibilities currently include: mode-state wiring, session hydration, save scheduling, dispatchModeAction wrapping, RAF coalescing for X-pan and X-range-change, range-message derivation, placeholderData construction, lastChartDataRef bridge, Y-scale override hydration plumbing. The handoff says "intentionally thin — it wires the hooks and passes props" — that's no longer true, and the spec's §7 description doesn't capture half of this.

The session persistence block (lines 365-454) is ~90 lines that could move to a `useSessionPersistence({ persistKey, modeState, tagIds, ... })` hook with a clean interface. The dispatchModeAction side-effects are a natural fit for the mode-state hook itself (could move into `useTrendMode` as an `onTransition` option). Doing so would let `TrendChartContainer` shrink back to roughly the size the handoff describes and would let the persistence behaviour be unit-tested without mounting the full container.

### 6.2 `currentBucketSMs` flows through props rather than through context

`useTrendData` accepts `bucketSMs` as an optional opt, with a comment about the "legacy / test path" when it's omitted. In production every call passes it explicitly. The legacy path is just one extra branch in `useTrendData.ts:71-75`. Either delete the fallback (require `bucketSMs`) or formalize the legacy path with a test that locks the equivalence — leaving both alive opens a future bug where the legacy formula and the explicit value silently disagree.

### 6.3 Three different definitions of "live" exist in the codebase

- `isLive(mode)` in `useTrendMode.ts` — predicate over mode discriminant
- `isLive: boolean` prop on `useTrendData` and `useLiveSubscription` — derived
- `entry.committedThroughTs < tile.endTime` — terminal-cache rule (semantic live edge)

These are all consistent and the indirection is fine, but the spec/handoff doesn't enumerate them together. A small "Live, in three places" subsection in the spec (or a Glossary entry) would help future readers.

### 6.4 `useLiveSubscription` exports `TREND_RING_CAPACITY` as a public constant

`useLiveSubscription.ts:12`. The ring size is internal capacity-management; exporting it suggests external consumers might tune it. They can't — there's no constructor to set the value. Make it a module-local constant or document why it's exported.

### 6.5 Cache key collision between v0.7-shape and v0.8-shape entries

`tileCache.ts` makes keys from `(tagId, startTime, endTime, bucketCount)`. The shape (v0.7 = value-only, v0.8 = value+min+max) is not part of the key. `assembleData` (`tileActiveSet.ts:218`) defensively handles the case where a cached entry lacks `min`, but a cache populated by a v0.7 server and then served to a v0.8 client (or vice versa, during a deploy roll) will silently drop bands rather than refetch. The spec §6.5 says the change is "purely additive," which it is, but the cache should ideally invalidate v0.7-shape entries when a v0.8 response lands for the same key. Today the LRU eventually evicts them, but in the worst case (cold tile, immediate read) the chart shows no band on a band-capable response. Low priority but worth a regression test at minimum.

---

## 7. Priority-ranked action list

| Priority | Item | Effort | Risk if ignored |
|---|---|---|---|
| **High** | 1.1 — Decide per-ingest vs per-COV WS direction and either fix the impl or update §4.4 | Days (option b) / hours (option a) | Doc and code disagree on a load-bearing wire contract; outbox sizing assumptions don't hold under busy modules |
| **High** | 1.4 — `accumulatorsRef.clear()` in `drainBuffers` parallels the warned-about raw-buffer bug | <1 hour | Subtle; only surfaces if `drainBuffers` is reused from any non-Live-exit transition |
| Medium | 2.1, 2.2 — Remove "live-spine" references from `level.ts` and `gatedFetchTile.ts` | <30 min | Misleads future readers into looking for an architecture that's gone |
| Medium | 6.1 — Extract session-persistence and dispatchModeAction side-effects into hooks; restore container thinness | 1 day | Container is now harder to test and reason about than the handoff implies |
| Medium | 3.1, 3.2, 3.3 — Remove or annotate dead `pruneAndAdd` / `synthesizeNullTile` / `SpanBucketIndicator` | <2 hours | Surface-area sprawl; tests cover code that doesn't run in production |
| Medium | 6.5 — Cache-shape invalidation regression test | 1 hour | Edge case during version-mismatch deploys |
| Low | 1.5 — `getLatestSampleTs` ring-walk → return HWM directly | <30 min | Micro-perf; no current symptom |
| Low | 1.3 — `bucketSMs` race in WS callback during zoom-level switch | 1 hour | Sub-second visible glitch at most |
| Low | 1.2, 4.1, 4.2, 4.3, 4.4, 4.5 — Defensive-coding polish | <1 day total | None today; reduces future-bug surface |
| Low | 2.3, 2.4, 2.5, 6.3, 6.4 — Doc and comment drift | <1 hour total | Reader-confusion only |

---

## 8. What's good

The unified-tile + terminal-cache architecture is a substantial simplification over the prior live-spine / history-tile split, and the implementation reflects it: there is one fetch pipeline, one freshness predicate, one resolve flow. The bounded-`prev` SQL pattern is mandatory and correctly applied to every path (raw, CAG, raw-source-bucketed) via the shared `buildGapfillSql` helper. Watermark fall-through is implemented as a clean recursive descent with an explicit `dropSeamDuplicates` post-pass that handles the gapfill-emits-one-extra-bucket boundary correctly. The mode reducer is pure, exhaustive over the action set, and the symmetric `classifyByWindow` rule eliminates a category of subtle state-machine bugs that earlier asymmetries would have produced. Session persistence is opt-in via `persistKey`, schema-versioned, and silent on storage failure — exactly what a research-preview-grade feature should be.

The handoff's "Gotchas" section is the most valuable document in this directory and should be the model for other features' handoff files. It captures the kind of hard-won knowledge (e.g. `width: 0` disabling `_paths.band`, prepared-statement plan-pruning regression, `cagg_watermark` cold cost) that takes weeks to learn and seconds to forget.

Most of the audit findings above are second-order tightening, not contract or correctness bugs.
