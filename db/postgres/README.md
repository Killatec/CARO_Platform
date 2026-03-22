# db/postgres

PostgreSQL schema, migrations, and seed data for the CARO Platform.

## Contents

```
postgres/
  migrations/   Ordered DDL scripts — run once per environment, in sequence
  seeds/        Data scripts — run after migrations to populate dev/test data
```

## Migrations

Migrations are plain SQL files prefixed with a zero-padded sequence number.
They are **idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
so they can be re-run safely without error.

| File | Description |
|---|---|
| `001_create_tag_registry.sql` | `tag_registry` table — core tag store |
| `002_create_registry_revisions.sql` | `registry_revisions` table — revision log |

### Running migrations with psql

Run from the repo root or the `db/postgres/` directory:

```bash
psql -h localhost -p 5432 -U caro -d caro_dev \
  -f db/postgres/migrations/001_create_tag_registry.sql

psql -h localhost -p 5432 -U caro -d caro_dev \
  -f db/postgres/migrations/002_create_registry_revisions.sql
```

Or pipe them in order in a single shell invocation:

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
