# CARO_Platform — Open TODOs

**Purpose:** Implementation backlog only — features fully specified but not yet built. Design questions that are unresolved live in the relevant spec's Open Questions section. Remove items when complete.

**Updated:** 2026-04-07

---

## HMI

- [ ] Create HMI database migrations (005+) for all HMI tables: `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `pending_setpoint_values`, `system_settings`, `audit_log`
- [ ] Trends endpoint — `GET /api/v1/trends/{tag_id}` (TimescaleDB backend, query params, aggregation)
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

## Platform / Packages

- [ ] `packages/server` and `packages/ui` have no automated tests
