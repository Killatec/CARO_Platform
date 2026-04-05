# @caro/db — Package Handoff
**Updated:** 2026-04-05 | **Path:** `packages/db/` | **Name:** `@caro/db`

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
- Applied: `001` `002` `003` `004` `006` (005 skipped — do not reuse)

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

## Key Documents

| Document | Path |
|---|---|
| DB Spec | `docs/CARO_DB_Spec.md` |
| Platform Spec Delta | `docs/platform_deltas.md` |
