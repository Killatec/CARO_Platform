# Multi-Project Runbook — creating and switching systems

**Created:** 2026-09-20
**Scope:** operational companion to the Multi-Project Model section of `platform_handoff.md`.
That section explains *why*; this one explains *how*, plus what is known to be wrong.

Every command and error message below was observed on a real run, not predicted.

---

## 1. What a "system" is here

One project = one root template + one Postgres database + one TimescaleDB database.
One project is live at a time, selected by the root `.env`. Switching is a restart.

`applyRegistry()` resolves only the subtree under the root it is given, then retires
every tag in the database absent from that resolved set. `registry_revisions` has no
root column. So a database belongs to exactly one root, permanently — which is what
`PROJECT_ROOT` exists to enforce.

Worked example below uses `Narya_1` / `narya1_postgres` / `narya1_timescale`.

---

## 2. Prerequisites

- **Docker Desktop running.** The TimescaleDB container lives there. If it is not
  running, the HMI starts anyway and silently records nothing — see Known Issue 1.
- `psql` on PATH.
- The current root `.env` backed up (see §4). `.env.*` is gitignored.

**Database names must be lowercase.** PostgreSQL folds unquoted identifiers to
lowercase at creation, but the database name in a connection is case-sensitive.
`CREATE DATABASE Narya1_Postgres` creates `narya1_postgres`, and a `.env` carrying
`POSTGRES_DATABASE=Narya1_Postgres` then fails with "database does not exist".
Lowercase throughout avoids quoting every identifier forever.

**The two databases use different servers, ports and users:**

| | Host/port | User | Where |
|---|---|---|---|
| Main Postgres | `localhost:5432` | `postgres` | Native install |
| TimescaleDB | `localhost:5433` | `caro` | Docker container |

---

## 3. Creating a new system

### 3.1 Create the Postgres database

```powershell
psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE narya1_postgres"
```

Do **not** use `db/postgres/scripts/setup_dev_db.ps1` for this. It runs a hardcoded
two-migration list (001, 002) rather than the current sixteen, and seeds a fictional
`Plant1_System_A` hierarchy. See Known Issue 6.

Nothing else is needed — the apps migrate the database themselves on next start.

### 3.2 Create the TimescaleDB database

⛔ **Do not do this by changing `TIMESCALE_DATABASE` and restarting the container.**
`docker-compose.timescale.yml` substitutes that variable into `POSTGRES_DB`, and Compose
reads the root `.env` by its own convention — so it looks like it should work. It does
not: the Postgres image only creates `POSTGRES_DB` when the data directory is empty, and
`timescale-data/` is not. The container starts, ignores the new name, and the HMI then
fails to connect to a database that was never created.

Create it explicitly instead:

```powershell
psql -h localhost -p 5433 -U caro -d caro_timescale -c "CREATE DATABASE narya1_timescale"
psql -h localhost -p 5433 -U caro -d narya1_timescale -c "CREATE EXTENSION IF NOT EXISTS timescaledb"
```

The `-d caro_timescale` matters: with no `-d`, psql defaults the database name to the
username and fails with the confusing `database "caro" does not exist`.

The extension line is insurance. The image seeds `timescaledb` into `template1`, so a new
database normally inherits it and the command reports `already exists, skipping`. If that
ever stops being true, `T001_create_tag_samples.sql` would fail on `create_hypertable`.

### 3.3 Point the root `.env` at the new system

Edit the root `.env` — not any app's `.env`:

```dotenv
PROJECT_ROOT=Narya_1
POSTGRES_DATABASE=narya1_postgres
TIMESCALE_DATABASE=narya1_timescale
```

Leave `POSTGRES_HOST/PORT/USER/PASSWORD` and `TIMESCALE_HOST/PORT/USER/PASSWORD` alone
unless the servers themselves differ.

### 3.4 Start the stack and let it migrate

```powershell
npm run dev
```

Expect, on a genuinely new database:

- all sixteen Postgres migrations `Running` / `Migration OK`
- all six Timescale migrations `Running` / `Timescale migration OK`
- `[tr-srv] [db] Connected to PostgreSQL (narya1_postgres)`
- each server's `[env]` line showing app-local **and** root loaded

All three servers run the Postgres migrations at startup. They start concurrently, so
they race; whichever wins applies all sixteen and the other two skip. This is safe —
the migrations are idempotent and guarded by `schema_migrations` — and has been
observed working on a real fresh database.

### 3.5 `npm run dev` now works on a system with an empty registry

