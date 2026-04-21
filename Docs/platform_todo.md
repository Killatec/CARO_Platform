# CARO_Platform — Open TODOs

**Purpose:** Implementation backlog only — features fully specified but not yet built. Design questions that are unresolved live in the relevant spec's Open Questions section. Remove items when complete.

**Updated:** 2026-04-21

---

## HMI

- [ ] Create HMI database migrations (005+) for all HMI tables: `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `pending_setpoint_values`, `system_settings`, `audit_log`
- [ ] Periodic Timescale reconnect — NullDbWriter → TimescaleDbWriter retry after failed boot ping (currently requires HMI restart)
- [ ] Trends READ endpoint — `GET /api/v1/trends/{tag_id}` (write path via `DbPipeline` → `TimescaleDbWriter` is complete; query/aggregation read endpoint not started)
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
