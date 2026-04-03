# Spec Delta — Pending Updates to Word Documents

Changes made during implementation that diverge from or are
not covered by the current spec docs. Clear each item after
the corresponding Word document has been updated.

---

All deltas through delta 010 have been applied to:
- Functional Spec v1.17 (`tag_registry_spec_v1_17.md`)
- Bootstrap v1.21 (`tag_registry_bootstrap_v1_21.md`)
- API Spec v1.15 (`tag_registry_api_spec_v1_15.md`)
- Test Spec v1.2 (`tag_registry_test_spec_v1_2.md`)
- CARO DB Spec v1.3 (`db/Docs/CARO_DB_Spec_v1_3.md`)

## Delta 010 — E2E tests for validation-parent-types and trends not in Test Spec v1.1

**Date:** 2026-04-03
**Spec:** tag_registry_test_spec_v1_1.md §4 (test files and coverage)
**Delta:** Two new Playwright E2E spec files were added:
- `e2e/tests/validation-parent-types.spec.js` — 4 tests covering `PARENT_TYPE_MISSING` (missing module ancestor, missing parameter ancestor, no errors when both present) and `DUPLICATE_PARENT_TYPE` (two module ancestors). Requires `VALIDATE_REQUIRED_PARENT_TYPES=module,parameter` and `VALIDATE_UNIQUE_PARENT_TYPES=true` in `server/.env`.
- `e2e/tests/trends.spec.js` — 3 tests covering the `trends` column header visibility, `false` when no trends field exists anywhere in the hierarchy, and `true` when a module-level field carries `trends: { field_type: 'Boolean', default: true }`.
Total new runs: 21 (7 tests × 3 browsers). Test Spec §4 has no corresponding sections for either file.
**Action:** Add §4.9 (or similar) to Test Spec v1.1 documenting both new spec files. Bump test spec to v1.2.
**Status:** Resolved 2026-04-02 — §4.8.5 and §4.8.6 added to Test Spec v1.2; §9.5 Phase 3 baseline added.

### server/.env is the authoritative env file — root .env is not loaded (2026-04-02)
**Date:** 2026-04-02
**Spec:** tag_registry_bootstrap_v1_19.md §4.13 (PG* vars), CLAUDE.md (env table)
**Delta:** `server/src/index.js` calls `dotenv.config()` with no path argument.
When the server starts from `apps/tag-registry/server/` (the normal dev workflow),
dotenv loads `apps/tag-registry/server/.env` — not the root `.env`. Any variable
set only in the root `.env` is silently absent from `process.env`.
`VALIDATE_REQUIRED_PARENT_TYPES=module` was added to the root `.env` in a prior
session but the server never saw it; the feature appeared non-functional until
`apps/tag-registry/server/.env` was updated directly.
**Action:** Keep `apps/tag-registry/server/.env` as the single source of truth for
server env vars. The root `.env` / `.env.example` can be considered documentation
only unless the server startup path changes.
**Status:** Resolved 2026-04-02 — Bootstrap v1.21 §4.13 updated with authoritative env file note.

---

### GET /api/v1/config — new endpoint not in API Spec v1.14 (2026-04-02)
**Date:** 2026-04-02
**Spec:** tag_registry_api_spec_v1_14.md (no corresponding section)
**Delta:** A new endpoint `GET /api/v1/config` was added to expose runtime
validation configuration to the client. Response envelope:
```json
{ "ok": true, "data": { "requiredParentTypes": ["module"], "uniqueParentTypes": false } }
```
Parsing: `VALIDATE_REQUIRED_PARENT_TYPES` split on comma, trimmed, empty strings
filtered; `VALIDATE_UNIQUE_PARENT_TYPES` is `"true"` (case-insensitive) → true,
else false. Route registered at `server/src/routes/config.js`.
The client fetches this on mount in `AppShell.jsx` and stores the result in
`useUIStore.validationConfig`. `useValidation.js` reads from the store instead of
using hardcoded empty options.
**Action:** Add §4 (or similar) to `tag_registry_api_spec_v1_14.md` documenting
this endpoint. Also update Bootstrap §8 to note the `AppShell` config fetch and
`useUIStore.validationConfig` field.
**Status:** Resolved 2026-04-02 — superseded by Delta 006 (see below), which is the numbered version of this entry. Documented in API Spec v1.15 §2.7 and Bootstrap v1.21 §8.10.

Note: `db/Docs/spec_delta.md` Delta 004 (runMigrations fail-fast) was also resolved
in a prior session — see that file for details. Changes affected `packages/db/` and
`apps/tag-registry/server/src/index.js`, not the tag-registry spec documents
themselves. No tag-registry spec doc update required.

Note: `db/Docs/spec_delta.md` Delta 005 (no applied-migrations guard) was resolved
2026-03-29. `packages/db/migrations.js` now tracks applied migrations in a
`schema_migrations` table. Any app using `@caro/db` gains this guard automatically.
`db/postgres/migrations/004_alter_tag_id_to_integer.sql` was also made idempotent.
No tag-registry spec doc update required — the Bootstrap documents @caro/db behavior
at a higher level than internal migration tracking.

---

## Delta 008 — trends column in tag_registry not in CARO_DB_Spec_v1_2.md