The throw itself is fixed 2026-09-20, revised same day (see Known Issue 2 below —
kept for history). `caro-hmi` no longer throws when the registry has no tag matching
one of its own diagnostic properties; a write to such a property absorbs, and the
server logs one honest line — `[HMI] tag_registry returned no active tags — apply a
registry revision first.` for a wholly empty registry, or `[HmiTagSource] 0 HMI tags
found in registry` plus one line per absorbed property name the first time it's
written — and keeps serving on port 3003. The two-terminal workaround below is no
longer necessary for *this* cause specifically — `npm run dev` from the repo root
works for authoring the first registry revision too.

This does not touch `concurrently -k`'s general behaviour (any one process exiting
non-zero tears down the rest) — that's still true, unrelated, and out of scope (see
Known Issue 2). It simply no longer gets triggered by an empty or partial registry,
because `caro-hmi` no longer exits in that case.

Author the first registry revision the same way as any other change, via the Tag
Registry UI at `http://localhost:5173` once the full stack is up.

### 3.6 Author templates and apply

The root template (`Narya_1`) must exist in `apps/tag-registry/templates/` as a
`system`-type template before it can be selected in the root dropdown or applied.

Templates are shared across projects — one flat folder, no subdirectories — so template
*names* are globally unique even though the registries are separate.

---

## 4. Switching between systems

Keep one `.env` profile per project. `.env.*` is gitignored, so these can live in the
repo root safely.

```powershell
# save the current profile
Copy-Item .env .env.narya1

# switch
Copy-Item .env.caro1 .env -Force
npm run dev
```

Verify the switch took by reading the indicator on the Tag Registry's **Registry** or
**History** tab — it shows `DB: <database> · PROJECT_ROOT: <root>`. Do not trust the
`.env` you just edited; trust what the running server reports.

---

## 5. Troubleshooting — observed errors and their causes

| What you see | Cause |
|---|---|
| `Failed to connect to PostgreSQL: database "x" does not exist` on all three servers | `POSTGRES_DATABASE` names a database that has not been created. Self-diagnosing; the name is in the message. |
| Stack hangs instead of exiting after that error | nodemon catches the crash and holds at "waiting for file changes"; the clients wait on ports that never open. Ctrl+C and fix the cause. |
| `timescale unreachable ... reason=database "x" does not exist` | `TIMESCALE_DATABASE` names a database that has not been created. **The HMI starts anyway and records nothing.** |
| `timescale unreachable ... reason=` *(empty)* | The Timescale server is unreachable — usually Docker Desktop not running. The empty `reason` is Known Issue 3. |
| `[DbPipeline] No historian writer — data not being persisted` repeating | Consequence of either of the two rows above. The HMI UI shows no sign of this. |
| `403 PROJECT_ROOT_MISMATCH` on apply | The selected root does not match `PROJECT_ROOT`. Working as designed — the message names both. |
| `database "caro" does not exist` from psql on 5433 | `-d` was omitted; psql defaulted the database name to the username. |
| `[SIM] Auto-start failed: tag_registry returned no active MQTT tags` | Normal on a new system before the first registry apply. |
| Tag Registry refuses every apply | `PROJECT_ROOT` unset. It is required by design; unset means reject everything. |

---

## 6. Future improvements

Ordered by consequence, not effort. None of these block the multi-project model; all of
them cost someone time when they bite.

### 1. The HMI gives no UI signal that the historian is not recording

When TimescaleDB is unreachable the HMI starts on a `NullDbWriter`, serves pages, and
looks entirely healthy while discarding every sample. The only evidence is one startup
line and a repeating `[DbPipeline] No historian writer` in the console. The Registry and
History indicators report the Postgres database only, so nothing on screen contradicts
the impression that all is well. Observed live: Docker Desktop was not running and the
historian had been silently dead.

The soft-fail was a reasonable choice for a single-project install. With project
switching it becomes a routine operator risk, and it deserves a visible surface.

### 2. `caro-hmi` cannot start against an empty registry — the throw is fixed; the cascade it triggered is a separate, still-open issue

This issue named two distinct problems. Status of each:

- **The fatal-versus-skip inconsistency — fixed 2026-09-20, revised same day.** Seven
  missing `Trend_Info_*` tags were skipped silently; the very next missing tag,
  `Module_Info_Module_Count`, threw fatally at `hmi-tag-source.ts:193`. The same condition
  was handled two different ways, one survivable and one not. Fixed by making a write to
  any property with no matching registry tag absorb instead of throwing (the read then
  returns `null`), reported once per distinct property name the first time it's written —
  not a maintained list of expected names (an initial version of the fix used one; it was
  removed the same day as a second source of truth that would drift from the templates
  silently). A wholly empty registry gets its own distinct, honest line, matching
  `apps/mqtt-simulator`'s *"apply a registry revision first"* wording. See `hmi_deltas.md`
  2026-09-20 and §3.5 above.

