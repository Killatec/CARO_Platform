# db/timescale/migrations

SQL migration files for the TimescaleDB database.

Files are run in filename order by `runTimescaleMigrations()` in `packages/db/timescaleMigrations.ts`. Each file is applied exactly once; applied filenames are recorded in the `schema_migrations` table inside the TimescaleDB database.

## Naming convention

```
T001_<description>.sql
T002_<description>.sql
```

Use the `T` prefix and zero-padded three-digit sequence numbers to distinguish these migrations from the operational DB migrations in `db/postgres/migrations/`.

## First migration

`T001_create_tag_samples.sql` — creates the `tag_samples` hypertable.
