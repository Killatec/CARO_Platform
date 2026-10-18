# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/README.md`.

---

**Last cleared:** 2026-10-17. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — Migration 018 adds `commanded_setpoints` (tag_id PK, value JSONB nullable = unpopulated, ack_status 'accepted'|'timeout', set_by stub, set_at), seeded once from `pending_setpoint_values`, plus `@caro/db` `upsertCommandedSetpoints` / `getCommandedSetpointsByTagIds`; not in `CARO_DB_Spec.md` (new §7.2; §2.4 migration list), `Docs/README.md` (migrations present, HMI tables) or `db_handoff.md`.
- 2026-10-18 — Setpoint re-delivery (startup, watchdog recovery) reads `commanded_setpoints` and sends only non-null values; SET_VALUES writes it on accepted ACK (`accepted`) and on timeout (`timeout`, all values), not on rejection; `pending_setpoint_values` still written on accepted ACK only and no longer read. `CARO_MQTT_Spec.md` §6.2/§6.3 and `CARO_Telemetry_Path_Reference.md` §3.3 still name `pending_setpoint_values`.
- 2026-10-18 — `upsertCommandedSetpoints` entries take optional `set_by` (omitted = NULL, overwriting on every upsert) and `getCommandedSetpointsByTagIds` returns it; new `scripts/import-rf1-sets.js` (+ `scripts/data/rf1-sets-map.json`, legacy key → RF1 module-relative tag_name) imports `RF1_Sets.json` into `commanded_setpoints` as `accepted` / `set_by 'import:RF1_Sets.json'` (dry run unless `--apply`; applied 2026-10-18 to `narya1_postgres`: 100 of 127 RF1 Sets). Not in `db_handoff.md` or `CARO_DB_Spec.md`.
- 2026-10-18 — Backend handshake built to the module-side contract (`CARO_MQTT_Interface` `Docs/BACKEND_HANDSHAKE_PROMPT.md`), not to `CARO_MQTT_Spec.md` §3/§6.1/§7 (v1.9; ICD edits pending owner approval): topics `handshake_module` (module → backend) / `handshake_backend` (backend → module); module-initiated `HANDSHAKE_REQUEST` carrying identity (unchecked; `tag_registry_rev` reserved); TAG_LIST entries carry `is_setpoint`; CONFIRM carries `missing_ids` / `unknown_tags` / `truncated`, no hashes; new REHANDSHAKE; Set push + REQUEST_SNAPSHOT after CONFIRM (REQUEST_SNAPSHOT on connect kept for all modules). Deviation from that contract's M5 (owner decision): `/beat` is never withheld; REHANDSHAKE on every broker connect instead. §1.1 still says the handshake is not implemented.
- 2026-10-18 — Exception to `Docs/README.md` "TagDef field consumption" (never walk `meta` for `tag_name`): the module-relative tag_name has no registry column, so it is derived from `meta` via `@caro/tag-registry-shared` `moduleRelativeTagName()` only — the one function shared by the Tag Defs export and the HMI TAG_LIST.
