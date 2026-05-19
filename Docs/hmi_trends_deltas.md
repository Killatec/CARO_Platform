# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- 2026-05-19. Phase 4 refinement: Live button orange rule tightened — orange only when `latestSampleTs < state.from` in `live-fixed` (live edge off-screen left); button stays highlighted when edge is inside the viewport or no data has arrived yet. `liveEdgeBehindWindow` computed in `TrendChartContainer` from `liveSubRef.current.getLatestSampleTs()` per render and passed to `EndPicker` as a new prop. `LIVE_BTN_ORANGE` (#ea580c) added to `EndPicker.tsx`. No tooltip per D10.

- Phase 3: `isFreshLiveLanding` refined to `prev.mode === 'live-fixed' && next.mode === 'live-trailing'` (not the wider `willBeLive && next.mode === 'live-trailing'` in the proposal) — prevents spurious commitAndDrain+evictAll on `live-trailing → live-trailing` via preset/Live-click, which the existing "preset click in tailing → no commitAndDrain" test requires.
- 2026-05-18. Symmetric window-vs-live-edge rule supersedes D6 + D7. pan / zoom / endPicker from ANY state classify mode by `latestSampleTs vs action.to`: `LastTS < Window_End → live-fixed`, `LastTS >= Window_End → fixed`. Extracted `classifyByWindow` helper. `zoomApplied` action gains required `latestSampleTs: bigint | null`. Preset and Live button unchanged. Phase 5 will propagate to spec §9.3 / proposal D6 / D7.
- 2026-05-19. Phase 5: `syncDataViewport(modeToViewport(next))` added to `!wasLive && willBeLive` branch in `dispatchModeAction`; fixes accumulator freeze in live-fixed by ensuring `dataViewport` matches the new live viewport on fixed→live-* entry.
- 2026-05-19. Phase 6: hoisted `syncDataViewport(modeToViewport(next))` to top of `dispatchModeAction` (unconditional); removed redundant inline calls from the `wasLive && !willBeLive` and `!wasLive && willBeLive` branches. Fixes blank-window in zoom-within-Live (wasLive && willBeLive had no syncDataViewport).

---

**Last cleared:** 2026-05-17. Audit remediation pass closure — M1 (signature change + meta + singleton removal), D1 (top-level summary log), F5 (per-tag outbox cap), TG-7 follow-up (`commitAndDrain` fix), and TG-1 (chunk-pruning regression test) propagated to spec §4.1 / §4.4 / §14.7 and handoff §1 / §10. `Docs/Update_plan.md` deleted; audit history in git: commits through 2026-05-17.

**Last cleared:** 2026-05-18. Phase 2 implementation bug-fix arc closure — five architectural decisions from the post-Phase-2 fix cascade propagated to handoff §10 divergences 25–29 and §5 / §8 invariants: (25) `spineMetadataMatches` gates the live-wins clip in `seedFromSpineFetch`; (26) wholesale replace clears accumulators / rawBuffers / sessionHighWaterMark synchronously; (27) type-coherence guard in `getBufferSnapshot`; (28) split live/history paths for `mergedData` in `TrendChartContainer`; (29) `lastChartDataRef` bridges chart data across transitions. Commits: 4763614 (initial 3 fixes), 6ffa8ee (Phase 2b cutover), Phase 2c trim, e9f10dd (wholesale-replace clear), e8b926f (diagnostic cleanup).
