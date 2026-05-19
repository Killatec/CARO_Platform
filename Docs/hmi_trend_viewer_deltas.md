# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- H1 fix: `TrendChartContainer.tsx:444` `showLastWhenIdle` now uses `isLive(modeState.mode)` (was `=== 'live-trailing'`); aligns with spec §8.4.

---

**Last cleared:** 2026-05-17. Audit remediation pass closure — M1 (signature change + meta + singleton removal), D1 (top-level summary log), F5 (per-tag outbox cap), TG-7 follow-up (`commitAndDrain` fix), and TG-1 (chunk-pruning regression test) propagated to spec §4.1 / §4.4 / §14.7 and handoff §1 / §10. `Docs/Update_plan.md` deleted; audit history in git: commits through 2026-05-17.

**Last cleared:** 2026-05-18. Phase 2 implementation bug-fix arc closure — five architectural decisions from the post-Phase-2 fix cascade propagated to handoff §10 divergences 25–29 and §5 / §8 invariants: (25) `spineMetadataMatches` gates the live-wins clip in `seedFromSpineFetch`; (26) wholesale replace clears accumulators / rawBuffers / sessionHighWaterMark synchronously; (27) type-coherence guard in `getBufferSnapshot`; (28) split live/history paths for `mergedData` in `TrendChartContainer`; (29) `lastChartDataRef` bridges chart data across transitions. Commits: 4763614 (initial 3 fixes), 6ffa8ee (Phase 2b cutover), Phase 2c trim, e9f10dd (wholesale-replace clear), e8b926f (diagnostic cleanup).

**Last cleared:** 2026-05-19. Phase 4/5/6 implementation arc propagated: orange-button refinement (spec §12.3, handoff §3/§7); `isFreshLiveLanding` scoping to `live-fixed → live-trailing` only (handoff §3); symmetric window-vs-live-edge rule superseding D6/D7 with `classifyByWindow` helper (spec §9.3/§12.2, handoff §3/§10 div.30); `syncDataViewport` added to `!wasLive && willBeLive` branch — Phase 5 (handoff §5/§10 div.31); `syncDataViewport` hoisted unconditionally to top of `dispatchModeAction` — Phase 6 (handoff §7/§10 div.31). Three-state mode machine, unified Live buffer, and revised glossary also propagated to spec §9.3/§10.6–§10.8/§12.1–§12.4/§13.1/§14.4/§19 and handoff §3/§5/§7/§8. Phase B residual issues E/F/G captured in handoff §11.
