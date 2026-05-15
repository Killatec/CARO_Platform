# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- Route-level INVALID_RANGE_TOO_NARROW check removed (had wrong threshold semantics: applied MIN_VIEWPORT_SPAN_MS=1000ms against per-tile span, but tiles are viewport/visibleTilesPerWindow=half-viewport; viewport=1000ms produced tile=500ms which the route incorrectly rejected). Phase 6 dispatch already handles small windows correctly (sub-100s → queryRaw; bucketed branch's INVALID_BUCKET_S check handles invalid bucketSMs cases via 10efccd). MIN_VIEWPORT_SPAN_MS removed from @caro/db (was server-side; now client-only in @caro/trend-chart). Client-side viewport gate unchanged — remains the sole under-range guard with the "Range too narrow" UX. Spec §6.1 INVALID_RANGE_TOO_NARROW removed from error table; §6.3 under-range clarified as client-side UX only; §9.5 CLIENT_UNDER_RANGE bullet updated to reflect asymmetry with over-range server-side guard.

---

**Last cleared:** 2026-05-15. Audit walkthrough Phases 1-6 propagated to spec, handoff, and `platform_todo.md`; entries removed per discipline. Audit history in git: commits 355ffaa → f90d8c5 (Phase 2 through Phase 6 implementations) and the Phase 1 / Phase 5 doc-only commits.