**Date:** 2026-04-02
**Spec:** CARO_DB_Spec_v1_2.md §3.1 (tag_registry table definition)
**Delta:** A new `trends BOOLEAN NOT NULL DEFAULT false` column was added to `tag_registry` via migration `006_add_trends_to_tag_registry.sql`. The column is populated by `resolveRegistry()` (shared): `true` if any level in the resolved meta chain has a field key matching `"trends"` (case-insensitive) with a value of `true` after instance override resolution; `false` otherwise. `registryService.js` includes `trends` in all three INSERT statements (added, modified, retired rows) and in the `isModified()` diff check.
**Impact:** CARO_DB_Spec_v1_2.md §3.1 table is missing the `trends` column. The migration convention is already documented in §2.4 — migration 006 follows those conventions.
**Status:** Resolved 2026-04-02 — `trends` column added to CARO_DB_Spec_v1_3.md §3.1; migration 006 listed in §2.4.

---

## Delta 009 — trends field in registry API responses not in API Spec v1.14

**Date:** 2026-04-02
**Spec:** tag_registry_api_spec_v1_14.md §5 (registry endpoints — GET /api/v1/registry, GET /api/v1/registry/revisions/:rev)
**Delta:** Both `GET /api/v1/registry` and `GET /api/v1/registry/revisions/:rev` now include a `trends` boolean field on each tag row in their response payloads. The client `diffRegistry.js` utility also checks `trends` in `isModified()` and includes it in `changedFields`. The `RegistryTable` component renders a `trends` column between `is_setpoint` and `meta`.
**Impact:** The API spec response shapes for both endpoints are missing the `trends` field. Client tests and server tests have been updated to include `trends` in mock shapes.
**Status:** Resolved 2026-04-02 — `trends` added to §5.1 and §6.2 response examples and §5.2 changedFields list in API Spec v1.15. `trends` column added to Functional Spec v1.17 §14.1 and Bootstrap v1.20 §8.5.

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

---

## Delta 007 — meta array order changed to root-to-tag

**Spec:** tag_registry_spec_v1_16.md (§ describing meta array); CARO_DB_Spec_v1_2.md §3.1 (meta column)
**Spec says:** meta array is ordered leaf-to-root — the tag entry is first (`meta[0]`), the root entry is last.
**Implementation:** `shared/resolveRegistry.js` was changed so the meta array is ordered root-to-tag — the root entry is first (`meta[0]`), the tag entry is last (`meta[meta.length - 1]`). The accumulation in `walkHierarchy` changed from prepend (`[metaEntry, ...metaChain]`) to append (`[...metaChain, metaEntry]`), and the tag entry changed from prepend to append at the leaf.
**Impact:** Any consumer that indexes into the meta array by position (e.g. `meta[0]` to get the tag's own fields) will now get the root entry instead. The DB column stores the array as JSONB — existing persisted rows are unaffected unless re-applied. Consumers should use `meta[meta.length - 1]` for the tag entry or `meta[0]` for the root entry.
**Status:** Resolved 2026-04-02 — meta order updated to root-to-tag in Functional Spec v1.17 §4.2, §11.1, §14.1 and Bootstrap v1.20 §8.9.
**Discovered:** 2026-04-02

---

## Delta 006 — GET /api/v1/config endpoint not in API spec

**Spec:** tag_registry_api_spec_v1_14.md
**Spec says:** No config endpoint is defined. The spec documents `VALIDATE_REQUIRED_PARENT_TYPES` and `VALIDATE_UNIQUE_PARENT_TYPES` as server-side env vars (§2.6) with no mechanism for communicating them to the client.
**Implementation:** `server/src/routes/config.js` exposes `GET /api/v1/config` returning `{ requiredParentTypes: string[], uniqueParentTypes: boolean }` parsed from the two env vars. `AppShell.jsx` fetches this on mount and stores it in `useUIStore.validationConfig`. `useValidation.js` reads from the store and passes the values to `validateParentTypes()`.
**Impact:** Low. The endpoint is additive and read-only. No existing contract is broken. The API spec should be updated to document this endpoint in a future revision.
**Status:** Resolved 2026-04-02 — documented as §2.7 in API Spec v1.15. Bootstrap v1.21 §8.10 documents the client-side wiring (AppShell fetch, useUIStore.validationConfig, useValidation.js consumption).
**Discovered:** 2026-04-02

---

### DB access centralized (2026-04-03)
- All inline SQL removed from app code
- registryService.js now delegates to @caro/db named functions
- ping(), getRevisions(), getRevisionTags(), applyRegistryRevision() imported from @caro/db
- No behavioral changes — all 3 endpoints confirmed healthy

---

### tag_id column type corrected to INTEGER (2026-03-29)
**Date:** 2026-03-29
**Spec:** CARO_DB_Spec v1.2, §2.1/§3.1 (authoritative — lives in `docs/`)
**Delta:** Migration 001 created `tag_registry.tag_id` as `BIGINT`. The platform
DB spec defines it as `INTEGER` (uint32, max 2,147,483,647).
**Resolution:** Added `db/postgres/migrations/004_alter_tag_id_to_integer.sql`.
Includes a safety check that raises EXCEPTION if any existing value exceeds
2,147,483,647 before executing the ALTER. No application code changes needed.
`registryService.js` `Number()` coercion works correctly with both column types.
All 297 unit tests pass.
**Action:** No tag-registry spec doc update required — this divergence was tracked
in `db/Docs/spec_delta.md` Delta 001 (now resolved). The tag-registry Bootstrap §4.1
and related sections already document tag_id as a standard JS number.
