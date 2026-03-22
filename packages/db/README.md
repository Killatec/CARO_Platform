# @caro/db

Shared node-postgres connection pool and query utilities for the CARO Platform
monorepo. Provides a single configured `pg.Pool` instance and helper functions
used by all server-side apps.

## Apps that use this package

- `apps/tag-registry/server` — tag template API server

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

4. Import and use:
   ```js
   import { pool, query, withTransaction } from '@caro/db';

   // Simple query
   const result = await query('SELECT * FROM tag_registry WHERE retired = false');

   // Transaction
   await withTransaction(async (client) => {
     await client.query('INSERT INTO registry_revisions ...', [...]);
     await client.query('INSERT INTO tag_registry ...', [...]);
   });
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
