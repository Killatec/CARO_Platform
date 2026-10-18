# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/README.md`.

---

**Last cleared:** 2026-10-17. `i32` data type propagated → `CARO_DB_Spec.md` valid-types note (rewritten to the post-017 set, also catching up migration 014) + migration list (016, 017 added); `db_handoff.md` migration list; `README.md` Database section; `CARO_MQTT_Spec.md` `int_value` carries `i16` and `i32`; `hmi_functional_spec.md` scalar type list.

**Last cleared:** 2026-09-20. Multi-project model (`PROJECT_ROOT` gate, per-project databases) and the two-layer env-loading model (`loadEnv()` from `@caro/server/env`) propagated to `platform_handoff.md` (new § Multi-Project Model, updated Platform Rules § Env files, Database section, Packages table) and root `CLAUDE.md`. `apps/caro-hmi/server/src/config.ts`'s `loadEnv()` migration and the transitively-affected `packages/db/timescale/trends.ts` module-scope fix propagated to `hmi_trend_viewer_handoff.md` and `db_handoff.md`.

