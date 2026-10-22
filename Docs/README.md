# CARO_Platform — Start Here
**Updated:** 2026-10-21 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

This is the single entry point to the platform documentation. It holds the cross-app facts and rules, and tells you which detail doc to read next. App-level and subsystem detail lives in the folders listed under [Where to read next](#where-to-read-next).

CARO_Platform is an industrial automation monorepo with three apps:
- **Tag Registry:** an admin tool for authoring a versioned tag registry from templates.
- **MQTT Simulator:** a dev tool that publishes simulated module telemetry.
- **CARO HMI:** an operator HMI with live values, setpoints and a TimescaleDB-backed trend viewer.

## Session start

1. Read this file.
2. Read the open deltas: [platform/platform_deltas.md](platform/platform_deltas.md) plus the deltas file for your app (table below). Deltas are spec divergences not yet propagated into the docs.
3. Check [platform/platform_todo.md](platform/platform_todo.md) to see what is and isn't built.
4. Read the app anchor (`apps/<app>/CLAUDE.md`), then that app's handoff.
5. Read specs only when the task needs them.

## Telemetry path and MQTT interface

How data gets from a module to the screen, and back as commands. These three are kept in line with the code.

| Read | For |
|---|---|
| [platform/CARO_MQTT_Spec.md](platform/CARO_MQTT_Spec.md) | The MQTT wire contract (ICD) for module firmware: topics, telemetry and command payloads, CMD_ACK, the post-handshake Set push (§6.3), the module handshake (§7). **Start at §1.1 Implementation Status**: the backend accepts JSON telemetry only, has no TLS, and binds every module through the handshake without verifying its identity yet. |
| [platform/CARO_Telemetry_Path_Reference.md](platform/CARO_Telemetry_Path_Reference.md) | What the HMI server and browser do with each message, stage by stage: MQTT bridge → intake → LKV → historian queue → WebSocket → React context → widget. Includes the trend live-tail channel, the outbound command path, every config value, and §12 Known Gaps. |
| [hmi/hmi_API_spec.md](hmi/hmi_API_spec.md) §5, §11 | Setpoint write and command REST endpoints, and the browser WebSocket messages. |

Related: [hmi/trend-viewer/hmi_trend_viewer_reference.md](hmi/trend-viewer/hmi_trend_viewer_reference.md) (historian write path), [mqtt-simulator/mqtt_simulator_bootstrap.md](mqtt-simulator/mqtt_simulator_bootstrap.md) §6–§8 (what the simulator publishes and how it answers commands), `packages/proto/tag.proto` (Protobuf schema).

---

## Apps

| App | API | UI | Status | Anchor → handoff | Deltas |
|---|---|---|---|---|---|
| Tag Registry | 3001 | 5173 | Complete for Phase 1–2 (unbuilt validators and auth listed in its handoff) | `apps/tag-registry/CLAUDE.md` → [tag_registry_handoff.md](tag-registry/tag_registry_handoff.md) | [tag_registry_deltas.md](tag-registry/tag_registry_deltas.md) |
| MQTT Simulator | 3002 | 5174 | Active development (dev/test tool only) | `apps/mqtt-simulator/CLAUDE.md` → [mqtt_simulator_handoff.md](mqtt-simulator/mqtt_simulator_handoff.md) | [mqtt_simulator_deltas.md](mqtt-simulator/mqtt_simulator_deltas.md) |
| CARO HMI | 3003 | 5175 | Trend viewer Phase A Steps 1–12 complete; multi-system UI selection done; module handshake built (identity not verified); auth, commissioning and most CRUD not started | `apps/caro-hmi/CLAUDE.md` (Current State section) | [hmi_deltas.md](hmi/hmi_deltas.md) |
| ↳ HMI Trend Viewer | — | — | Phase A complete | [hmi_trend_viewer_handoff.md](hmi/trend-viewer/hmi_trend_viewer_handoff.md) | [hmi_trend_viewer_deltas.md](hmi/trend-viewer/hmi_trend_viewer_deltas.md) |

`npm run dev` at the repo root clears orphaned ports and starts all six dev servers. `npm run dev:fresh` builds the shared packages first — use it on first run and after pulling package changes (see the build-then-consume note below).

## Packages

| Package | Path | Purpose | Detail |
|---|---|---|---|
| `@caro/db` | `packages/db/` | All PostgreSQL and TimescaleDB access, as named functions | [db/db_handoff.md](db/db_handoff.md) |
| `@caro/ui` | `packages/ui/` | Shared React primitives, tokens, and `apiClient` (`@caro/ui/api/client`). Modal accepts optional `outerStyle` / `headerStyle` / `bodyStyle` inline-style props. | — |
| `@caro/server` | `packages/server/` | Shared Express middleware (`asyncWrap`, `errorHandler`) plus `./env`: `loadEnv()` (two-layer env loading) and `findWorkspaceRoot()` | — |
| `@caro/proto` | `packages/proto/` | Shared Protobuf schemas (`tag.proto`) | [platform/CARO_MQTT_Spec.md](platform/CARO_MQTT_Spec.md) |
| `@caro/hmi-context` | `packages/hmi-context/` | HMI React context, live-value hooks, `projectRoot`, scoped localStorage keys | `apps/caro-hmi/CLAUDE.md` § Shared Packages |
| `@caro/widgets` | `packages/widgets/` | HMI widgets (NumericMon/Set, StringMon, BooleanMon/Set, AnalogIn, Timer, SpectrumChart) | `apps/caro-hmi/CLAUDE.md` § Shared Packages; [hmi/hmi_widget_spec.md](hmi/hmi_widget_spec.md) |
| `@caro/trend-chart` | `packages/trend-chart/` | Trend viewer UI (tile cache, live tail, mode machine, uPlot chart, tag picker) | [hmi_trend_viewer_handoff.md](hmi/trend-viewer/hmi_trend_viewer_handoff.md) §2 |
| `@caro/tag-registry-shared` | `apps/tag-registry/shared/` | Tag Registry validation, types, resolver, cascade simulation | [tag_registry_bootstrap.md](tag-registry/tag_registry_bootstrap.md) §3 |

**Build-then-consume packages — `dist/` is gitignored.** `@caro/server`, `@caro/db`, `@caro/tag-registry-shared` (and others) resolve at runtime via their `dist/` output (`main`/`exports` point there), not their `src/`. Pulling changes to one of these packages without running its `build` script gets you a missing export or a missing constant at **runtime**, not a compile error. For example, `@caro/server`'s `./env` subpath export and `@caro/tag-registry-shared`'s `PROJECT_ROOT_MISMATCH` error code both need `npm run build` in that package before any app sees them.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, React Context (`@caro/hmi-context`) |
| Backend | Node.js + Express |
| Database | PostgreSQL (registry) + TimescaleDB (historian), both via `@caro/db` |
| Messaging | Mosquitto v5 — TCP 1883, WS 8080 |
| Language | TypeScript for all package and app source. JavaScript remains in tests, the tag-registry E2E suite, config files and `scripts/` (see root `CLAUDE.md`). |
| Packages | npm workspaces |

---

## Platform Rules

The hard rules in root `CLAUDE.md` apply everywhere: TypeScript only, no raw SQL in apps, no `DATABASE_URL`, the API envelope, shared packages first, `apps/tag-registry/` as the style reference. Two more rules that need more detail:

- **Env files — two layers:** every server loads env via `loadEnv()` from `@caro/server/env`.
  - The app's own `server/.env` loads first and wins on a conflict.
  - The monorepo root `.env` loads second, filling in only what's still unset (or what a parent process already injected into `process.env`, e.g. e2e's `globalSetup`).
  - Project identity and cross-app-must-agree settings (`PROJECT_ROOT`, `POSTGRES_*`, `TIMESCALE_*`) live at root; each app's own settings live in its own `server/.env`.
  - Never pass `override: true`.
