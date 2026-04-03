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

## Delta 001 — tag_id column type: INTEGER vs BIGINT

**Spec:** CARO_DB_Spec v1.2, §2.1 and §3.1
**Spec says:** `tag_id` is described as "a uint32 (PostgreSQL INTEGER)" in §2.1.
The §3.1 column table shows type `INTEGER NOT NULL`.
**Implementation:** `db/postgres/migrations/001_create_tag_registry.sql` creates
`tag_id BIGINT NOT NULL` in the `tag_registry` table.
**Impact:** Low. BIGINT is a superset of INTEGER — no data can be stored in a
BIGINT column that couldn't be stored in a BIGINT application-side. The uint32
range (0–4 294 967 295) fits comfortably within BIGINT. The Tag Registry service
assigns tag_id as `MAX(tag_id) + 1` and tag counts will not approach either
limit in foreseeable use. However, any future HMI tables that hold a `tag_id
INTEGER` column (as the spec defines) would be type-mismatched with the
`tag_registry.tag_id BIGINT` column at the PostgreSQL layer if cross-table joins
or FK relationships are ever introduced.
**Status:** Resolved — 2026-03-29
**Resolution:** Migration `004_alter_tag_id_to_integer.sql` added. It first checks
that no existing `tag_id` value exceeds 2,147,483,647 (raises EXCEPTION and aborts
if so), then executes `ALTER TABLE tag_registry ALTER COLUMN tag_id TYPE INTEGER`.
No application code changes were required: `registryService.js` uses `Number()`
to coerce the DB value, which works correctly with both BIGINT (pg returns string)
and INTEGER (pg returns JS number). All 297 unit tests pass after the migration.
**Discovered:** 2026-03-29

---

## Delta 002 — HMI tables not yet implemented in migrations

**Spec:** CARO_DB_Spec v1.2, §4–§10
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
**Implementation:** Only three migrations exist:
- `001_create_tag_registry.sql`
- `002_create_registry_revisions.sql`
- `003_drop_active_path_index.sql`

None of the HMI tables (users through audit_log) have been created.
**Impact:** Expected — the CARO_HMI application has not been implemented yet.
The DB spec is ahead of the implementation by design, consolidating schema
definitions for both the Tag Registry Admin Tool (Phase 1/2 complete) and the
HMI backend (not yet started). When HMI development begins, migrations 004+
must be written for each HMI table in §4–§10.
**Status:** Open (by design — HMI not yet implemented)
**Discovered:** 2026-03-29

---

## Delta 003 — Partial unique index on tag_path created then dropped

**Spec:** CARO_DB_Spec v1.2, §3.1
**Spec says:** §3.1 lists constraints as: "Unique constraint on (tag_id,
registry_rev). GIN index on meta. B-tree indexes on tag_id, registry_rev,
data_type, retired." No partial unique index on `tag_path` is mentioned.
**Implementation:** Migration 001 created a partial unique index
`uq_tag_registry_active_path ON tag_registry (tag_path) WHERE retired = false`.
Migration 003 (`003_drop_active_path_index.sql`) subsequently dropped it.
The final state (after all three migrations run) matches the spec — the partial
index does not exist.
**Impact:** None — the migration sequence converges to the correct schema.
However, migration 001 temporarily creates a constraint that the spec does not
define, which would cause confusion for anyone running only migration 001.
**Status:** Accepted — final state matches spec. Consider removing the
CREATE UNIQUE INDEX from 001 and the DROP INDEX from 003 in a future
consolidation, though this requires care with databases that have already run
both migrations.
**Discovered:** 2026-03-29

---

## Delta 004 — runMigrations error handling: continues on failure

