# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- Symmetric out-of-range UX guard: client-side `CLIENT_UNDER_RANGE` sentinel (parallel to existing `CLIENT_OVER_RANGE`) prevents fetches when viewport span < MIN_VIEWPORT_SPAN_MS=1000n (1 second; derived to keep bucketSMs ≥ 1ms in live-spine bucketCount=1000 path). `useTrendData` exposes `rangeTooNarrow`; `TrendChartContainer` renders `placeholderData`; `CursorDisplay`'s `rangeMessage` prop shows "Range too narrow. Zoom out or pick a wider preset." inline. Server-side defense-in-depth: route rejects bypass requests with 400 `INVALID_RANGE_TOO_NARROW` so `errorHandler` logs them (mirrors existing `INVALID_BUCKET_S` over-range logging). Server now responds explicitly to all out-of-range cases instead of silently returning empty data. Spec §6.1 error table extended; §6.3 retitled "Out-of-range UX" covering both directions. MIN_VIEWPORT_SPAN_MS exported from both `@caro/db` (server-authoritative) and `@caro/trend-chart` (mirrored, with cross-reference). Replaces the prior 10efccd entry (also propagated).

---

**Last cleared:** 2026-05-15. Audit walkthrough Phases 1-6 propagated to spec, handoff, and `platform_todo.md`; entries removed per discipline. Audit history in git: commits 355ffaa → f90d8c5 (Phase 2 through Phase 6 implementations) and the Phase 1 / Phase 5 doc-only commits.
