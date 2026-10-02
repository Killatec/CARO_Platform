# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/platform_handoff.md`.

---

**Last cleared:** 2026-09-20. Multi-project model (`PROJECT_ROOT` gate, per-project databases) and the two-layer env-loading model (`loadEnv()` from `@caro/server/env`) propagated to `platform_handoff.md` (new § Multi-Project Model, updated Platform Rules § Env files, Database section, Packages table) and root `CLAUDE.md`. `apps/caro-hmi/server/src/config.ts`'s `loadEnv()` migration and the transitively-affected `packages/db/timescale/trends.ts` module-scope fix propagated to `hmi_trend_viewer_handoff.md` and `db_handoff.md`.

- **2026-10-01 — `i32` data type:** Migration 017 adds `('i32','Int 32')` to `tag_types` (`CARO_DB_Spec.md` §283 valid-types note, `db_handoff.md` migration list, `platform_handoff.md` Applied list). On the wire `i32` uses the existing `TagValue.int_value` (`int32`) — `CARO_MQTT_Spec.md` §360 should say `int_value` carries both `i16` and `i32`; no proto change. HMI scalar type list in `hmi_functional_spec.md` §257 gains `i32` (no HMI code change — HMI is type-agnostic for numerics).