**Spec:** CARO_DB_Spec v1.2, §2.4
**Spec says:** "Migrations are idempotent (CREATE TABLE IF NOT EXISTS,
CREATE INDEX IF NOT EXISTS). Run in filename order using setup_dev_db.ps1."
The spec does not define error handling behavior for migration failures.
**Implementation:** `packages/db/migrations.js` — `runMigrations()` logs
migration errors and continues to the next file rather than halting and
re-throwing. A failed migration does not abort the sequence. The function
returns a results array where callers can inspect `{ file, status: 'error' }`
entries, but no caller currently checks this return value or fails startup
on migration errors.
**Impact:** Medium. A failed migration (e.g. due to a schema conflict or
syntax error) will be silently swallowed if the caller does not inspect the
results array. The application will start up against a partially-migrated
database, which may cause runtime errors or data corruption.
Recommendation: The app entry point (`server/src/index.js`) should check
the results array returned by `runMigrations()` and exit with a non-zero
code if any migration reported `status: 'error'`.
**Status:** Resolved — 2026-03-29
**Resolution:** Two changes made:
1. `packages/db/migrations.js` — added `throw err` after logging in the catch block,
   so any migration failure propagates to the caller instead of being swallowed.
2. `apps/tag-registry/server/src/index.js` — wrapped the new `runMigrations()` call
   in a try/catch that logs a startup-abort message and calls `process.exit(1)`,
   placed after the DB connectivity check and before `initializeIndex()`. The server
   never reaches `app.listen()` if any migration fails.
Unit test coverage added: `packages/db/__tests__/migrations.test.js` (4 tests).
All 301 unit tests pass (297 original + 4 new).
**Discovered:** 2026-03-29

---

## Delta 005 — No applied-migrations guard in runMigrations()

**Spec:** CARO_DB_Spec v1.2, §2.4
**Spec says:** "Migrations are idempotent (CREATE TABLE IF NOT EXISTS,
CREATE INDEX IF NOT EXISTS)." The spec implies migrations can be re-run safely
but does not define a mechanism to track which files have already been applied.
**Implementation:** `packages/db/migrations.js` — `runMigrations()` had no
applied-migrations guard. Every call ran every .sql file unconditionally.
This was a dormant bug before Delta 004: when errors were silently swallowed,
re-running idempotent migrations caused no visible harm. After Delta 004 landed
(fail-fast on error), a secondary consequence emerged: migration 004
(`004_alter_tag_id_to_integer.sql`) is not idempotent — the bare
`ALTER TABLE ... ALTER COLUMN ... TYPE INTEGER` throws if the column is already
INTEGER. Since runMigrations() now re-throws, the server crashes on every restart
after migration 004 has been applied once.
**Impact:** Critical — server cannot start after the first successful run of
migration 004. Blocked by Delta 004 fix.
**Status:** Resolved — 2026-03-29
**Resolution:** Two changes made:
1. `packages/db/migrations.js` — added `schema_migrations` table (created with
   `CREATE TABLE IF NOT EXISTS` on every call). Before each migration, checks
   whether the filename is already recorded. If yes, skips silently. If no, runs
   the migration SQL and records the filename in the same transaction via
   `withTransaction()`.
2. `db/postgres/migrations/004_alter_tag_id_to_integer.sql` — wrapped ALTER COLUMN
   in a PL/pgSQL DO block that checks `pg_attribute`/`pg_type` for `typname = 'int8'`
   before executing the ALTER. If the column is already INTEGER the block exits
   silently. Belt-and-suspenders alongside the schema_migrations guard.
Unit tests in `packages/db/__tests__/migrations.test.js` updated to cover guard
behavior (skip on second run, failed migration not recorded).
**Bug fix (2026-04-02):** The Delta 005 implementation used `process.cwd()` to
locate the migrations directory, which resolved correctly only when the process
was started from the monorepo root. When started from
`apps/tag-registry/server/` (the normal dev workflow), the path resolved to
`apps/tag-registry/server/db/postgres/migrations` — ENOENT. Fixed by replacing
`process.cwd()` with an `import.meta.url`-anchored `__dirname` so the path is
always `packages/db/../../db/postgres/migrations` regardless of cwd. The 6
migrations unit tests were unaffected because `fs.readdirSync` is spied before
the bad path could be evaluated.
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
