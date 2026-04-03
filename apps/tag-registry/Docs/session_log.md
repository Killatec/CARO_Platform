# Session Log

## 2026-04-03 — E2E tests: validation-parent-types and trends

**Changes made:**
- `e2e/tests/validation-parent-types.spec.js` (new) — 4 tests: PARENT_TYPE_MISSING (no module ancestor), PARENT_TYPE_MISSING (no parameter ancestor), no errors when full hierarchy present (system→module→parameter→tag), DUPLICATE_PARENT_TYPE (two module levels in chain). Requires server/.env VALIDATE_REQUIRED_PARENT_TYPES=module,parameter and VALIDATE_UNIQUE_PARENT_TYPES=true (already set).
- `e2e/tests/trends.spec.js` (new) — 3 tests: trends column header visible, trends=false when no trends field in hierarchy, trends=true when module template has `trends: { field_type: 'Boolean', default: true }`.
- `HANDOFF.md` Section 6: total 512→533, two new E2E rows added.

**Spec deltas added:** yes — Delta 010 (Test Spec v1.1 missing both new spec files)
**Tests affected:** +21 E2E runs (7 tests × 3 browsers), 0 failures
**Docs that may need updating:** tag_registry_test_spec_v1_1.md → v1.2 (add §4.9 for both new spec files)
**Deferred / follow-up:** packages/db/__tests__/query.test.js — 5 withTransaction/pool tests (pre-HMI priority)

## 2026-04-02 — trends column, revision number, localStorage persist, spec docs v1.21

**Changes made:**
- `db/postgres/migrations/006_add_trends_to_tag_registry.sql` — new migration adding `trends BOOLEAN NOT NULL DEFAULT false` to `tag_registry`
- `shared/resolveRegistry.js` — `trends` derived from resolved meta chain (case-insensitive key match, value === true); included in each tag row
- `server/src/services/registryService.js` — `trends` added to INSERT (all 3 paths) and `isModified()` diff check
- `client/src/utils/diffRegistry.js` — `trends` added to `isModified()` and `getChangedFields()`
- `client/src/components/registry/RegistryTable.jsx` — `trends` column added between `is_setpoint` and `meta`; `dbRevision` state derived from `Math.max(...dbTags.map(t => t.registry_rev))`; "Rev. X" shown left of diff counts
- `client/src/components/panel/TemplatesTree.jsx` — expand/collapse state persisted to localStorage (`tag-registry:templates-tree:expanded`)
- Unit tests updated across shared/, server/, client/ — 505 total, 0 failures
- `tag_registry_api_spec_v1_14.md` → v1.15: §2.7 (GET /api/v1/config), `trends` in §5.1/§5.2/§6.2
- `docs/CARO_DB_Spec_v1_2.md` → v1.3: `trends` column in §3.1, migration 006 in §2.4
- `tag_registry_spec_v1_16.md` → v1.17: `trends` and root-to-tag meta in §4.2/§11.1/§14.1
- `tag_registry_bootstrap_v1_19.md` → v1.21: `trends` in §8.5, root-to-tag in §8.9, §8.10 (config wiring), §4.13 (server/.env authority)
- `HANDOFF.md` — Section 5 and 6 updated to reflect current test counts and doc versions

**Spec deltas added:** yes — Deltas 006, 007, 008, 009 all marked Resolved; server/.env delta marked Resolved
**Tests affected:** +93 unit tests across shared/, server/, client/
**Docs that may need updating:** none — all spec docs current at v1.17/v1.15/v1.21/v1.3
**Deferred / follow-up:** `packages/db/__tests__/query.test.js` — 5 withTransaction/pool tests (pre-HMI priority)

## 2026-04-02 — Change meta array order to root-to-tag

**Changes made:**
- `shared/resolveRegistry.js` — changed `walkHierarchy` to append `metaEntry` to
  `metaChain` (`[...metaChain, metaEntry]`) instead of prepending it, and changed
  the tag-level meta construction to append the tag entry. Meta array is now
  root-to-tag: `meta[0]` is the root, `meta[meta.length - 1]` is the tag.
- `shared/__tests__/resolveRegistry.test.js` — updated 3 tests: renamed the order
  test from "leaf-to-root" to "root-to-tag" and reversed expected index values;
  updated two field-resolution tests to access `meta[meta.length - 1]` for the tag
  entry instead of `meta[0]`.
- `apps/tag-registry/Docs/spec_delta.md` — Delta 007 added.

