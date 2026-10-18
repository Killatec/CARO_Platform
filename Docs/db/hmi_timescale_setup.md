# HMI TimescaleDB Setup Guide

**Updated:** 2026-10-17 (reconciled with `docker-compose.timescale.yml`, the migrations and the HMI server).

## Overview

The CARO HMI server uses TimescaleDB as its historian backend. Every time a trendable tag's value changes (change-of-value semantics), the HMI server enqueues a row, plus at least one snapshot row per tag per minute, and flushes them in batches to a `tag_samples` hypertable. This is a separate PostgreSQL instance from the Tag Registry database — it runs on port 5433 (Tag Registry on 5432). Null values represent bad quality or stalled modules; the 14-day retention policy and compression of 1-hour chunks once they are 10 minutes old keep disk use bounded. Four continuous aggregates (1 s, 10 s, 1 min, 10 min) are created on top; see `Docs/db/CARO_DB_Spec.md` §9.

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

Put these in the repo-root `.env` (next to `docker-compose.timescale.yml`; gitignored). Docker Compose reads it directly for the container, and every CARO server reads the same file through `loadEnv()`.

```env
TIMESCALE_USER=caro
TIMESCALE_PASSWORD=<set-a-password>
TIMESCALE_DATABASE=caro_timescale
TIMESCALE_HOST_PORT=5433
TIMESCALE_DATA_DIR=F:\TimescaleDB\data
```

Compose defaults when a variable is unset: user `caro`, password `caro_dev_password`, database `caro_timescale`, host port `5433`, data dir `./timescale-data`. **Set `TIMESCALE_PASSWORD`** — the HMI's `@caro/db` pool has no default password, and only warns if it is missing.

The container creates `TIMESCALE_DATABASE` only when its data directory is empty. Changing the name later does not create a new database — see `Docs/platform/multi_project_runbook.md` §3.2.

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

The connection variables go in the repo-root `.env`, next to the ones above (`TIMESCALE_PORT` is the host port the HMI connects to, normally the same as `TIMESCALE_HOST_PORT`):

```env
TIMESCALE_HOST=localhost
TIMESCALE_PORT=5433
TIMESCALE_USER=caro
TIMESCALE_PASSWORD=<same-as-above>
TIMESCALE_DATABASE=caro_timescale
```

Optional pipeline tuning goes in `apps/caro-hmi/server/.env` (defaults shown):

```env
# TIMESCALE_DB_QUEUE_MAX=5000
# TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH=500
# TIMESCALE_DB_TICK_MS=500
```

---

## First-Boot Verification

Start the HMI server (`cd apps/caro-hmi/server && npm run dev`). In the logs you should see:

```
[hmi] timescale reachable
[db] Running timescale migration: T001_create_tag_samples.sql
[db] Timescale migration OK: T001_create_tag_samples.sql
… (T004, T006–T009 likewise)
[TimescaleSizeMonitor] started: pollMs=30000
```

On subsequent starts each migration logs `[db] Timescale migration already applied, skipping: <file>`. If the historian is unreachable you instead see `[hmi] timescale unreachable, starting with null historian writer; reason=…`. Confirm the hypertable exists via psql:

```sql
SELECT hypertable_name FROM timescaledb_information.hypertables;
-- Expected: tag_samples
```

---

## Storage Expectations

Worst-case throughput: 360 tags × 10 Hz × 100% COV = ~25 GB/day uncompressed. After TimescaleDB's columnar compression (segmented by `tag_id`, ordered by `ts DESC`) this drops to roughly 2 GB/day. With 14-day retention the raw steady-state footprint is ≤ ~28 GB — well under the 57 GB budget on the F: drive. (This estimate predates the switch to 1-hour chunks compressed after 10 minutes, which shortens the uncompressed tail, and does not include the continuous aggregates; the 10-minute aggregate has no retention policy.)

---

## Operational Notes

- **Unreachable at boot:** If TimescaleDB is down when the HMI server starts, it falls back to `NullDbWriter`. Samples are not buffered across this fallback — they are discarded. `HistorianReconnector` retries every `TIMESCALE_RECONNECT_MS` (default 30 s) and switches to the real writer once TimescaleDB answers; no restart is needed. Nothing in the HMI UI shows that the historian is down apart from the `Trend_Info` tags below.
- **Live health tags:** Seven `HMI.Trend_Info.*` tags (under whichever system root contains the HMI module) show historian health in real time on any HMI dashboard: `Trending` (bool — pipeline actively writing), `Queue_Depth` (backpressure), `Rows_Per_Sec`, `Flush_ms`, `Dropped_Pkgs`, `Error_Count` (flush failures since boot), and `DB_Size` (current database size in GB, updated every 30s by `TimescaleSizeMonitor`; reads `null` until the first poll completes after boot).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Docker Desktop ownership error | See admin-PowerShell fix in Prerequisites above |
| Port 5433 already in use | Change `TIMESCALE_HOST_PORT` in `.env` and update `TIMESCALE_PORT` in the HMI server `.env` to match |
| `pg_isready` healthcheck stays unhealthy | Confirm the data directory exists and is writable; check `docker logs caro-timescale` for init errors |
| Data dir not found | Run `New-Item -ItemType Directory -Force -Path "<path>"` before `docker compose up` |
| HMI logs `timescale unreachable` | Container not running or `TIMESCALE_HOST`/`TIMESCALE_PORT` mismatch; `docker ps` to check |
