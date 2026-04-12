# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/platform_handoff.md`.

---

## Delta P-001 — HMI tables not yet implemented

**Spec:** CARO_DB_Spec §4–§10
**Status:** Open (by design — HMI not yet started)
**Detail:** Migrations for `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `pending_setpoint_values`, `system_settings`, `audit_log` not yet created. Will be added when HMI development begins.

---

## Delta PL-002 — All servers run DB migrations at startup

**Spec:** platform_handoff.md, hmi_bootstrap.md, mqtt_simulator_bootstrap.md
**Status:** Open
**Detail:** `runMigrations()` from `@caro/db` is now called at startup in all three servers (tag-registry, caro-hmi, mqtt-simulator). Advisory lock `pg_advisory_lock(1)` in `packages/db/migrations.ts` prevents concurrent migration races when all three servers start simultaneously. Each server calls `ping()` first to verify DB connectivity, then `runMigrations()`, failing fast with `process.exit(1)` on error before any app-level init runs.

---