**Spec deltas added:** yes — Delta 007 (meta order changed to root-to-tag)
**Tests affected:** 3 shared tests updated; all 489 pass (112 shared + 88 server + 108 client + 6 db)
**Docs that may need updating:** tag_registry_spec_v1_16.md (meta array order description); CARO_DB_Spec_v1_2.md §3.1 (meta column)
**Deferred / follow-up:** Existing persisted DB rows from prior applies have leaf-to-root order; re-apply will update them

## 2026-04-02 — Unit tests for GET /api/v1/config

**Changes made:**
- `server/__tests__/config.test.js` — new file; 11 tests covering requiredParentTypes
  parsing (unset, single, multi, whitespace trim, empty-string filter, trailing comma)
  and uniqueParentTypes parsing (unset, true, TRUE, false, empty). Uses
  `node:http.createServer(createApp())` and Node 18 global fetch. Saves/restores
  both env vars in beforeEach/afterEach so tests are fully isolated.

**Spec deltas added:** no
**Tests affected:** server suite grows from 77 → 88 (11 new); all pass
**Docs that may need updating:** none
**Deferred / follow-up:** none

## 2026-04-02 — Wire VALIDATE_REQUIRED_PARENT_TYPES end-to-end via runtime config endpoint

**Changes made:**
- `server/src/routes/config.js` — new file; GET /api/v1/config handler parses
  VALIDATE_REQUIRED_PARENT_TYPES (comma-split, trim, filter) and
  VALIDATE_UNIQUE_PARENT_TYPES ("true" → true) from process.env and returns them
  in the standard response envelope.
- `server/src/app.js` — registered configRouter at /api/v1/config.
- `server/src/index.js` — added startup log lines for both optional env vars.
- `client/src/api/config.js` — new file; `fetchConfig()` via apiClient.get('/config').
- `client/src/stores/useUIStore.js` — added `validationConfig` initial state and
  `setValidationConfig()` action.
- `client/src/components/layout/AppShell.jsx` — added `useEffect` to fetch config
  on mount and call `setValidationConfig`.
- `client/src/hooks/useValidation.js` — replaced hardcoded empty options with values
  from `useUIStore(s => s.validationConfig)`; added both to useMemo deps array.
- `.env` and `.env.example` — set `VALIDATE_REQUIRED_PARENT_TYPES=module`.

**Spec deltas added:** yes — GET /api/v1/config not in API Spec v1.14; see spec_delta.md
**Tests affected:** none broken; all 297 unit tests pass (112 shared + 77 server + 108 client)
**Docs that may need updating:** API Spec v1.14 (new endpoint §4); Bootstrap v1.19
  (AppShell config fetch, useUIStore.validationConfig field)
**Deferred / follow-up:** none

## 2026-04-02 — Record TODO: query.test.js coverage for withTransaction()

**Changes made:**
- `docs/spec_delta.md` — appended TODO entry for `packages/db/__tests__/query.test.js`
- `apps/tag-registry/Docs/spec_delta.md` — same entry appended

**Spec deltas added:** no
**Tests affected:** none
**Docs that may need updating:** none
**Deferred / follow-up:** write query.test.js before HMI service development starts

## 2026-04-02 — Fix migrations.js path resolution bug

**Changes made:**
- `packages/db/migrations.js` — replaced `process.cwd()`-based migrations directory
  path with an `import.meta.url`-anchored `__dirname`. Path is now
  `packages/db/../../db/postgres/migrations`, which resolves correctly regardless of
  the process working directory. Previously resolved to
  `<cwd>/db/postgres/migrations`, which only worked when the server was started from
  the monorepo root; starting from `apps/tag-registry/server/` (normal dev workflow)
  caused an ENOENT crash on every startup.
- `docs/spec_delta.md` — bug fix note appended to Delta 005 resolution.

**Spec deltas added:** no
**Tests affected:** none — existing 6 db tests were unaffected (fs.readdirSync spied
  before bad path evaluated); all 303 unit tests still pass
**Docs that may need updating:** none
**Deferred / follow-up:** none

## 2026-03-29 — Resolve Delta 005: schema_migrations guard + migration 004 idempotency

**Changes made:**
- `packages/db/migrations.js` — added `schema_migrations` table (CREATE TABLE IF NOT
  EXISTS on every call). Before each migration, checks whether the filename is already
  recorded; if yes, logs and skips. If no, runs the migration SQL and records the
  filename in the same `withTransaction()` call, so a failed migration is never marked
  as applied. Imports `withTransaction` from `./query.js` (new import).
