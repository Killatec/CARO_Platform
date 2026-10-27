# Rivendell Deployment — CARO HMI on the RF Rig PC

**Deployed:** 2026-10-26 | **Host:** Rivendell, `192.168.69.184` | **Repo:** `C:\Killatec\CARO_Platform`, branch `dev` | **Project:** `Narya1`

This is a record of how the CARO HMI was installed on Rivendell. Use it to start, update or repair the deployment, or to rebuild it from scratch.

## 1. What runs on Rivendell

Rivendell runs the **CARO HMI only**. Tag Registry and MQTT Simulator are not used on this PC.

| Component | How it runs | Port | Starts at boot |
|---|---|---|---|
| CARO HMI server | `npm run hmi` (tsx watch) | 3003 | No — start manually (§3) |
| CARO HMI client | `npm run hmi` (Vite dev server, LAN-visible) | 5175 | No — same command |
| PostgreSQL 17 | Native Windows service `postgresql-x64-17` | 5432 | Yes |
| TimescaleDB | Docker container `caro-timescale` (`timescale/timescaledb:latest-pg16`) | 5433 | Yes, once Docker Desktop starts at sign-in |
| Mosquitto | Pre-existing Windows service, shared with the legacy HMI | 1883 | Yes |
| **Legacy "RF Control" HMI** | Pre-existing Node web server — **not part of CARO** | **3001** | (unchanged) |

**URLs:**
- CARO HMI: `http://192.168.69.184:5175`
- Legacy RF Control HMI: `http://192.168.69.184:3001`

> ⛔ **Never run `npm run dev` or `npm run dev:fresh` on Rivendell.** Both run `scripts/kill-ports.js`, which force-kills whatever listens on 3001–3003 and 5173–5175. Port 3001 is the legacy RF Control HMI. Always use `npm run hmi` / `npm run hmi:fresh`, which touch only 3003 and 5175.

**Expected state:** RF1 runs the legacy firmware, so CARO's Module Status shows RF1 (and RF2) as **STALLED** with handshake **NONE**. That's expected until RF1 is flashed with CARO firmware. The HMI module itself shows OK with 17 tags.

---

## 2. Configuration

### 2.1 Env files

Both are gitignored, so they were copied by hand from the dev PC. They hold passwords, so never commit them or send them over chat or email.

| File | Contents |
|---|---|
| `C:\Killatec\CARO_Platform\.env` | `PROJECT_ROOT=Narya1`, `POSTGRES_*` (database `narya1_postgres`, user `postgres`), `TIMESCALE_*` (database `narya1_timescale`, user `caro`, port 5433) |
| `C:\Killatec\CARO_Platform\apps\caro-hmi\server\.env` | `MQTT_URL=mqtt://localhost:1883`, `HMI_PORT=3003`, tick/watchdog settings |

On Rivendell, `POSTGRES_PASSWORD` is the password chosen during the PostgreSQL install, not the one the dev PC uses. `TIMESCALE_PASSWORD` is whatever the root `.env` held when the container first started (§5.4).

### 2.2 Data

