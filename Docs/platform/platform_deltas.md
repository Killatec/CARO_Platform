# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/README.md`.

---

**Last cleared:** 2026-10-17. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — Migration 018 adds `commanded_setpoints` (tag_id PK, value JSONB nullable = unpopulated, ack_status 'accepted'|'timeout', set_by stub, set_at), seeded once from `pending_setpoint_values`, plus `@caro/db` `upsertCommandedSetpoints` / `getCommandedSetpointsByTagIds`; not in `CARO_DB_Spec.md` (new §7.2; §2.4 migration list), `Docs/README.md` (migrations present, HMI tables) or `db_handoff.md`.
- 2026-10-18 — Setpoint re-delivery (startup, watchdog recovery) reads `commanded_setpoints` and sends only non-null values; SET_VALUES writes it on accepted ACK (`accepted`) and on timeout (`timeout`, all values), not on rejection; `pending_setpoint_values` still written on accepted ACK only and no longer read. `CARO_MQTT_Spec.md` §6.2/§6.3 and `CARO_Telemetry_Path_Reference.md` §3.3 still name `pending_setpoint_values`.
- 2026-10-18 — Exception to `Docs/README.md` "TagDef field consumption" (never walk `meta` for `tag_name`): the module-relative tag_name has no registry column, so it is derived from `meta` via `@caro/tag-registry-shared` `moduleRelativeTagName()` only — the one function shared by the Tag Defs export and the HMI TAG_LIST.