- `db/postgres/migrations/004_alter_tag_id_to_integer.sql` — wrapped the ALTER COLUMN
  in a PL/pgSQL DO block that checks `pg_attribute`/`pg_type` for `typname = 'int8'`
  before acting. If the column is already INTEGER the block exits silently. Safe to
  re-run even without the schema_migrations guard.
- `packages/db/__tests__/migrations.test.js` — rewrote test suite (4 → 6 tests) to
  cover guard behavior: schema_migrations table created on first run; already-applied
  migration is skipped; failed migration is not recorded; Delta 004 throw behavior
  preserved; filesystem edge cases retained.
- `docs/spec_delta.md` — Delta 005 logged and resolved.
- `apps/tag-registry/Docs/spec_delta.md` — cross-reference note added.
- Confirmed shared test suite location: `apps/tag-registry/shared/__tests__/` (112 tests).

**Spec deltas added:** no
**Tests affected:** packages/db (6 tests, up from 4); all 303 unit tests pass
  (112 shared + 77 server + 108 client + 6 db)
**Docs that may need updating:** Bootstrap §4.16 could note schema_migrations table;
  low priority — the guard is an implementation detail not visible in the API
**Deferred / follow-up:** Delta 002 (HMI tables) and Delta 003 (accepted) remain open

## 2026-03-29 — Resolve Delta 004: fail fast on migration errors

**Changes made:**
- `packages/db/migrations.js` — added `throw err` in the catch block so migration
  failures propagate to callers instead of being silently swallowed.
- `apps/tag-registry/server/src/index.js` — imported `runMigrations` from `@caro/db`;
  added try/catch block that calls `process.exit(1)` on failure, placed after the DB
  connectivity check and before `initializeIndex()`. Server cannot reach `app.listen()`
  if any migration fails.
- `packages/db/__tests__/migrations.test.js` — new test file with 4 unit tests covering:
  successful migrations, throw-on-failure, unreadable migrations directory, non-.sql
  file filtering.
- `packages/db/vitest.config.js` — new Vitest config for the db package.
- `packages/db/package.json` — added `test` script and `vitest` devDependency.
- `docs/spec_delta.md` Delta 004 marked resolved.
- `apps/tag-registry/Docs/spec_delta.md` updated with cross-reference note.

**Spec deltas added:** no
**Tests affected:** 4 new unit tests in packages/db/__tests__/migrations.test.js; all 301 unit tests pass (297 original + 4 new)
**Docs that may need updating:** none — Bootstrap §4.16 documents @caro/db; no behavior change visible to spec readers
**Deferred / follow-up:** Delta 002 (HMI tables) and Delta 003 (accepted) remain in docs/spec_delta.md

## 2026-03-29 — Resolve Delta 001: correct tag_id to INTEGER

**Changes made:**
- Created `db/postgres/migrations/004_alter_tag_id_to_integer.sql` — aligns
  `tag_registry.tag_id` with CARO_DB_Spec v1.2 §2.1/§3.1 (INTEGER, not BIGINT).
  Migration includes a DO block safety check: raises EXCEPTION if any existing
  tag_id value exceeds 2,147,483,647 before executing ALTER COLUMN TYPE INTEGER.
  Existing migration files (001–003) were not modified.
- No application code changes — `registryService.js` uses `Number()` coercion
  which is correct and harmless for both BIGINT (pg returns string) and INTEGER
  (pg returns JS number). No BIGINT references found in shared or client code.
- Updated `docs/spec_delta.md` Delta 001 status from Open → Resolved.
- Updated `apps/tag-registry/Docs/spec_delta.md` with resolution note.

**Spec deltas added:** yes — see apps/tag-registry/Docs/spec_delta.md
**Tests affected:** none (297 unit tests pass: 112 shared + 77 server + 108 client)
**Docs that may need updating:** none — CARO_DB_Spec v1.2 already says INTEGER
**Deferred / follow-up:** Delta 002 (HMI tables), Delta 003 (accepted), Delta 004
(runMigrations error handling) remain open in docs/spec_delta.md

## 2026-03-23 — Spec regeneration: v1.15/v1.18/v1.13/v1.0 → v1.16/v1.19/v1.14/v1.1