- **Main Postgres (`narya1_postgres`):** restored from a `pg_dump` of the dev PC, not built by a Tag Registry apply. Rivendell therefore has the same registry and **the same tag IDs** as the dev PC: 465 active tags, 3 modules.
- **Historian (`narya1_timescale`):** created empty by the container on first boot. History starts at the deployment date and is kept for 14 days.
- **Historian data directory:** `C:\Killatec\CARO_Platform\timescale-data\`, the compose default; it's gitignored. Rivendell has only drive C: (111 GB free at install), and the worst case is about 28 GB raw plus aggregates.

### 2.3 Mosquitto

The existing broker config was **left untouched**, because the legacy HMI depends on it. CARO only needs TCP 1883, which it already serves. The broker is shared, so CARO and the legacy HMI both see the same module traffic.

### 2.4 Firewall

| Port | Opened to the LAN? | Why |
|---|---|---|
| 5175 (HMI client) | Allow Node.js on Private networks if prompted | Operators browse to it |
| 5433 (TimescaleDB) | **No** — the Docker Desktop Backend prompt was cancelled | The HMI connects through localhost; nobody needs the historian from outside |

---

## 3. Daily operation

### Start, or restart after a crash or closed terminal

```powershell
cd C:\Killatec\CARO_Platform
npm run hmi
```

- `npm run hmi` kills anything left on 3003/5175, starts the server, waits for port 3003, then starts the client.
- Output is prefixed `[hmi-srv]` / `[hmi-cli]`. **Ctrl+C stops both.**
- If an earlier `npm run hmi` is still open in another terminal, Ctrl+C it first. Otherwise its file watcher brings the old server back.

### After a reboot

1. Sign in to Windows. PostgreSQL and Mosquitto are services, and Docker Desktop starts at sign-in (to the tray, without opening its dashboard).
2. Open a terminal in `C:\Killatec\CARO_Platform` and run `npm run hmi`.

If the HMI starts before Docker is ready, it falls back to a null historian writer and reconnects by itself within 30 s.

### Healthy startup log

```
[HMI] Connected to PostgreSQL
[env] app-local: loaded (...) | root: loaded (...)
[db] Migration already applied, skipping: ...            (001–018)
[HMI] Tag map loaded: 465 tags, 3 modules
[hmi] timescale reachable
[db] Timescale migration already applied, skipping: ...  (T001–T009)
[DbPipeline] started: ... writer=timescale
[HMI] MQTT bridge connected: mqtt://localhost:1883
[HMI] Server started on port 3003
```

**On the System Overview page, Trend Status should show:**
- Trending: green
- Error_Count: 0
- Rows_Per_Sec: above 0
- DB_Size: a value (it can take up to 30 s to appear)

---

## 4. Updating Rivendell

Work happens on the dev PC and is pushed to `dev`. On Rivendell:

1. Ctrl+C the running `npm run hmi`.
2. Sourcetree → **Pull** `dev`.
3. If the pull changed `package-lock.json`, run `npm install`.
4. `npm run hmi:fresh` (builds the shared packages, then starts the HMI).

The shared packages (`@caro/db`, `@caro/server`, `@caro/tag-registry-shared`, …) are consumed from their gitignored `dist/` output. Skipping the build after a pull gives missing exports at **runtime**, not at compile time.

**Don't run `npm audit fix`** (and certainly not `--force`) on Rivendell. It rewrites `package-lock.json` so it no longer matches the repo. Handle audit findings on the dev PC.

### Registry changes

Rivendell doesn't run the Tag Registry. To bring a new registry revision across, either:
- dump and restore `narya1_postgres` from the dev PC again (§5.3, which replaces the whole database, including commanded setpoints), or
- point a Tag Registry instance at Rivendell's Postgres and apply there.

Pick one and decide it before the first registry change after deployment. This record doesn't settle it.

---

## 5. Rebuilding from scratch

These are the steps used on 2026-10-26, in order.

### 5.1 Prerequisites

| Item | Version used | Notes |
|---|---|---|
| Node.js | v22.14.0 | Already installed |
| Mosquitto | — | Already installed and running for the legacy HMI |
| VS Code, Git, Sourcetree | — | Already installed |
| WSL2 | Ubuntu-22.04, version 2 | Already present |
| PostgreSQL | 17.11 (EDB installer) | Installed — §5.3 |
| Docker Desktop | 4.97 (engine 29.9.2) | Installed — §5.4 |

### 5.2 Clone

Sourcetree → Clone:
- **Source URL:** `https://github.com/Killatec/CARO_Platform.git`
- **Destination path:** `C:\Killatec\CARO_Platform`. This is the repo folder itself, not its parent, and it must not exist yet or be empty.
- **Advanced Options → Checkout branch:** `dev`

Then copy the two `.env` files (§2.1) into place.

### 5.3 PostgreSQL

1. **Install with the EDB installer:**
   - Components: Server and Command Line Tools (pgAdmin and Stack Builder not needed)
   - Port: 5432, superuser `postgres`
   - Put the chosen password into `POSTGRES_PASSWORD` in the root `.env`.
