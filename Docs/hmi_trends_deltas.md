# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- `trends.ts` defensive bucket-count assertion removed entirely. Original assertion (n ∈ {bucketCount, bucketCount+1}) assumed CAG alignment; first loosening to [bucketCount, bucketCount+3] missed the case where Math.round rounds bucketSMs UP, producing n < bucketCount. Two production failures: start=1778856766968 → n=1003=bucketCount+3; start=1778859681100 → n=997=bucketCount-3. True range is approximately [bucketCount-3, bucketCount+3] for sub-second bucket widths; clients consume response.n directly so no tight bound is needed. Assertion removed; spec §6.2 simplified; regression tests cover both n>bucketCount and n<bucketCount directions.

---

**Last cleared:** 2026-05-15. Audit walkthrough Phases 1-6 propagated to spec, handoff, and `platform_todo.md`; entries removed per discipline. Audit history in git: commits 355ffaa → f90d8c5 (Phase 2 through Phase 6 implementations) and the Phase 1 / Phase 5 doc-only commits.
