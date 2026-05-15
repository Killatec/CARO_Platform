# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

---

## Pending propagation

(none — all entries below have been applied; this file should be emptied after the Phase 1 doc PR lands)

---

## 2026-05-14 — Audit pass (Phase 1 doc batch)

Change manifest for the Phase 1 doc PR. Spec and handoff have been edited in place.

### Spec edits (`hmi_trend_viewer_spec.md`)

- §4.1 — `getTrendTile()` and the REST endpoint use the shared `deriveBucketSMs` helper; signature `(tagIds, startTime, endTime, bucketCount, nowMs?)`.
- §4.2 — drop literal `bucketCount=500`; reference §10.2 defaults.
- §4.3 — `splitBoundaryMs` formula corrected: queried via SQL `time_bucket()` round-trip (TimescaleDB sub-day intervals use origin 2000-01-03 UTC, not Unix epoch).
- §4.4 — subscription lifecycle keyed on tag-list membership, not on `isTailing` (warm subscriptions across mode flips). Synthetic-on-flush reframed around LOCF-propagation intent; clock-domain skew not data-critical. New paragraph on server-side `SUBSCRIBE_TREND` membership filter.
- §5.3 — dropped v0.3 SnapshotEmitter historical-note paragraph.
- §6.1 — removed trendable-set check from `INVALID_TAG_IDS`; added permissive-read philosophy note. Added `MISSING_QUERY_PARAM` to validation error table.
- §6.2 — rewrote `responseTailTs` definition: server `Date.now()` at request entry, present on both raw and aggregate, consumed by client as `(responseTailTs - 1000ms)` ring trim threshold.
- §6.3 — `bucketS` derivation formalized via shared `deriveBucketSMs` helper used identically by route and DB layers.
- §7.1 — file map cleaned: removed `Tooltip.tsx`, removed stale `dateUtils.ts` helper listing, cross-ref to `@caro/ui` for date formatting (post-Phase-2.5).
- §8.5 — "Time:" label → "Cursor:" (code is canonical); `formatDateTime` cross-ref to `@caro/ui`.
- §8.6 — internal inconsistency fixed ("three values"); removed contradictory v1.0 note.
- §9.3 — preset highlight rule rewritten to match code; removed "subscription lifecycle keyed on `isTailing`" claim.
- §9.5 — added `endPickerCommitted` lower-bound clamp guard.
- §10.1 / §10.4 — replaced literal `bucketCount=500` mentions with cross-refs to §10.2.
- §10.5 — `ensureCovered` implementation note sharpened: candidate `tileSpanMs` from active set (preview of F7 fix landing Phase 3).
- §10.6 — `useLiveSubscription` paragraph clarifies warm subscriptions; `dispatchModeAction` description tightened.
- §10.7 — fully rewritten: subscription lifecycle keyed on tag-list membership only; UNSUBSCRIBE_TREND fires on tag removal or chart unmount only.
- §15 — retitled "Multi-Client Behavior"; pool-sizing prescription removed (lives in `platform_todo.md`).
- §17.1 — dropped "Connection pool bumped to 20–30 before production rollout" bullet.
- §17.1.1 — dropped Step 13 row; operational-monitoring note added pointing to `platform_todo.md`.
- §17.2 — removed pool sizing, perf-log enhancement, and EXPLAIN-plan gate items (all now in `platform_todo.md`).
- §18 — removed pool-sizing measurement from "Open (Phase A)".

### Handoff edits (`hmi_trend_viewer_handoff.md`)

- §2 — file map: removed stale `dateUtils.ts` line and stale test files; fixed `SpanPresets` highlight rule comment; dropped useTrendMode "37 cases" count.
- §3 — fixed preset highlight rule paragraph to match spec §9.3.
- §7 — collapsed `dispatchModeAction` repetition to pointer to spec §10.6/§10.8; removed `width` prop from Props list.
- §8 — collapsed evictAll/commitAndDrain Key Invariants to pointer to spec §10.6/§10.7/§10.8.
- §10 div #25 — rewrote in one pass (removed "removed then re-introduced" addendum).
- §11 — added §11.E (synthetic-on-flush LOCF rationale, clock-domain note).
- §12 — dropped Step 13 (pool resize) from "What Comes Next" table.

### platform_todo edits (`platform_todo.md`)