- **TagDef field consumption:** consume `TagDef.{unit, eng_min, eng_max, format, tag_name, trendable}` directly. Never walk `meta` for these fields — `resolveRegistry` applies type-aware gating (e.g., suppressing unit/eng_min/eng_max on Booleans). Use `meta` only for structural data (e.g., `module_id`). This applies everywhere: `loadTagMap`, `resolveFormat`, any widget/hook reading tag metadata.
  - **One exception:** the *module-relative* tag_name (handshake TAG_LIST, Tag Defs export) has no registry column, so it is derived from `meta` — only through `moduleRelativeTagName()` in `@caro/tag-registry-shared`, the one function both consumers share.

## Branching

| Branch | Rule |
|---|---|
| `main` | Stable releases only |
| `dev` | Integration — all work merges here |
| `feature/*` | One branch per feature, PR into `dev` |

---

## Database

Schema spec: [db/CARO_DB_Spec.md](db/CARO_DB_Spec.md). Package and migration detail: [db/db_handoff.md](db/db_handoff.md).

**Main PostgreSQL (port 5432):**
- Migrations are in `db/postgres/migrations/`. Never edit an existing one; add new ones only.
- Present: `001`–`004`, `006`–`018` (005 skipped — do not reuse).
- All three servers call `runMigrations()` from `@caro/db` at startup. Advisory lock `pg_advisory_lock(1)` prevents concurrent migration races.
- Startup sequence: `ping()` → `runMigrations()` → app init. Either step failing causes `process.exit(1)`.