- **One app's startup failure taking down the whole dev stack via `concurrently -k` — still
  open, out of scope.** `concurrently -k` kills every process the moment any one of them
  exits non-zero; that behaviour is untouched by the above and is a workflow decision, not
  a defect (some teams want fail-fast). The fix above just means an empty or partial
  registry no longer causes `caro-hmi` to exit non-zero in the first place, so this
  particular trigger is gone — but any other process crash still cascades exactly as before.

### 3. Timescale connection failures lose their reason

`reason=` is populated for a missing database but empty when the server itself is
unreachable, which is the more common case and the harder one to diagnose. Narrow and
cheap to fix.

### 4. The simulator's MQTT settings are never read from the environment

`mqttClient.ts:5-6` (`MQTT_BROKER_URL`, `MQTT_CLIENT_ID`) and `simulatorService.ts:13`
(`LOG_BUFFER_SIZE`) read `process.env` at module scope, before any dotenv call. ES module
imports fully evaluate before the importing module's own statements run, regardless of
textual order, so these have always fallen back to their hardcoded defaults. It is latent
only because the defaults match the configured values.

This matters for multi-project work specifically: **per-project simulator configuration
through `.env` will silently do nothing**, and a shared `MQTT_CLIENT_ID` across two
projects invites broker-side client-id eviction. Fix before pointing the simulator at a
second system. Recorded in `mqtt_simulator_handoff.md`.

### 5. Body-parser errors escape the platform error envelope

A malformed JSON body returns `400` with
`{"code":"INTERNAL_ERROR","message":"Expected property name or '}' in JSON at position 1"}`
— a raw parser message under the wrong code, bypassing the `errorHandler` convention that
every other error follows.

### 6. `setup_dev_db.ps1` is stale and misleading

It runs a hardcoded two-migration list (001, 002) against the current set of sixteen, and
seeds `dev_seed.sql`, which builds a fictional `Plant1_System_A` hierarchy rather than any
real registry. It works today only because 001 and 002 are `IF NOT EXISTS` guarded and the
apps migrate the rest themselves. Either bring it up to date or retire it in favour of this
runbook.

### 7. `db/postgres/README.md` names the wrong Postgres user

Its "Local dev connection details" table says user `caro`; every real `.env` uses
`postgres` for the main database. `caro` is the TimescaleDB user. Two databases, two users,
one wrong table.

### 8. Two dotenv versions resolve in the tree

Root `package.json` declares `^17.3.1`; every workspace member declares `^16.x` and
resolves 16.6.1. The array-`path` precedence behaviour the env loader depends on was
verified against 16.6.1. The root declaration is unreached by workspace code today, but a
future root-level script would pick up 17.x with no guarantee of identical behaviour.

### 9. Env precedence has no standing test

The three-tier rule — app-local beats root, injected environment beats both — is now
load-bearing for every project switch, and was proven by a one-off fixture run rather than
a test. `packages/server` has no vitest config; `packages/db` has one to copy.

### 10. A password is in git history

A previously-committed password was removed from `.env.test` during the env consolidation.
Removing it from the working tree does not remove it from history; it remains recoverable
from any clone at the old commits. If this repository is ever shared, mirrored or pushed
beyond one machine, that credential should be rotated.

### 11. `HmiTagSource.create()` gives up compile-time typo protection on its property names

`create()` returns `HmiTagSource & Record<string, number | boolean | string | number[]>`,
so `tsc --noEmit` accepts a write to any string property — `hmiTags.Module_Info_Modul_Count`
(missing an `e`) type-checks cleanly. Since 2026-09-20 the runtime Proxy no longer throws on
an unrecognized property either (see Known Issue 2) — it absorbs the write and logs the name
once, which is enough to make a typo *visible* but not enough to make it *fail loudly*, and
nothing enforces looking at the log. Narrowing the `Record` to the actual set of properties
callers use would give real compile-time protection back; it wasn't done here because
property names are derived at runtime from whatever the registry contains, so a static type
would need its own derivation (e.g. a generated union, or a stricter public API replacing
free-form property access) — a type-level change with its own blast radius, out of scope for
this pass.

---

## 7. Not yet built

A provisioning script that performs §3 end to end — create both databases, seed the root
template, write the `.env` — is intended but not written. It would be an external script,
not a feature of the Tag Registry app, and it must be idempotent and safely re-runnable:
it spans two database servers and several files with no transaction across any of them, so
the only safe posture is one that can be re-run start to finish after a partial failure.

Its natural home is the repo-root `scripts/` directory, which already holds cross-cutting
tooling, rather than `db/postgres/scripts/` which is Postgres-specific by name and content.
