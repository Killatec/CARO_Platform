# db/postgres

PostgreSQL schema, migrations, and seed data for the CARO Platform.

## Contents

```
postgres/
  migrations/   Ordered DDL scripts — run once per environment, in sequence
  seeds/        Data scripts — run after migrations to populate dev/test data
```

## Migrations

Migrations are plain SQL files prefixed with a zero-padded sequence number,
applied in filename order by `runMigrations()` in `packages/db/migrations.ts`
(tracked in a `schema_migrations` table so each file runs at most once). They
are **idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`) so they can be
re-run safely without error — this matters because all three server apps
(tag-registry, mqtt-simulator, caro-hmi) call `runMigrations()` at their own
startup against whatever database they're configured for.

| File | Description |
|---|---|
| `001_create_tag_registry.sql` | `tag_registry` table — core tag store |
| `002_create_registry_revisions.sql` | `registry_revisions` table — revision log |
| `003_drop_active_path_index.sql` | Drops the partial unique index on active `tag_path` |
| `004_alter_tag_id_to_integer.sql` | `tag_id` BIGINT → INTEGER (CARO_DB_Spec v1.2 §2.1/§3.1) |
| `006_add_trends_to_tag_registry.sql` | Adds `trends` boolean column |
| `007_create_tag_types.sql` | `tag_types` lookup table; `data_type` → integer FK (later reverted by 008) |
| `008_revert_data_type_to_string.sql` | Reverts `data_type` to a string FK against `tag_types.type_name` |
| `009_cleanup_tag_types.sql` | Removes unused seeded types (`f64`, `i32`, `i32_array`, `string`) |
| `010_create_module_types.sql` | `module_types` lookup table, seeded `HMI`/`MQTT` |
| `011_add_module_columns.sql` | Adds nullable `module`/`module_type` columns |
| `012_add_i16_tag_type.sql` | Adds `i16` to `tag_types` |
| `013_add_display_columns.sql` | Adds `unit`, `format`, `eng_min`, `eng_max` |
| `014_add_array_tag_types.sql` | Adds `string`, `f32[]`, `i16[]` to `tag_types` |
| `015_add_tag_name_column.sql` | Adds `tag_name` column |
| `016_create_pending_setpoint_values.sql` | `pending_setpoint_values` table — setpoint restore-on-reconnect |

Note: the table jumps from `004` to `006` — there is no `005` file on disk. `runMigrations()` only reads whatever `.sql` files are present and sorts by filename, so a gap in the sequence is harmless, not a missing dependency.

### Running migrations with psql

The recommended path is to let an app run `runMigrations()` itself at startup
(the currently-open dev database always ends up on the full, current schema this
way). To apply the whole set by hand instead, run from the repo root:

```bash
psql -h localhost -p 5432 -U caro -d caro_dev \
  -f db/postgres/migrations/001_create_tag_registry.sql

psql -h localhost -p 5432 -U caro -d caro_dev \
  -f db/postgres/migrations/002_create_registry_revisions.sql
```

Or pipe all of them, in order, in a single shell invocation:

```bash
for f in db/postgres/migrations/*.sql; do
  psql -h localhost -p 5432 -U caro -d caro_dev -f "$f"
done
```

## Seeds

Seed files are applied **after** all migrations.

| File | Description |
|---|---|
| `dev_seed.sql` | 1 revision + 7 tags resolved from the `Plant1_System_A` hierarchy |

```bash
psql -h localhost -p 5432 -U caro -d caro_dev \
  -f db/postgres/seeds/dev_seed.sql
```

## Local dev connection details

| Parameter | Value |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `caro_dev` |
| User | `caro` |
| Password | see `.env` (`POSTGRES_PASSWORD`) |

Create the database and user if they don't exist:

```sql
CREATE USER caro WITH PASSWORD 'changeme';
CREATE DATABASE caro_dev OWNER caro;
```
