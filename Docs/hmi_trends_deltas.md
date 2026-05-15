# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries. The file should be empty or near-empty between sessions.

---

## Pending propagation

- `trends.ts` defensive bucket-count assertion removed entirely (commit 9899028; see history). `getTrendTile` and route restructured to skip bucketS validation when dispatchShape returns 'raw'. Pre-fix, small viewports (e.g., 205ms span at bucketCount=1000) produced bucketSMs=Math.round(205/1000)=0 → 400 INVALID_BUCKET_S, even though Phase 6 dispatch routes them to queryRaw where bucketSMs is unused. Fixed by moving bucketS validation into the bucketed branch only; route no longer derives bucketSMs at all (DB layer is authoritative). Spec §4.1, §6.1, §6.3 updated; regression test added (205ms window via raw COV succeeds).

---

**Last cleared:** 2026-05-15. Audit walkthrough Phases 1-6 propagated to spec, handoff, and `platform_todo.md`; entries removed per discipline. Audit history in git: commits 355ffaa → f90d8c5 (Phase 2 through Phase 6 implementations) and the Phase 1 / Phase 5 doc-only commits.
