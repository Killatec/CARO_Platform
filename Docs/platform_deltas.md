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

## Delta: @caro/db migrations path fix post-TypeScript migration

**Date:** 2026-04-05
**Status:** Complete

- Root cause: migrations directory path was constructed with 2 `../` hops, correct from `src/` but landing in `packages/db/db/postgres/migrations/` when running from compiled `dist/`
- Fix: increased to 3 hops (`'../../../db/postgres/migrations'`) to correctly traverse `dist/` → `packages/db/` → `packages/` → repo root → `db/postgres/migrations/`
- Also corrected: `path` default import replaced with named imports (`dirname`, `resolve`); explicit `__filename` via `fileURLToPath(import.meta.url)` added
- Verified: all 5 migrations show "already applied, skipping", server initializes fully
- Rule: whenever `@caro/db` path resolution changes, verify from `dist/` not `src/`

---

## Delta: @caro/ui TypeScript migration

**Date:** 2026-04-05
**Status:** Complete

- All source files migrated to `.ts`/`.tsx`, zero `tsc` errors, `strict: true`
- All components typed as `React.FC<Props>`, props extend native HTML attribute interfaces for correct ref/spread behavior
- `TooltipProps` uses `Omit<HTMLAttributes<HTMLDivElement>, 'content'>` — required because `HTMLAttributes` inherits `content?: string` from the HTML spec, conflicting with `content?: ReactNode`
- `ApiResponse<T>` defined as a discriminated union: `{ ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } }` — canonical platform envelope type, lives in `@caro/ui`
- `details?` added to error branch to match `CaroError` in `@caro/server`
- Build output: `packages/ui/dist/`

---

## Delta: @caro/server TypeScript migration

**Date:** 2026-04-05
**Status:** Complete

- All source files migrated to `.ts`, zero `tsc` errors, `strict: true`
- `AsyncHandler` type defined to accept both sync and async Express handlers
- `CaroError` interface extends `Error` with `code?`, `status?`, `details?` — all three fields were already read in the implementation; strict mode surfaced the missing declarations
- `exports` map in `package.json` updated: old entries pointed to `./src/*.js`; now point to `./dist/*.js` with explicit `"types": "./dist/*.d.ts"` conditions for NodeNext sub-path resolution (`@caro/server/asyncWrap`, `@caro/server/errorHandler`)
- Build output: `packages/server/dist/`

---

## Delta: @caro/db TypeScript migration

**Date:** 2026-04-05
**Status:** Complete

- All source files migrated to `.ts`, zero `tsc` errors, `strict: true`
- New types: `DbPool`, `MigrationStatus`, `MigrationResult`, `ActiveTag`, `RevisionTag`, `NewTagInput`, `ExistingTagInput`, `ApplyResult`, `RevisionRow`
- `withTransaction<T>` is now generic — callers get typed return values
- `applyRegistryRevision` refactored to use generic return directly (strict mode, no non-null assertion)
- Test files remain `.js` pending a dedicated test migration pass
- Build output: `packages/db/dist/`

---

## Delta: apps/tag-registry/server TypeScript migration

**Date:** 2026-04-06
**Status:** Complete

- All 7 source files migrated from `.js` → `.ts`: `app`, `index`, `routes/config`, `routes/registry`, `routes/templates`, `services/registryService`, `services/templateService`
- `tsconfig.json` created (`extends ../../../tsconfig.base.json`, `outDir: dist`, `rootDir: src`)
- `shared/index.d.ts` declaration shim created — NodeNext resolution finds `.d.ts` alongside `.js`, enables type-safe imports from the JS shared package without `allowJs` or `rootDir` violations
- `src/types/cors.d.ts` module shim created — `@types/cors` does not exist on npm; local `declare module 'cors' { ... }` shim required
- `package.json` updated: `build: tsc`, `dev: nodemon --ext ts,json --watch src --exec "npx tsx src/index.ts"`, `start: node dist/index.js`
- `tsx` installed at repo root (workspace resolution blocks install from subdirectory)
- All 8 `__tests__/*.test.js` imports updated: `../src/*.js` → `../src/*.ts`, `vi.mock` paths updated to match
- `tsc --noEmit` → zero errors; `npm run build` → clean; dev server starts; 82/82 tests passing

## Delta: tag-registry client TypeScript migration

**Date:** 2026-04-06
**Status:** Complete

- All 35 source files in `apps/tag-registry/client/src/` migrated: `.js` → `.ts`, `.jsx` → `.tsx`; old files deleted
- `client/tsconfig.json` created (`extends ../../../tsconfig.base.json`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `outDir: dist`, `rootDir: src`)
- `shared/index.d.ts` updated: added `TemplateEntry`, `ValidationMessage`, `ValidationMessageRef`, `CascadeDiff`, `AffectedParent`, fixed `validateParentTypes` signature, fixed `simulateCascade` to use `Map<string, TemplateEntry>`
- `shared/utils.d.ts` created: declares `deepEqual`/`deepNotEqual`
- `src/vite-env.d.ts` added for Vite CSS module type declarations
- `@types/react`, `@types/react-dom`, `typescript` added to client `devDependencies`
- `vite.config.js` renamed to `vite.config.ts`; `package.json` build script changed to `tsc && vite build`
- All 7 `__tests__/*.test.js` mock paths updated from `.js` to `.ts`/`.tsx`
- Path fix: all `.ts`/`.tsx` files had one extra `../` in shared imports vs original `.js`; corrected during migration
- `useRegistryStore.ts` sort comparison fixed: `as unknown as Record<string, unknown>` + `String()` coercion to satisfy strict type checking
- Root cause of mock mismatch: old `.js` source files shadowed new `.ts` files — Vite resolved `'../api/templates.js'` to the actual `.js` file; fix was deleting all old `.js`/`.jsx` source files so Vite falls through to `.ts`
- `tsc --noEmit` → zero errors; 112/112 tests passing