**HMI tables:** `pending_setpoint_values` (016, written but not read) and `commanded_setpoints` (018, every Set's last commanded value, read by the handshake's Set push) are migrated. Neither has a `set_by` FK to `users` yet (a nullable stub, since auth isn't built). `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `system_settings` and `audit_log` remain specified in DB Spec §4–§10 but not yet migrated.

**TimescaleDB (port 5433, separate Docker container, `docker-compose.timescale.yml`):**
- Holds the `tag_samples` hypertable (14-day retention) plus four continuous aggregates: 1s, 10s, 1min and 10min.
- The HMI server migrates it at startup and soft-fails to `NullDbWriter` if it's unreachable; `HistorianReconnector` retries every 30 s and switches over without a restart. **Until then the HMI looks healthy while recording nothing.**
- Setup: [db/hmi_timescale_setup.md](db/hmi_timescale_setup.md). Migrations: [db/db_handoff.md](db/db_handoff.md). Design and performance: [db/DB_Config_Usage_And_Perf.md](db/DB_Config_Usage_And_Perf.md).

**Trap: changing `TIMESCALE_DATABASE` and restarting the container does not create a second historian database.**
- `docker-compose.timescale.yml` substitutes `${TIMESCALE_DATABASE:-caro_timescale}` into `POSTGRES_DB`. Compose reads the root `.env` for this by its own convention, separate from `loadEnv()`.
- The Postgres image only creates `POSTGRES_DB` when its data directory is **empty**. `timescale-data/` stops being empty once `caro_timescale` has been initialized.
- So pointing `TIMESCALE_DATABASE` at a new name and restarting silently keeps using the existing database.
- Create the new database explicitly against the running container instead. See [platform/multi_project_runbook.md](platform/multi_project_runbook.md) §3.2.

---

## Multi-Project Model

CARO_Platform holds one tag registry per **project**. A project is a `PROJECT_ROOT` template name (e.g. `CARO_1`) paired with its own Postgres database and its own TimescaleDB database.

**One project is live at a time.** To switch projects:
1. Edit the root `.env`: `PROJECT_ROOT`, `POSTGRES_DATABASE`, `TIMESCALE_DATABASE`, and any other connection settings that differ.
2. Restart all three servers.

Apps connect to their databases at startup and never change target at runtime; there is no live project switch. Step-by-step instructions and known issues are in [platform/multi_project_runbook.md](platform/multi_project_runbook.md).

**`PROJECT_ROOT` lives in the root `.env`** and does three things:
- **Gates `POST /api/v1/registry/apply`** in the tag-registry server:
  - unset or empty refuses every apply;
  - `*` allows any root (used by the e2e suite, which applies dynamically-named roots per test);
  - any other value allows only an exact match.

  Rejection is `PROJECT_ROOT_MISMATCH`, HTTP 403.
- **Shows the connection** on the Tag Registry client's Registry and History pages as a quiet indicator, alongside the configured database name (`GET /api/v1/config` → `databaseName`, `projectRoot`).
- **Selects the HMI client's page tree and namespaces its localStorage:**
  - The HMI server's own `GET /api/v1/config` serves `projectRoot` only (no `databaseName`, since HMI auth is stubbed).
  - `@caro/hmi-context`'s `useProjectRoot()` exposes it.
  - `client/src/hmi-definitions/registry.ts` maps a registered root to a dynamically imported page tree. An unregistered root, including an unset one, renders the NavTree empty state; there is no fallback to `demo`.
  - `scopedKey(projectRoot, name)` namespaces localStorage as `caro.<projectRoot>.<name>`, falling back to the `unknown` namespace on a null root.

**Why the gate exists:**
- `applyRegistry()` resolves the subtree under the `rootName` passed to it, then calls `getActiveTags()`. That call is unfiltered across the whole `tag_registry` table, and every tag whose `tag_path` is absent from the resolved set gets retired.
- So applying the wrong root against a project's database would retire that project's entire registry.
- Re-applying the correct root afterwards would then reissue every tag_id, because retired paths come back classified as added (see `applyRegistry` in `apps/tag-registry/server/src/services/registryService.ts`).
- `registry_revisions` has no root column at all, so a database's revision history is already implicitly the history of exactly one root, forever.
- The gate makes that unstated invariant explicit and enforced, instead of leaving it to operator discipline.

**Selecting and authoring any root in the client stays unrestricted.** The root dropdown and template editing are unaffected; only the apply action is gated, in two places:
- **Client-side:** the Update DB button is disabled, with a tooltip naming the configured `PROJECT_ROOT` and the selected root.
- **Server-side:** this is the load-bearing check. The client is the only in-repo caller of `/registry/apply` today, but curl or a future provisioning script would bypass client-side disabling entirely.

**Creating a new project (a second `PROJECT_ROOT`, its databases, and its templates) is a future external script, not a feature of any app.** It isn't built yet.

---

## Where to read next

| If your task involves… | Read… |
|---|---|
| What to work on / what's unbuilt | [platform/platform_todo.md](platform/platform_todo.md) |
| Tag Registry (templates, registry apply, Tag Defs export) | `apps/tag-registry/CLAUDE.md` → [tag-registry/](tag-registry/) |
| MQTT Simulator | `apps/mqtt-simulator/CLAUDE.md` → [mqtt-simulator/](mqtt-simulator/) |
| HMI server, client, widgets, commands | `apps/caro-hmi/CLAUDE.md` → [hmi/](hmi/) |
| Trend viewer, trends API, `@caro/trend-chart` | [hmi/trend-viewer/hmi_trend_viewer_handoff.md](hmi/trend-viewer/hmi_trend_viewer_handoff.md) → spec |
| Historian (TimescaleDB, CAGs, perf) | [db/DB_Config_Usage_And_Perf.md](db/DB_Config_Usage_And_Perf.md), [hmi/trend-viewer/hmi_trend_viewer_reference.md](hmi/trend-viewer/hmi_trend_viewer_reference.md) |
| DB schema or a new migration | [db/CARO_DB_Spec.md](db/CARO_DB_Spec.md), [db/db_handoff.md](db/db_handoff.md) |
| MQTT topics, payloads, commands | [platform/CARO_MQTT_Spec.md](platform/CARO_MQTT_Spec.md) |
| The module handshake (binding, Set push, re-bind) | [platform/CARO_MQTT_Spec.md](platform/CARO_MQTT_Spec.md) §7 (protocol) and §6.3 (Set push); [platform/CARO_Telemetry_Path_Reference.md](platform/CARO_Telemetry_Path_Reference.md) §3.4 (backend implementation); [hmi/hmi_functional_spec.md](hmi/hmi_functional_spec.md) §9 (commissioning, not built) |
| End-to-end telemetry flow (device → screen) | [platform/CARO_Telemetry_Path_Reference.md](platform/CARO_Telemetry_Path_Reference.md) |
| Creating or switching a project | [platform/multi_project_runbook.md](platform/multi_project_runbook.md) |

## Doc map

**[platform/](platform/)** — cross-app
| File | What it is |
|---|---|
| [platform_todo.md](platform/platform_todo.md) | The backlog: specified but unbuilt features. |
| [platform_deltas.md](platform/platform_deltas.md) | Open cross-app spec divergences. |
| [multi_project_runbook.md](platform/multi_project_runbook.md) | How to create and switch projects; observed errors; known issues. |
| [CARO_MQTT_Spec.md](platform/CARO_MQTT_Spec.md) | MQTT interface spec (ICD): topics, payloads, CMD/CMD_ACK, the post-handshake Set push, the module handshake; §1.1 says what is built. |
| [CARO_Telemetry_Path_Reference.md](platform/CARO_Telemetry_Path_Reference.md) | Telemetry path from producer to pixel, stage by stage, plus the outbound command path, config and known gaps. |
| [Phase6_RF1_Rig_Test_Report_2026-10-21.md](platform/Phase6_RF1_Rig_Test_Report_2026-10-21.md), [Phase6_RF1_Rig_Test_Rerun_2026-10-21.md](platform/Phase6_RF1_Rig_Test_Rerun_2026-10-21.md) | RF1 rig acceptance tests for the handshake (Phase 6, T1–T6) and the re-run of T4/T6 on library `2d3d105`. Evidence for RF_Control `CARO_MIGRATION.md` §6.1. |

**[db/](db/)** — Postgres + TimescaleDB
| File | What it is |
|---|---|
| [CARO_DB_Spec.md](db/CARO_DB_Spec.md) | Schema spec, including HMI tables not yet migrated. |
| [db_handoff.md](db/db_handoff.md) | `@caro/db` exports, Postgres + TimescaleDB migrations, env vars, rules. |
| [DB_Config_Usage_And_Perf.md](db/DB_Config_Usage_And_Perf.md) | Historian config, CAG dispatch and the performance evidence behind them. |
| [hmi_timescale_setup.md](db/hmi_timescale_setup.md) | Docker/TimescaleDB install and first-boot steps. |
| [perf-history/](db/perf-history/) | Historical perf baselines (reference only). |

**[tag-registry/](tag-registry/)**
| File | What it is |
|---|---|
| [tag_registry_handoff.md](tag-registry/tag_registry_handoff.md) | Current state, decisions, gotchas. **Start here for this app.** |
| [tag_registry_deltas.md](tag-registry/tag_registry_deltas.md) | Open divergences. |
| [tag_registry_spec.md](tag-registry/tag_registry_spec.md) | Functional spec: UI behaviour, validation, data model. |
| [tag_registry_api_spec.md](tag-registry/tag_registry_api_spec.md) | REST contracts and error codes. |
| [tag_registry_bootstrap.md](tag-registry/tag_registry_bootstrap.md) | Architecture, stores, `shared/` function signatures. |
| [tag_registry_test_spec.md](tag-registry/tag_registry_test_spec.md) | Unit + E2E suite, selector strategy, gotchas. |

**[mqtt-simulator/](mqtt-simulator/)**
| File | What it is |
|---|---|
| [mqtt_simulator_handoff.md](mqtt-simulator/mqtt_simulator_handoff.md) | Current state, decisions, known defects. **Start here for this app.** |
| [mqtt_simulator_deltas.md](mqtt-simulator/mqtt_simulator_deltas.md) | Open divergences. |
| [mqtt_simulator_bootstrap.md](mqtt-simulator/mqtt_simulator_bootstrap.md) | Architecture, startup, telemetry loop, env vars. |

**[hmi/](hmi/)** — the app anchor `apps/caro-hmi/CLAUDE.md` is the HMI handoff
| File | What it is |
|---|---|
| [hmi_deltas.md](hmi/hmi_deltas.md) | Open divergences. |
| [hmi_functional_spec.md](hmi/hmi_functional_spec.md) | Functional spec: architecture, auth, data model, commissioning. |
| [hmi_API_spec.md](hmi/hmi_API_spec.md) | REST + WebSocket contracts (built and planned). |
| [hmi_widget_spec.md](hmi/hmi_widget_spec.md) | Widget contract and catalog. |
| [hmi_bootstrap.md](hmi/hmi_bootstrap.md) | First-time setup, data flow, folder structure, widget pattern. |

**[hmi/trend-viewer/](hmi/trend-viewer/)**
| File | What it is |
|---|---|
| [hmi_trend_viewer_handoff.md](hmi/trend-viewer/hmi_trend_viewer_handoff.md) | As-built file map, mode machine, cache, divergences. **Start here for trend work.** |
| [hmi_trend_viewer_deltas.md](hmi/trend-viewer/hmi_trend_viewer_deltas.md) | Open divergences. |
| [hmi_trend_viewer_spec.md](hmi/trend-viewer/hmi_trend_viewer_spec.md) | Design spec (large; read by section). |
| [hmi_trend_viewer_reference.md](hmi/trend-viewer/hmi_trend_viewer_reference.md) | Historian write path: tag change → hypertable row. |
| [hmi_trends_perf_test_spec.md](hmi/trend-viewer/hmi_trends_perf_test_spec.md) | `/dev/trends-perf` test page spec. |
