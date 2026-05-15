# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- `trends.ts` defensive assertion at ~line 714 loosened: `n ∈ {bucketCount, bucketCount+1}` → `n ∈ [bucketCount, bucketCount+3]`. CAG sources still produce n ∈ {bucketCount, bucketCount+1}; raw-source bucketed path (`tag_samples`, sub-second widths from `Math.round`) can produce up to bucketCount+3 (validated in production: start=1778856766968, end=1778856929260, bucketCount=1000 → n=1003). When `Math.round` rounds down, `q=span/bucketSMs>bucketCount`; with endpoint floor variance of ±1, max n = floor(q)+2 ≤ bucketCount+3. Spec §6.2 updated. Regression test added.

---

**Last cleared:** 2026-05-15. Audit walkthrough Phases 1-6 propagated to spec, handoff, and `platform_todo.md`; entries removed per discipline. Audit history in git: commits 355ffaa → f90d8c5 (Phase 2 through Phase 6 implementations) and the Phase 1 / Phase 5 doc-only commits.
