# CARO_Platform — Open TODOs

**Purpose:** Implementation backlog only — features fully specified but not yet built. Design questions that are unresolved live in the relevant spec's Open Questions section. Remove items when complete.

**Updated:** 2026-05-14

---

## HMI

- [ ] **Step 12 — Tag picker drawer:** Side drawer with tag tree + type-ahead search (§11.2), multi-select commit (§11.3), trendable filter (§11.4). Depends on Step 11.
- [ ] Add NULL `prev` rate monitoring per `DB_Config_Usage_And_Perf.md` §8.1 — daily sample at 1-min bound; non-zero rate signals writer-cadence drift

### Trend Viewer — Deferred / Possible Future Improvements

- [ ] **WS trend listener is per-ingest, not per-COV (was audit H3, 2026-05-19).** Spec §4.4 diagram and handoff describe the listener as "calls `trendDeltaListener(moduleTs, tagId, value)` on every COV write for trendable tags," but the implementation fires once per MQTT ingest with `(moduleTs, moduleId)`. Specifically: `apps/caro-hmi/server/src/telemetry-intake.ts:41,110` defines the listener as `((moduleTs: number, moduleId: string) => void) | null` and calls `this.trendDeltaListener?.(message.timestamp, moduleId)` once per ingest; `apps/caro-hmi/server/src/ws-server.ts:123-148` (`handleTrendDelta`) then iterates **all trendable tags of the module** and pushes the current LKV value for each subscribing client, regardless of whether the tag's value changed. Effect: every HMI publish tick (250 ms) or MQTT frame produces a full per-module snapshot push into every subscribed client's outbox — not a COV-filtered stream — and the "synthetic on flush" path in `trendFlush` only ever fires for tags whose module produced no ingest in the flush window, making it the rare branch instead of the documented common branch. **Behavior is currently correct** (LOCF propagates correctly because every flush delivers the LKV); only the wire-shape contract and the per-client outbox growth model diverge from the docs. **Direction decision required:** either (a) update spec §4.4 and the handoff summary to match the as-built per-ingest behavior, or (b) change `TelemetryIntake.ingest()` to call the listener per-COV-write with `(moduleTs, tagId, value)` and update `WsServer.handleTrendDelta` to accept that signature. Option (a) is purely documentation; option (b) reduces outbox bandwidth at flatline modules at the cost of touching the ingest hot path.

- [ ] **Dead-tag detection / "stale tag" UI indicator.** With the LOCF cutoff query removed (was paying 814ms of planning time per CAG request at production scale), LOCF carries the last known value forward through all empty trailing buckets — a recently-stopped tag shows a flat line extending to the right edge of the requested window. See `hmi_trend_viewer_handoff.md` "Dead-tag detection" section for context and three replacement options under consideration: (1) per-tag freshness lookup alongside tile response; (2) watchdog contract guarantee (continuous NULL writes while telemetry silent); (3) per-tag freshness tag (`Trend_Info`-style). Likely combination of (2) + (1). Deferred until a user-facing complaint surfaces.

### Trend Viewer — Operational/observability watchlist

The Trend Viewer API and its test coverage are complete; these are operational monitoring items, not contract-level work.

- [ ] **Pool sizing watchlist (spec §15):** Monitor `@caro/db` Timescale pool utilization during multi-operator perf evaluation. Current default `max = 10` has not surfaced as a bottleneck in empirical testing — perf-page testing at `tag_count=24` (12 concurrent requests/cell) showed shared DB resources, not pool capacity, as the latency driver. Bump toward 20–30 only if pool exhaustion is observed in real multi-operator load. One-line config change in `packages/db/timescale/pool.ts`; sizing methodology in `Docs/DB_Config_Usage_And_Perf.md §10.5`.
- [ ] ~~**EXPLAIN-plan validation gate (spec §5.5)**~~ — superseded by `/dev/trends-perf` (perf test page provides client-observed latency across all CAG paths, the operationally meaningful gate). Bounded-prev chunk-pruning regression coverage now provided by the TG-1 plan-assertion test in `packages/db/__tests__/timescale/trends.test.ts` (added 2026-05-17 audit pass).
- [ ] **Flaky integration tests under cumulative DB load (surfaced 2026-05-17 audit pass).** Two integration tests began intermittently failing with hook timeouts during the audit remediation: (1) `getWatermarkMs — direct catalog query > tag_samples_10min_cagg: returns finite ms timestamp within expected range` (10s hook exceeded by ~44s), and (2) `getTrendTile — integration: 10s CAG branch > dispatches to source="10s_cagg" for the 8h window` (10s hook timeout). Both look like cumulative-DB-load symptoms — test-DB chunk count and shared catalog overhead growing across runs, not real defects. Same family as the unbounded-scan slowness in `getTrendExtent` (optimized 2026-05-17 via `ORDER BY ts ASC/DESC LIMIT 1` — MergeAppend short-circuits at first row, ~10-100× faster than the prior full-table `MIN/MAX`). Worth a focused operational pass: audit other unbounded scans, consider per-test chunk-truncate or sandbox-isolation strategies for the integration suite.

### Cross-cutting / platform

- [ ] **Re-evaluate error management platform-wide.** Current pattern across HMI routes (`tags.ts`, `trends.ts`, `reset.ts`) is bare-string error codes assigned via `err.code = 'X'`; `@caro/db` does the same in `codeError(...)` throws; `CaroError` (`@caro/server/errorHandler.ts`) carries them through to the platform envelope. The pattern is simple but has real shortcomings: no compile-time typo protection (`'INVALID_RAGNE'` compiles), no discoverability (must grep to enumerate all codes), no shared types for client-side consumers, and per-route hand-maintained HTTP-status maps (e.g., `routes/trends.ts:8-13`) that drift silently from the throwing module's actual code surface. Three improvements worth considering, in increasing scope: per-domain typed code constants (cheapest — each module exports its codes as `as const` maps); shared `throw*` helpers in `@caro/server` (reduce per-throw-site boilerplate); shared client-side error response types. The platform-wide cost is moderate (~week of refactor across HMI server + `@caro/db` + client error handling). Surfaced from `hmi_trend_viewer` audit B3#5 (2026-MM-DD).
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

- [ ] `packages/server` has no automated tests
