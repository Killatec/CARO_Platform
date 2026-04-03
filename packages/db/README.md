# @caro/db — Shared Database Access

## Policy
ALL database queries for CARO_Platform live here. No app contains raw SQL or direct pool usage.
Apps import named functions from this package only.

## Modules
- pool.js       — PG connection pool (do not import directly in apps)
- query.js      — query wrapper (do not import directly in apps)
- registry.js   — tag_registry table queries
- revisions.js  — registry_revisions table queries
- audit.js      — audit_log writes

## Adding a new query
Add it to the appropriate module here. If no module fits, create one.
Never add DB logic to app-level code.

---

## Apps that use this package

- `apps/tag-registry/server` — tag template API server
- `apps/mqtt-simulator/server` — MQTT simulator

## Environment variables

| Variable     | Default      | Required |
|---|---|---|
| `PGHOST`     | `localhost`  | no  |
| `PGPORT`     | `5432`       | no  |
| `PGDATABASE` | `caro_dev`   | no  |
| `PGUSER`     | `postgres`   | no  |
| `PGPASSWORD` | _(none)_     | yes |

All variables are read at the time of the first database call (not at import
time), so `dotenv.config()` in the app entry point will be in effect.

`PGPASSWORD` must be set in the app's local `.env` file. It is never committed
to source control (`.env` is in `.gitignore`).

## Adding @caro/db to a new app

1. Add the dependency to the app's `package.json`:
   ```json
   "@caro/db": "*"
   ```

2. Run `npm install` from the monorepo root to link the workspace package.

3. Set `PGPASSWORD` (and any other overrides) in the app's `.env` file.

4. Import named functions only — never import `pool` or `query` directly:
   ```js
   import { getActiveTags } from '@caro/db';
   ```

## API

### `pool`

A lazy `pg.Pool` instance (created on first use). Exposes `pool.query()`,
`pool.connect()`, and `pool.end()`. Pool settings: max 10 connections,
30 s idle timeout, 5 s connection timeout.

### `query(text, params?)`

Thin wrapper around `pool.query()`. Returns a `pg.QueryResult`. Callers
handle errors.

### `withTransaction(fn)`

Runs `fn(client)` inside a `BEGIN` / `COMMIT` block. Automatically rolls
back and re-throws on error. Always releases the client.

### `runMigrations()`

Runs all `.sql` files in `db/postgres/migrations/` (sorted by filename) and
returns `[{ file, status }]` where status is `'ok'` or `'error'`. Does not
throw — all files are attempted even if one fails.

### `getActiveTags()`

Returns the latest active (non-retired) row for each `tag_id`. Uses a
DISTINCT ON subquery to get the highest-revision row per tag unconditionally,
then filters `WHERE retired = false`. Returns full rows including `meta`.
