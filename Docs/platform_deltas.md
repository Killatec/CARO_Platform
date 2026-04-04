# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside Docs/platform_handoff.md.

---

## Delta P-001 — HMI tables not yet implemented in migrations

**Spec:** CARO_DB_Spec v1.3, §4–§10
**Spec says:** The following tables are fully specified:
- §4.1 `users`
- §4.2 `sessions` (connect-pg-simple managed)
- §5.1 `commissioned_modules`
- §6.1 `operation_modes`
- §6.2 `mode_revisions`
- §6.3 `setpoint_values`
- §7.1 `pending_setpoint_values`
- §8.1 `system_settings`
- §10.1 `audit_log`

**Implementation:** Only these migrations exist:
- `001_create_tag_registry.sql`
- `002_create_registry_revisions.sql`
- `003_drop_active_path_index.sql`
- `004_alter_tag_id_to_integer.sql`
- `006_add_trends_to_tag_registry.sql`

None of the HMI tables (users through audit_log) have been created.
**Impact:** Expected — CARO_HMI has not been implemented yet. When HMI development begins, migrations 005+ must be written for each HMI table in §4–§10.
**Status:** Open (by design — HMI not yet implemented)
**Discovered:** 2026-03-29

---

## TODO P-001 — packages/db/__tests__/query.test.js

**Priority:** Complete before HMI service development starts
**Scope:** `packages/db/query.js` — the `withTransaction()` helper and `pool.query()` wrapper

Write unit tests covering:
1. `withTransaction()` — ROLLBACK is called if `fn(client)` throws
2. `withTransaction()` — client is released even if ROLLBACK itself fails
3. `withTransaction()` — original error is re-thrown after ROLLBACK
4. `withTransaction()` — COMMIT is called on success and client is released
5. `pool.js` proxy — lazy singleton initializes only once (lower priority)

**Note:** Also tracked in `apps/tag-registry/Docs/tag_registry_deltas.md` TODO-001. The canonical entry is here — packages/db is platform-level code.

**Mock strategy:** Assert on actual arguments passed to the pg client mock via `mockClient.mock.calls`. Current migrations.test.js mocks at `fs.readdirSync` level — avoid the same blind spot.

**Context:** `withTransaction()` will be load-bearing for HMI tables requiring transactional integrity — audit_log, setpoint_values, pending_setpoint_values. Coverage must exist before those services are written.