2. **Add the tools to the system PATH** from an admin PowerShell:
   ```powershell
   [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","Machine") + ";C:\Program Files\PostgreSQL\17\bin", "Machine")
   ```
3. **Dump on the dev PC:**
   ```powershell
   pg_dump -h localhost -U postgres -Fc narya1_postgres -f narya1_postgres.dump
   ```
4. **Restore on Rivendell, before the HMI has ever started against this database.** On first start the HMI creates the tables itself, and the restore would then collide with them.
   ```powershell
   psql -h localhost -U postgres -c "CREATE DATABASE narya1_postgres"
   pg_restore -h localhost -U postgres -d narya1_postgres --no-owner C:\Killatec\narya1_postgres.dump
   psql -h localhost -U postgres -d narya1_postgres -c "select count(*) from tag_registry"
   ```
   The count was 777 rows, including retired tags; 465 of them are active.
5. Delete the dump file from both PCs.

### 5.4 TimescaleDB

1. **Install Docker Desktop:**
   - Per-user installation, WSL 2 backend, Windows containers off.
   - Settings → General: **Start Docker Desktop when you sign in** on; **Open Docker Dashboard when Docker Desktop starts** off.
   - Check with `docker run --rm hello-world`.
2. **Make sure the root `.env` is in place**, then start the container from the repo root:
   ```powershell
   cd C:\Killatec\CARO_Platform
   docker compose -f docker-compose.timescale.yml up -d
   docker ps                                # caro-timescale ... (healthy)
   docker logs caro-timescale --tail 5      # "database system is ready to accept connections"
   ```
   Because the data directory was empty, the container created `TIMESCALE_DATABASE` (`narya1_timescale`) itself, with the user and password from the root `.env`.
3. **Firewall:** Cancel the "Docker Desktop Backend" prompt (§2.4).
4. **Let the HMI migrate it.** It runs T001 and T004–T009 at startup, or on reconnect if it was already running.

> **Changing `TIMESCALE_DATABASE` later does not create a new database.** The image only creates `POSTGRES_DB` when the data directory is empty. See [platform/multi_project_runbook.md](platform/multi_project_runbook.md) §3.2.

### 5.5 Install, build, run

```powershell
cd C:\Killatec\CARO_Platform
npm install
npm run hmi:fresh
```

---

## 6. Gotchas hit during deployment

| Symptom | Cause | Fix |
|---|---|---|
| Something already listening on 3001 | The legacy RF Control HMI (node.exe) | Run CARO's HMI only, with `npm run hmi` |
| `psql` / `docker` "not recognized" in VS Code after installing | The VS Code terminal keeps the PATH it was launched with | Close every VS Code window, or refresh the current terminal: `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")` |
| `TS2307: Cannot find module '@caro/tag-registry-shared'` while building `@caro/hmi-context` | The build order listed `tag-registry-shared` after `hmi-context`. A fresh clone has no stale `dist/` to hide it. | Fixed in `e904667` (`dev:fresh`). `hmi:fresh` (`cd84d5e`) uses the correct order. |
| `ECONNREFUSED ... :5433` stack traces when opening a trend page | TimescaleDB not running; the trend REST endpoints query it directly | Start the container (`docker ps` to check). Live values aren't affected. |
| Trend Status: Trending grey, Error_Count climbing, DB_Size `---` | HMI running on the null historian writer | Same as above. It reconnects within 30 s, no restart needed. |
| RENDER about 30 FPS instead of 60 | Measured in the browser; a remote-desktop session caps redraws | Not a fault. A local monitor shows 60. |
| RF1 / RF2 STALLED | RF1 is on the legacy firmware; RF2 isn't on the rig | Expected |

---

## 7. Open items

- **No auto-start for the HMI.** It has to be started by hand after each reboot. A Windows service or scheduled task would fix this, but hasn't been decided.
- **Registry update path for Rivendell** isn't settled (§4).
- **The trend endpoints log full stack traces when the historian is down** instead of returning a clean "historian unavailable" error. That's cosmetic, and the change hasn't been proposed yet.
