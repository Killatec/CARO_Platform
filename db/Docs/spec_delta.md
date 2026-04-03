# CARO Platform — Spec Delta

Tracks divergences between spec documents in `docs/` and the actual
implementation across the monorepo. Append new entries as divergences
are discovered or introduced. Never delete old entries.

Format per entry:
- **Spec:** document name + version, section
- **Spec says:** what the spec defines
- **Implementation:** what the code actually does
- **Impact:** risk / consequence
- **Status:** open | resolved | accepted
- **Discovered:** date

---

## Delta 002 — HMI tables not yet implemented in migrations

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
**Implementation:** Only four migrations exist:
- `001_create_tag_registry.sql`
- `002_create_registry_revisions.sql`
- `003_drop_active_path_index.sql`
- `004_alter_tag_id_to_integer.sql`

None of the HMI tables (users through audit_log) have been created.
**Impact:** Expected — the CARO_HMI application has not been implemented yet.
The DB spec is ahead of the implementation by design, consolidating schema
definitions for both the Tag Registry Admin Tool (Phase 1/2 complete) and the
HMI backend (not yet started). When HMI development begins, migrations 005+
must be written for each HMI table in §4–§10.
**Status:** Open (by design — HMI not yet implemented)
**Discovered:** 2026-03-29

---

## TODO — packages/db/__tests__/query.test.js

**Priority:** Complete before HMI service development starts
**Scope:** `packages/db/query.js` — the `withTransaction()` helper and `pool.query()` wrapper

Write unit tests covering:

1. `withTransaction()` — ROLLBACK is called if `fn(client)` throws
2. `withTransaction()` — client is released even if ROLLBACK itself fails
3. `withTransaction()` — original error is re-thrown after ROLLBACK
4. `withTransaction()` — COMMIT is called on success and client is released
5. `pool.js` proxy — lazy singleton initializes only once (lower priority)

**Note on mock strategy:**
Current migrations.test.js mocks at the `fs.readdirSync` level, which means
path construction bugs are invisible to the test suite. For query.test.js,
assert on the actual arguments passed to the pg client mock via
`mockClient.mock.calls` to avoid the same blind spot.

**Context:**
`withTransaction()` will be load-bearing for HMI tables that require
transactional integrity — audit_log, setpoint_values, pending_setpoint_values.
Coverage must exist before those services are written.
