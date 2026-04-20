# @caro/db — Package Handoff
**Updated:** 2026-04-07 | **Path:** `packages/db/` | **Name:** `@caro/db`

---

## Exports

**Infrastructure:**

| Function | Purpose |
|---|---|
| `query(text, params)` | Execute a query against the pool |
| `withTransaction(fn)` | Run `fn(client)` inside BEGIN/COMMIT/ROLLBACK |
| `runMigrations()` | Apply pending migration files in order |
| `ping()` | Health check — `SELECT 1`, throws on failure |

**Tag registry:**

| Function | Purpose |
|---|---|
| `getActiveTags()` | Latest non-retired row per `tag_id` |
| `getRevisionTags(rev)` | All tag rows for a given revision; `null` if none |
| `applyRegistryRevision(added, modified, retired, comment)` | Write registry diff in SERIALIZABLE transaction |
| `getRevisions()` | All `registry_revisions` rows, DESC |

> **Note:** `getActiveTags()` returns the flat tag rows that HMI needs directly. `resolveRegistry()` in `apps/tag-registry/shared/` is a Tag Registry Admin Tool concern — it builds the template/asset tree structure used for registry editing. HMI does not need it.

---

## Rules

- Apps import named functions only. No `pool`, no `query` for ad-hoc SQL, no `pg` imports in app code.
- New queries go in this package. Never in app code.
- Pool is a lazy singleton — constructed on first call after `dotenv.config()` has run.
- `withTransaction()` releases the client in all cases (commit, rollback, rollback failure).

---

## Migrations

Files in `db/postgres/migrations/`. Applied in filename order. Tracked in `schema_migrations` table. Each migration runs inside a transaction.

- Never edit an existing migration file.
- New behavior = new file with next sequential prefix.
- Applied: `001` `002` `003` `004` `006` `007` `008` `009` `010` `011` `012` `013` `014` (005 skipped — do not reuse)
- `007` — create `tag_types` lookup table; migrate `tag_registry.data_type` to FK
- `008` — revert `tag_registry.data_type` FK back to string (`tag_types.type_name`)
- `009` — remove unused tag types; rename `f64` → `f32`
- `010` — create `module_types` standalone lookup table
- `011` — add nullable `module` and `module_type` columns to `tag_registry`
- `012` — add `i16` (Int 16) to `tag_types`
- `013` — add nullable display columns `unit`, `format`, `eng_min`, `eng_max` to `tag_registry`
- `014` — add `string`, `f32[]`, `i16[]` to `tag_types`

---

## Environment Variables

Read from each app's `server/.env`. Never use `DATABASE_URL`.

| Variable | Default | Required |
|---|---|---|
| `PGHOST` | `localhost` | No |
| `PGPORT` | `5432` | No |
| `PGDATABASE` | `caro_dev` | No |
| `PGUSER` | `postgres` | No |
| `PGPASSWORD` | — | **Yes** |

---

## Current State

Stable. In use by Tag Registry and MQTT Simulator.

Not implemented: `packages/db/__tests__/query.test.js` — `withTransaction()` failure path tests. Required before HMI service development. See `docs/platform_deltas.md`.

---

## TypeScript Migration

**Date:** 2026-04-05

All source files migrated to TypeScript (`strict: true`, zero `tsc` errors). Build output: `packages/db/dist/`.

New types exported:
- `DbPool`, `MigrationStatus`, `MigrationResult` — pool and migration internals
- `ActiveTag`, `RevisionTag`, `NewTagInput`, `ExistingTagInput`, `ApplyResult`, `RevisionRow` — registry query return types

Key changes:
- `withTransaction<T>` is now generic — callers get typed return values
- `applyRegistryRevision` refactored to use generic return directly (strict mode eliminates non-null assertion)
- Migrations directory path fixed: increased from 2 to 3 `../` hops to correctly resolve from `dist/` instead of `src/` — path now traverses `dist/` → `packages/db/` → `packages/` → repo root → `db/postgres/migrations/`
- `path` default import replaced with named imports (`dirname`, `resolve`); explicit `__filename` via `fileURLToPath(import.meta.url)` added
- Test file imports updated: `../query.js` → `../src/query.ts`, `../migrations.js` → `../src/migrations.ts`
- 11 unit tests passing (query.test.js ×5, migrations.test.js ×6)

---

## Key Documents

| Document | Path |
|---|---|
| DB Spec | `docs/CARO_DB_Spec.md` |
| Platform Spec Delta | `docs/platform_deltas.md` |