- Reframed pool sizing entry from "must bump before production" to "watchlist; bump only if pool exhaustion observed."
- Consolidated the duplicate "DB contention" observation into pool sizing entry.
- Added "Dead-tag detection / stale tag UI indicator" entry (previously narrated only in `handoff.md`).
- Added "Re-evaluate error management platform-wide" cross-cutting entry (audit B3#5).
- Restructured Trend Viewer subsections into "Deferred / Possible Future Improvements" and "Operational/observability watchlist".
- Marked EXPLAIN-plan gate as superseded by `/dev/trends-perf`.
- Updated date to 2026-05-14.

---

## 2026-05-14 — Phase 2 low-risk code batch

- F2/F13: `responseTailTs: number` added as first-class field to both `RawTrendTile` and `AggregateTrendTile`; `getTrendTile` now accepts optional `nowMs` param; route captures `Date.now()` before dispatch and passes it down.
- F4: `WsServer` validates `tagIds` shape on all four subscribe message types via `parseTagIdsArray`; `SUBSCRIBE_TREND` filters against `trendableTagIds: Set<number>` (default empty) with `console.warn` on rejected IDs; `trendableTagIds` threaded from `index.ts`.
- F8: `endPickerCommitted` rejects `to < 2n` (no-op); shrinks span (not End) when `to - cappedSize < 1n` so `from` is always ≥ 1n.
- F9: `deriveBucketSMs(startTime, endTime, bucketCount)` extracted to `packages/db/timescale/trends.ts` and exported; route uses it to replace inline derivation; same helper in `@caro/trend-chart/level.ts` unchanged (different signature, different package).
- B2 (catch handler): route error handler constructs `new Error(raw.message)` and attaches `.code`/`.status` instead of mutating `raw`.
- B2 (barrel exports): `clampLowerBound` and `deriveBucketSMs` exported from `@caro/trend-chart/index.ts`.
- B2 (`clampLowerBound` dedup): extracted to `bigintMath.ts`; `useTrendMode.ts` and `useZoomState.ts` import from there; inline copies deleted.
- B2 (`formatBucketS` dedup): `SpanBucketIndicator` now imports `formatBucketS` from `render/formatBucketS.ts`; inline `formatBucket` removed. Output now includes " buckets" suffix.
- B2 (dead invariant): `if (!Number.isInteger(bucketSMs)) throw` guard removed from `getTrendTile` (always integer after `Math.round`).
- B2 (`__test_lastUsedSources`): exported from `packages/db/index.ts` alongside existing test hooks.
- B3#1: `seriesFromTrendData.ts` and its test file deleted (orphaned — production code uses `bandsFromTrendData`).
- B3#3: `SegmentResult` doc comment added explaining number/bigint boundary.
- B3#4: `SOURCES` const tuple replaces ad-hoc `nextFinerSource` switch; `CaggSource`/`AggregateSource` derived via `typeof SOURCES[number]` and `Exclude`.
- B3#6: 60s rate-limit gate removed from `TrendSnapshotScheduler.tick`; catch simplified to single `console.error`.
- F11: `T005_create_cag_1s.sql` migration deleted (superseded by T006).

---

## 2026-05-14 — Post-audit correction: TrendSnapshotScheduler dormant-module behavior

Original handoff §11.D ("Past-LOCF on dormant signals") and the corresponding `platform_todo.md` heartbeat-vs-null entry described a non-issue. The module watchdog already nulls the LKV on stall transition, so subsequent `TrendSnapshotScheduler.forceTrendSnapshot()` ticks force-write nulls (not stale LKV), which propagate as `mixed-null` through the CAG three-case rule and render as gaps per §5.4 null-as-gap.

- Deleted handoff §11.D ("Past-LOCF on dormant signals in CAG path") — no current limitation; watchdog handles full-module silence.
- Deleted `platform_todo.md` "TrendSnapshotScheduler heartbeat-vs-null" entry — fix proposed there is what the watchdog already does.
- Renumbered handoff §11.E (synthetic-on-flush clock-domain note) to §11.D. Updated cross-reference in spec §4.4.
- No edit to `CARO_Trending_Reference.md` — the proposed §15.6 addition would have introduced a false limitation; not applied.

---

## 2026-05-14 — formatBucketS suffix removal

- `formatBucketS` now returns only the size ("3.6 s") without the " buckets" suffix. `SpanBucketIndicator`'s footer reads "Bucket Size: 3.6 s" (no redundancy). Callers that need the labeled form should append context at their site.

---

## 2026-05-14 — Phase 4 F15 useTrendData.ts split

- F15: `packages/trend-chart/src/useTrendData.ts` (~900 lines) split into 5 modules: `useTrendData.ts` (shell, ~150 lines), `liveSpineFetch.ts`, `historyTileFetch.ts`, `tileActiveSet.ts`, `gatedFetchTile.ts`. Pure refactor, behavior-preserving — all 573 existing useTrendData tests pass unchanged. 6 new direct-seam tests added for `tileActiveSet` (579 total).

---

## 2026-05-14 — Phase 5 handoff §10 cleanup

- Handoff §10 rewritten to current-state-only: 30 entries deleted (absorbed into spec §4.3, §4.4, §5.5, §6.2, §6.3, §6.5, §7.1, §8.5, §9.3, §9.5, §10.4–§10.8); 3 kept and trimmed (#14 raw-path SQL, #23 uPlot range/userScaleRef, #24 setSelectHook ordering); 3 moved to new "Historical decisions" subsection (#20 watchdog null marker, #21 open-tile model, #22 responseTailTs buffer trim). Preamble updated. Numbering gaps intentional to preserve external cross-references.

---

## 2026-05-15 — Phase 6: Unified dispatch rule (proposal validated and implemented)

- Window-size-based dispatch: raw COV for tile window where `expectedPoints ≤ bucketCount` (visible window ≤ 100 s at SAMPLE_RATE_HZ=10, bucketCount=500); bucketed for larger windows.
- New raw-source bucketed path: when `bucketS < 1.0` AND window is bucketed, query reads `tag_samples` directly (gapfill+locf+bounded-prev, same template as CAGs).
- Preset changes: 5m and 15m flip from raw COV to bucketed (raw-source `tag_samples`). All other presets unchanged.
- `SAMPLE_RATE_HZ = 10` constant and `dispatchShape()` helper exported from `@caro/db`.
- `AggregateTrendTile['source']` union extended with `'tag_samples'`; mirrored in `TileApiResponse` and `AggregateSeriesData` in `@caro/trend-chart`.
- Spec §3, §6.1, §6.2, §6.3 updated to reflect the unified rule and new per-preset routing table.
- Handoff §5 updated with Phase 6 dispatch rule summary.
- No client-side logic changes (discriminated union preserved; `source === 'raw'` discriminant unaffected).
- Validated via EXPLAIN ANALYZE 2026-05-15: bucketed 35% faster on DB side and 3.3× smaller on wire vs raw COV at ~5.7 Hz production activity. See `Docs/trend_dispatch_unified_rule_proposal.md` §7.1.

## Pending audit findings

(none)
