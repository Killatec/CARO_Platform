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

## TODO — Migrate apps/tag-registry to TypeScript

All source files in `apps/tag-registry/server/src/` and `apps/tag-registry/client/src/` to be converted to TypeScript. Shared packages (`@caro/db`, `@caro/server`, `@caro/ui`) will already be TypeScript by the time this migration runs. Deferred until after HMI is stable.

**Status:** Open (deferred)

---

## TODO — Migrate apps/mqtt-simulator to TypeScript

All source files in `apps/mqtt-simulator/server/src/` and `apps/mqtt-simulator/client/src/` to be converted to TypeScript. Deferred until after HMI is stable.

**Status:** Open (deferred)

---
