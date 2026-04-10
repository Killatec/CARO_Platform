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

- module_types lookup table added (migration 010); ModuleType field type added to tag-registry shared/server/client; module templates now require Module_Type field
- module and module_type columns added to tag_registry (migration 011); resolved from meta chain during registry apply; displayed in RegistryTable UI with sort and diff support
- module_types lookup table added (migration 010) with HMI and MQTT seed rows; getModuleTypes() and ModuleType interface added to @caro/db and exported from index
