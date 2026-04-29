# CARO_Platform — Open TODOs

**Purpose:** Implementation backlog only — features fully specified but not yet built. Design questions that are unresolved live in the relevant spec's Open Questions section. Remove items when complete.

**Updated:** 2026-04-29

---

## HMI

- [ ] **Step 10 — Mode state machine + time-range UI (active next build):** Tailing/fixed mode transitions (§9.3), preset strip 15m/1h/4h/24h/7d/14d (§12.1), custom range picker (§12.2), Live button (§12.3), pan/zoom interactions (§9.1–9.2). First production wiring of `useTrendData`. Still no WS. Build order in `Docs/hmi_trend_viewer_spec.md` §17.1.1 steps 10–12.
- [ ] Add NULL `prev` rate monitoring per `DB_Config_Usage_And_Perf.md` §8.1 — daily sample at 1-min bound; non-zero rate signals writer-cadence drift

### Trend Viewer — Deferred / Possible Future Improvements

These three items were specified for Phase A (§17.1.1 steps 5 and 13) but deferred by explicit decision (2026-04-29). The Trend Viewer API and its test coverage are complete; these are observability, operational sizing, and one-shot validation — not contract-level work.

- [ ] **Pool sizing optimization (§15):** Bump `@caro/db` Timescale pool from `max = 10` to 20–30 per spec §15. Recommended before multi-operator production rollout. One-line config change in `packages/db/timescale/pool.ts`. Empirical sizing test recommended (`Docs/DB_Config_Usage_And_Perf.md` §10.5) before settling on the exact value. Deferred 2026-04-29.
- [ ] **Server-side per-tile perf log (§14.7):** Update the existing `TIMESCALE_LOG_TILE_QUERIES` gate in `packages/db/timescale/trends.ts` to emit the spec-compliant log line including the `source` field (covers raw / each CAG name / 'mixed' for fall-through). Roughly 10–20 lines; currently emits a v0.3-era format. Deferred 2026-04-29.
- [ ] **EXPLAIN-plan validation gate (§5.5):** Run `EXPLAIN (BUFFERS, ANALYZE)` on a representative bounded-prev query against production-state Timescale and confirm ≤ 2 chunks in the prev SubPlan ChunkAppend, planning time < 5 ms. Execute once `tag_samples` has ≥ ~100 chunks (~4 days of production writes); not ongoing CI — a one-shot milestone check. Deferred 2026-04-29. [SUPERSEDED 2026-04-29 by `/dev/trends-perf` — perf test page provides client-observed latency across all CAG paths, which is the operationally meaningful gate.]
- [ ] **DB contention at high concurrency (observation):** perf-page testing at tag_count=24 (12 concurrent reqs/cell) pushed per-request latency 2–4× higher than at tag_count=8. Pool=10 is not the bottleneck; root cause is shared DB resources under many concurrent queries. Watch in production multi-operator scenarios; revisit if user-visible. Pool bump to 20–30 (tracked in deferred items above) may help but is not the primary lever.
- [ ] Create HMI database migrations (005+) for all HMI tables: `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `pending_setpoint_values`, `system_settings`, `audit_log`
- [ ] Periodic Timescale reconnect — NullDbWriter → TimescaleDbWriter retry after failed boot ping (currently requires HMI restart)
- [ ] `DbPipeline`: remove legacy `flush()` / `queueSize` public aliases (currently referenced in `telemetry-intake.test.ts`; rename or internalize in a dedicated cleanup pass)
- [ ] User management endpoints — no user CRUD endpoints exist yet
- [ ] Dashboard config schema and `DashboardRenderer` component

---

## Tag Registry

- [ ] `EMPTY_BRANCH` validation code declared in `shared/constants.ts` but never emitted — implement or remove
- [ ] `applied_by` hardcoded to `'dev'` — no authentication system; depends on HMI auth being built first

---

## MQTT Simulator

- [ ] RESET command — `CMD_ACK` is published but tag values are not reset to defaults
- [ ] REST override feature — `overridden: boolean` field exists in module status shape but the override endpoint is not built

---

## MQTT Devices

- [ ] Implement deadband before publishing COV tag changes in device firmware to reduce historian churn and bus traffic.

---

## Platform / Packages

- [ ] `packages/server` and `packages/ui` have no automated tests
