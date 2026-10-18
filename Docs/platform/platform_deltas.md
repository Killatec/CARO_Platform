# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/README.md`.

---

**Last cleared:** 2026-10-17. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — Migration 018 adds `commanded_setpoints` (tag_id PK, value JSONB nullable = unpopulated, ack_status 'accepted'|'timeout', set_by stub, set_at), seeded once from `pending_setpoint_values`, plus `@caro/db` `upsertCommandedSetpoints` / `getCommandedSetpointsByTagIds`; not in `CARO_DB_Spec.md` (new §7.2; §2.4 migration list), `Docs/README.md` (migrations present, HMI tables) or `db_handoff.md`.
