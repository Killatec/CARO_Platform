# db/timescale

Reserved for TimescaleDB migrations and seed data.

## What this folder is for

TimescaleDB is the time-series storage layer planned for Phase 2 of the CARO
Platform. It will store live tag values, historian data, and alarm records
produced by connected SCADA/HMI systems.

## How TimescaleDB relates to PostgreSQL

TimescaleDB runs as a **PostgreSQL extension** — it is not a separate database
server. The same `caro_dev` PostgreSQL instance used for the tag registry will
host TimescaleDB hypertables once the extension is enabled:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

Hypertable migrations will live in `timescale/migrations/` and follow the same
numbered SQL file convention as `db/postgres/migrations/`.

## Current status

No migrations have been written yet. This folder is a placeholder.
Migrations will be added when Phase 2 time-series work begins.