**Changes made:**
- Created tag_registry_spec_v1_16.md — applied deltas 1–17; updated tag_path definition, §9.1, §10.2 (template_name dot rule), §10.8 (EMPTY_BRANCH note), §12 (full Phase 2 diff UI detail), §14.1 (removed partial unique index), §16.1 (save bar editor-only + Update DB dirty), §16.9 (Phase 2 registry fetch), §16.10 (History page), §18 Phase Split table
- Created tag_registry_bootstrap_v1_19.md — added @caro/db package, db/ folder structure, Phase 2 routes and services, client utils and pages, §4.1 resolveRegistry rootName note, §4.13 PG* vars, §4.16 @caro/db detail, §4.17 apply transaction, §8.5 Phase 2 RegistryPage, §8.8 HistoryPage, §8.9 MetaModalBody, nodemon note, htmlFor/id notes, collapse toggle fix
- Created tag_registry_api_spec_v1_14.md — §2.5 identity note, §2.6 PG* vars replacing DATABASE_URL, §5.1 full GET /registry spec, §5.2 client-side diff note, §5.3 full POST /apply spec, §6.1–6.2 revision endpoints, §7 INVALID_TEMPLATE_NAME + VALIDATION_ERROR note
- Created tag_registry_test_spec_v1_1.md — §1 overview updated, §3.6 History navigation added, §4.7 tag_path prefix note, §4.8 four Phase 2 E2E spec sections, §4.9 four Phase 2 unit test sections, §5.13 inline helpers, §5.14 DB rows not cleaned up, §9.4 Phase 2 baseline (294 unit + 186 E2E runs), §10 unit test tables updated
- Deleted old versioned files (v1_15, v1_18, v1_13, v1_0)
- Cleared spec_delta.md — all 17 deltas applied
- Updated HANDOFF.md — new versions, Phase 2 complete, updated test counts, gotcha 9+10 added

**Spec deltas added:** no — this session applied all pending deltas to the spec documents
**Tests affected:** none — no code changes
**Docs that may need updating:** none — this session WAS the doc update
**Deferred / follow-up:** none

## 2026-03-22 — Phase 2 registry diff feature + db infrastructure

**Changes made:**
- Root dropdown disabled while dirty: added `disabled` prop to `@caro/ui` Dropdown; wired `isDirty` → disabled in AppShell.jsx with native tooltip; un-skipped save-cancel.spec.js test 4
- registry.spec.js test 5 rewritten: uses UI-based dot-in-asset-name to trigger INVALID_ASSET_NAME client-side (server rejected INVALID_REFERENCE approach)
- fields-panel.spec.js test 8 added: asserts asset name dirty color (orange) — expected to fail (known bug marker)
- Fixed asset name dirty color bug in FieldsPanel.jsx: passed `isDirtyField` prop to Asset Name FieldTableRow
- Appended Session Discipline section to apps/tag-registry/CLAUDE.md
- resolveRegistry.js: replaced hardcoded `'root.'` prefix with `rootName + '.'`; updated 4 unit test assertions and E2E tests 2/3/4
- Created db/postgres/migrations/001_create_tag_registry.sql and 002_create_registry_revisions.sql
- Created db/postgres/seeds/dev_seed.sql
- Created db/postgres/README.md
- Created db/timescale/ with README.md and .gitkeep
- Created db/postgres/scripts/setup_dev_db.ps1 (PowerShell, ASCII-only, UTF-8 no BOM)
- Created db/postgres/scripts/reset_dev_db.ps1
- Created packages/db/ workspace package (@caro/db): pool.js (lazy singleton), query.js, migrations.js, index.js, README.md, package.json
- Integrated @caro/db into tag-registry server: added dependency, added DB connectivity check in index.js start()
- Phase 2 registry diff feature:
  - server/src/services/registryService.js: `getActiveRegistry()` with DISTINCT ON query
  - server/src/routes/registry.js: GET /api/v1/registry
  - server/src/app.js: registered /api/v1/registry route
  - client/src/api/registry.js: `fetchRegistry()`
  - client/src/utils/diffRegistry.js: `diffRegistry(proposed, dbTags)` with added/modified/unchanged/retired statuses
  - client/src/pages/RegistryPage.jsx: diff useEffect, summary counts line, DB error warning banner, TODO placeholder
  - client/src/components/registry/RegistryTable.jsx: optional `rows` prop with diffStatus row coloring

**Spec deltas added:** yes — see spec_delta.md (items 6 through 10)
**Tests affected:** save-cancel.spec.js (test 4 un-skipped), registry.spec.js (test 5 rewritten, tests 2-4 updated), fields-panel.spec.js (test 8 added); resolveRegistry.test.js (4 assertions updated)
**Docs that may need updating:** API Spec v1.13 (Phase 2 GET /api/v1/registry), Functional Spec v1.15 (registry diff workflow), Bootstrap v1.18 (db/ folder structure, @caro/db package)
**Deferred / follow-up:** "Apply to DB" button and apply workflow; server-side resolveRegistry; registry_revisions increment logic; auth