---

## Delta: withTransaction() test TODO closed

**Date:** 2026-04-05
**Status:** Complete

- All 5 failure path scenarios confirmed present in `packages/db/__tests__/query.test.js`: happy path, fn throws + ROLLBACK succeeds, fn throws + ROLLBACK throws, COMMIT throws + ROLLBACK succeeds, COMMIT throws + ROLLBACK throws
- TODO in `platform_handoff.md` was stale — tests were written during the db migration session
- No new test code required

---

## Delta: tag-registry E2E baseline fixes (pre-TypeScript migration)

**Date:** 2026-04-06
**Status:** Complete

- `history.spec.js:129` — fixed webkit strict mode violation: row locator now uses `filter({ has: page.locator('td:first-child').filter({ hasText: /^N$/ }) })` for exact revision number matching; prevents partial substring matches at high rev numbers
- `registry-diff.spec.js:74` — removed `not.toBeVisible()` assertions for modified/retired summary lines; scoped per-row `bg-green-500` check to rows containing `modName` only; both changes guard against accumulated DB state from prior test runs
- `meta-modal.spec.js:146` — deleted test "clicking View on a different row replaces the open modal"; clicking View while a modal is open is not a valid interaction (full-viewport overlay blocks the button)
- Remaining known failures: `save-cancel.spec.js:116,145` (isDirty stays false for child tag template edits — needs `FieldsPanel.jsx` investigation); deferred, not a migration regression

---

## Delta: tag-registry E2E suite — full green baseline established

**Date:** 2026-04-06
**Status:** Complete

- 207 passed, 0 failed across chromium, firefox, webkit (6.9m)
- Previous state: 13 failures
- Fixes applied:
  - `history.spec.js` — exact revision number matching via anchored regex on `td:first-child`
  - `registry-diff.spec.js` — removed global summary assertions; scoped row assertions to current root via `getOwnRows()` helper using `td:nth-child(2)` tag_path prefix
  - `meta-modal.spec.js` — deleted invalid test (modal backdrop blocks second View click by design)
  - `save-cancel.spec.js` tests 6 and 7 — added module wrapper (`module → parameter → tag`); hierarchy was invalid without a module parent, causing `isDirty` to stay false after `selectRoot` loaded pName as root
- Timeout investigation deferred — suite runs in acceptable time at current settings

---

## Delta: tag-registry unit test baseline established

**Date:** 2026-04-06
**Status:** Complete

- 319 unit tests passing across 23 files: server (82), shared (125), client (112)
- Fixes applied:
  - `registryService.test.js` — mock rewritten to target `getActiveTags`/`getRevisions`/`getRevisionTags` directly; old tests mocked `query()` which `registryService` no longer calls after `@caro/db` TypeScript migration; SQL string assertions removed (those belong in `@caro/db` tests); `applyRegistryRevision` added to mock to prevent module load failure; syntax error fixed
  - vitest must be run per-project from each app subdirectory (`server/`, `shared/`, `client/`) — no root vitest config exists under `apps/tag-registry/`
  - `packages/db`: 11 tests passing (`query.test.js` x5, `migrations.test.js` x6) — imports fixed from `../query.js` → `../query.ts` and `../migrations.js` → `../migrations.ts` after TypeScript migration (source files live at package root, not in `src/`)
- Full baseline: 319 unit (tag-registry) + 11 unit (packages/db) + 207 E2E = 537 tests, 0 failures

---

## Delta: platform test coverage audit

**Date:** 2026-04-06
**Status:** Complete

- Full baseline confirmed: 330 unit tests + 207 E2E = 537 tests, 0 failures
  - `packages/db`: 11 (query x5, migrations x6)
  - `apps/tag-registry/server`: 82
  - `apps/tag-registry/shared`: 125
  - `apps/tag-registry/client`: 112
  - `apps/tag-registry/e2e`: 207
- No tests exist for: `packages/server`, `packages/ui`, `apps/mqtt-simulator`
  - `packages/server` and `packages/ui` are thin middleware/primitive packages — acceptable without tests pending a future pass
  - `apps/mqtt-simulator` has no automated tests by intentional design (documented in `mqtt_simulator_handoff.md`)
- No action required before tag-registry TypeScript migration

---

## TODO — Migrate apps/mqtt-simulator to TypeScript

All source files in `apps/mqtt-simulator/server/src/` and `apps/mqtt-simulator/client/src/` to be converted to TypeScript. Deferred until after HMI is stable.

**Status:** Open (deferred)

---
