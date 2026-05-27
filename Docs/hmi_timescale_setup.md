# HMI TimescaleDB Setup Guide

## Overview

The CARO HMI server uses TimescaleDB as its historian backend. Every time a tag value changes (change-of-value semantics), the HMI server enqueues a row into a queue and flushes it in batches to a `tag_samples` hypertable. This is a separate PostgreSQL instance from the Tag Registry database — it runs on port 5433 (Tag Registry on 5432). Null values represent bad quality or stalled modules; the 14-day retention policy and 12-hour compression keep disk use bounded.

---

## Prerequisites

- **Docker Desktop for Windows** (v4.x or later). Install from [docker.com](https://www.docker.com/products/docker-desktop/).
- Docker Desktop must be running before any `docker compose` command.

> **Troubleshooting — Docker Desktop ownership error on Windows**
>
> If `docker compose up` fails with a permissions or ownership error on `C:\ProgramData\DockerDesktop`, open an admin PowerShell and run:
> ```powershell
> $acl = Get-Acl "C:\ProgramData\DockerDesktop"
> $acl.SetOwner([System.Security.Principal.NTAccount]"SYSTEM")
> Set-Acl "C:\ProgramData\DockerDesktop" $acl
> ```
> Then restart Docker Desktop.

---

## Pick a Data Directory

The container mounts a host directory as its PostgreSQL data volume. The default (`./timescale-data` next to the compose file) is convenient for quick dev but runs on your OS drive.

**Recommended for the testing machine:** use the F: drive (~57 GB budget).

```
F:\TimescaleDB\data
```

**The directory must exist before `docker compose up`:**

```powershell
New-Item -ItemType Directory -Force -Path "F:\TimescaleDB\data"
```

---

## Configure Env Vars

Create a `.env` file in the repo root (next to `docker-compose.timescale.yml`). This file is gitignored.

```env
TIMESCALE_USER=caro
TIMESCALE_PASSWORD=<set-a-password>
TIMESCALE_DATABASE=caro_historian
TIMESCALE_HOST_PORT=5433
TIMESCALE_DATA_DIR=F:\TimescaleDB\data
```

> Windows backslash paths work for Docker Desktop volume mounts on WSL2 backends.

---

## Bring the Container Up

```powershell
docker compose -f docker-compose.timescale.yml up -d
```

Verify it started:

```powershell
docker ps
docker logs caro-timescale
```

Look for `database system is ready to accept connections` in the logs. The healthcheck polls every 5 seconds up to 10 retries.

---

## Wire the HMI Server

Add these variables to `apps/caro-hmi/server/.env`:

```env
TIMESCALE_HOST=localhost
TIMESCALE_PORT=5433
TIMESCALE_USER=caro
TIMESCALE_PASSWORD=<same-as-above>
TIMESCALE_DATABASE=caro_historian

# Optional tuning (defaults shown):
# TIMESCALE_DB_QUEUE_MAX=5000
# TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH=500
# TIMESCALE_DB_TICK_MS=500
```

---

## First-Boot Verification

Start the HMI server (`cd apps/caro-hmi/server && npm run dev`). In the logs you should see:

```
[hmi] timescale reachable
[hmi] Migration OK: T001_create_tag_samples.sql
```

On subsequent starts the migration log shows `SKIP` (already applied). Confirm the hypertable exists via psql:

```sql
SELECT hypertable_name FROM timescaledb_information.hypertables;
-- Expected: tag_samples
```

---

## Storage Expectations

Worst-case throughput: 360 tags × 10 Hz × 100% COV = ~25 GB/day uncompressed. After TimescaleDB's columnar compression (segmented by `tag_id`, ordered by `ts DESC`) this drops to roughly 2 GB/day. With 12-hour chunks, 12-hour compression policy, and 14-day retention the steady-state footprint is ≤ ~28 GB — well under the 57 GB budget on the F: drive.

---

## Operational Notes

- **Unreachable at boot:** If TimescaleDB is down when the HMI server starts, it falls back to `NullDbWriter`. Historical data is not buffered across this fallback — it is simply not written. To reconnect, bring TimescaleDB back up and then restart the HMI server. (Periodic automatic reconnect is on the backlog.)
- **Live health tags:** Seven `CARO_1.HMI.Trend_Info.*` tags show historian health in real time on any HMI dashboard: `Trending` (bool — pipeline actively writing), `Queue_Depth` (backpressure), `Rows_Per_Sec`, `Flush_ms`, `Dropped_Pkgs`, `Error_Count` (flush failures since boot), and `DB_Size` (current database size in GB, updated every 30s by `TimescaleSizeMonitor`; reads `null` until the first poll completes after boot).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Docker Desktop ownership error | See admin-PowerShell fix in Prerequisites above |
| Port 5433 already in use | Change `TIMESCALE_HOST_PORT` in `.env` and update `TIMESCALE_PORT` in the HMI server `.env` to match |
| `pg_isready` healthcheck stays unhealthy | Confirm the data directory exists and is writable; check `docker logs caro-timescale` for init errors |
| Data dir not found | Run `New-Item -ItemType Directory -Force -Path "<path>"` before `docker compose up` |
| HMI logs `timescale unreachable` | Container not running or `TIMESCALE_HOST`/`TIMESCALE_PORT` mismatch; `docker ps` to check |
