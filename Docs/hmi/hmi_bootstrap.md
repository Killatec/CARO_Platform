# CARO HMI — Bootstrap Guide

**Updated:** 2026-10-17 | **App anchor:** `apps/caro-hmi/CLAUDE.md` (current state, module tables, design decisions)

This guide covers getting the HMI running and its overall shape. Module-level detail lives in the app anchor; trend-viewer detail lives in `Docs/hmi/trend-viewer/`.

---

## Prerequisites

| Dependency | Required | Notes |
|---|---|---|
| PostgreSQL | Running on 5432 | Native install. Database, user and password come from the root `.env` (`POSTGRES_*`). |
| Tag Registry | Seeded | At least one registry revision applied, so `tag_registry` has rows. The HMI starts against an empty registry but has nothing to show. |
| TimescaleDB | Optional, but needed for trends | Docker container on 5433 — see `Docs/db/hmi_timescale_setup.md`. If it's unreachable, the HMI starts on `NullDbWriter` and records nothing until `HistorianReconnector` gets through. |
| Mosquitto | Running on 1883 | MQTT broker — no auth in dev |
| MQTT Simulator | Optional | `apps/mqtt-simulator` — publishes simulated telemetry at ~10 Hz |

---

## First-Time Setup

```bash
# 1. Install all workspace dependencies from monorepo root
npm install

# 2. Root .env — project identity and database connections, shared by all three servers
cp .env.example .env                                         # then set POSTGRES_PASSWORD, TIMESCALE_PASSWORD

# 3. HMI app-local settings (MQTT URL, port, pipeline tuning)
cp apps/caro-hmi/server/.env.example apps/caro-hmi/server/.env

# 4. Build the shared packages, then start everything (all 6 dev servers)
npm run dev:fresh
```

After the first run, `npm run dev` is enough; it clears orphaned ports itself before starting. Run `npm run dev:fresh` again after pulling changes to any shared package, because apps consume packages from their `dist/` output (see `Docs/README.md` § Packages). `npm run dev:kill` only kills orphaned processes on 3001–3003 and 5173–5175; it doesn't start anything.

Env loading is two-layer (`loadEnv()` from `@caro/server/env`): `apps/caro-hmi/server/.env` wins, and the root `.env` fills in the rest. The full variable list is in `apps/caro-hmi/CLAUDE.md` § Environment.

---

## Dev Servers

| Service | Port | Command (standalone) |
|---|---|---|
| Tag Registry server | 3001 | `cd apps/tag-registry/server && npm run dev` |
| Tag Registry client | 5173 | `cd apps/tag-registry/client && npm run dev` |
| MQTT Simulator server | 3002 | `cd apps/mqtt-simulator/server && npm run dev` |
| MQTT Simulator client | 5174 | `cd apps/mqtt-simulator/client && npm run dev` |
| HMI server | 3003 | `cd apps/caro-hmi/server && npm run dev` |
| HMI client | 5175 | `cd apps/caro-hmi/client && npm run dev` |

The root `npm run dev` starts all six with `concurrently -k`, color-coded. Each client waits for its server's port first. Note that `-k` tears down every process when any one exits non-zero.

---

## Server Startup Sequence

All three servers follow the same platform sequence:

1. `ping()` — verify PostgreSQL connectivity. Exits with `process.exit(1)` on failure.
2. `runMigrations()` — run pending migrations under advisory lock `pg_advisory_lock(1)`. Exits on failure. The lock prevents races when all three servers start at once.
3. App-level init.

The HMI's app-level init also runs `pingTimescale()` → `runTimescaleMigrations()`, which soft-fails, then wires the pipeline in order: tag map → LKV → TelemetryIntake → HmiTagSource → MQTT bridge → WS server → DbPipeline → TrendSnapshotScheduler → HistorianReconnector. The full sequence is in the anchor's **Entry** row.

---

## E2E Data Flow

```
MQTT Simulator / device (≈10 Hz)
  → Mosquitto (port 1883)
    → HMI Server mqtt-bridge.ts  (transport only — parses payload, extracts moduleId)
      → TelemetryIntake.ingest(moduleId, message)
          → LKV cache (generation bump on value change)
          → DbPipeline (trendable tags, module timestamp) → TimescaleDbWriter → tag_samples hypertable
          → trend-delta listener → WS trend outbox (TREND_DELTA, 4 Hz)
          → watchdog (lastSeen tracking, null-write on timeout)

HmiTagSource (250ms timer, module_type='HMI' tags — Telemetry_CPU, Module_Info.*, Trend_Info.*)
  → TelemetryIntake.ingest(moduleId, message)  (same path as above)

LKV cache
  → WS server (8 Hz tick, per-client generation diff)
    → Browser WebSocket
      → HmiContextProvider (reconciled SUBSCRIBE / UNSUBSCRIBE)
          → HmiDataContext (tagMap, getLiveValue, subscribeLiveValue, writeTag — stable)
          → HmiStatsContext (wsStats — updates every 1 s)
        → useLiveValue(tagId) → widget re-render  [depends on HmiDataContext only]

Trend viewer (@caro/trend-chart)
  → GET /api/v1/trends/tile  (history tiles from TimescaleDB: raw + four CAGs)
  → SUBSCRIBE_TREND on the same WS  (live tail)
```

- `HmiContextProvider` renders nothing until the REST tag map (`/tags`) and `/config` fetches complete (`tagMapLoaded = true`), so widgets never mount against an empty map.
- `HmiContextProvider` is split into `HmiDataContext` (stable) and `HmiStatsContext` (1 Hz), so stats ticks don't cause unsubscribe/re-subscribe churn.
- `TelemetryIntake.ingest()` is the universal entry point for all telemetry. MqttBridge and HmiTagSource are both adapters; future adapters (OPC-UA, Modbus, REST pollers) follow the same pattern.
- Stage-by-stage detail: `Docs/platform/CARO_Telemetry_Path_Reference.md` (live path) and `Docs/hmi/trend-viewer/hmi_trend_viewer_reference.md` (historian write path).

To check the live path end to end, open http://localhost:5175, start the MQTT Simulator from http://localhost:5174, and watch values update. The header badge shows the active `PROJECT_ROOT`. An unregistered root shows "No machine config loaded".

---

## Folder Structure

```
apps/caro-hmi/
├── CLAUDE.md                    # App anchor (read this first)
├── server/
│   ├── .env / .env.example      # App-local settings only (MQTT_URL, HMI_PORT, pipeline tuning)
│   └── src/
│       ├── index.ts             # Entry — startup sequence
│       ├── app.ts               # Express shell — mounts the routes below
│       ├── config.ts            # Env var loader with defaults
│       ├── lkv.ts               # LKV cache with generation counters
│       ├── telemetry-intake.ts  # Transport-agnostic ingest: LKV write, watchdog, DB enqueue, trend deltas
│       ├── mqtt-bridge.ts       # MQTT transport only — delegates to TelemetryIntake
│       ├── mqtt-payloads.ts     # Shape checks for telemetry and CMD_ACK payloads
│       ├── handshake-controller.ts # Module handshake: TAG_LIST, CONFIRM, post-CONFIRM Set push
│       ├── tag-list.ts          # Builds a module's TAG_LIST (module-relative tag_name)
│       ├── hmi-tag-source.ts    # Proxy-based HMI telemetry producer (module_type='HMI')
│       ├── duty-tracker.ts      # Telemetry_CPU: wraps hot paths with performance.now() timing
│       ├── ws-server.ts         # WebSocket server: live values + trend channel
│       ├── db-pipeline.ts       # Historian write queue (peek-then-consume, swappable writer)
│       ├── timescale-writer.ts  # TimescaleDbWriter — wraps @caro/db writeTagSamples()
│       ├── timescale-size-monitor.ts  # Polls historian DB size for Trend_Info.DB_Size
│       ├── historian-reconnect.ts     # Retries TimescaleDB and hot-swaps the writer in
│       ├── trend-snapshot-scheduler.ts # Guarantees ≥1 historian row per trendable tag per interval
│       ├── tag-map.ts           # Tag registry loader
│       ├── cmd-controller.ts    # SET_VALUES writes + module commands, CMD_ACK tracking, setpoint store and Set push
│       ├── reset-bus.ts         # Broadcast reset fan-out
│       ├── routes/
│       │   ├── config.ts        # GET  /api/v1/config      → { projectRoot }
│       │   ├── tags.ts          # GET  /api/v1/tags, /api/v1/tags/trendable; POST /api/v1/tags/write
│       │   ├── commands.ts      # POST /api/v1/commands
│       │   ├── reset.ts         # POST /api/v1/reset
│       │   └── trends.ts        # GET  /api/v1/trends/tile, /api/v1/trends/extent
│       ├── middleware/
│       │   └── auth-stub.ts     # Placeholder auth — accepts all
│       └── types/express.d.ts
├── client/
│   ├── vite.config.ts           # Port 5175, proxy /api and /ws → 3003
│   └── src/
│       ├── main.tsx             # Entry — HmiContextProvider wraps App
│       ├── App.tsx              # Routes to Shell
│       ├── index.css            # Tailwind v4 + @source entries for workspace packages
│       ├── api/                 # modules.ts, reset.ts
│       ├── components/
│       │   └── ModuleInfoTable.tsx
│       ├── shell/               # Shell, Header (projectRoot badge), NavTree, ContentArea, StatsBar, types
│       └── hmi-definitions/
│           ├── registry.ts      # PROJECT_ROOT → dynamic import() of that system's tree
│           ├── shared/          # Boxes reused across systems (Pole, SpecA, HMI/Trend/Module status, …)
│           ├── demo/            # tree.ts + pages/ (Overview, Pole, RF, Power, Cooling, Beam1, Summary,
│           │                    #   and the two Dev pages: TrendsPerfTest, TrendViewerTest)
│           └── Narya1/          # tree.ts + pages/ (SystemOverview, RF1) + boxes/ (Rf1*)
```

---

## Shared Packages (HMI-specific)

| Package | Path | Test Command |
|---|---|---|
| `@caro/hmi-context` | `packages/hmi-context/` | `cd packages/hmi-context && npm test` |
| `@caro/widgets` | `packages/widgets/` | `cd packages/widgets && npm test` |
| `@caro/trend-chart` | `packages/trend-chart/` | `cd packages/trend-chart && npm test` |

Package detail is in `apps/caro-hmi/CLAUDE.md` § Shared Packages. Type-check from the monorepo root:
```bash
npx tsc --noEmit -p packages/hmi-context/tsconfig.json
npx tsc --noEmit -p packages/widgets/tsconfig.json
npx tsc --noEmit -p packages/trend-chart/tsconfig.json
```

### @caro/widgets folder structure

```
packages/widgets/src/
├── index.ts                      # Public exports (widgets + types only)
├── NumericMon.tsx
├── NumericSet.tsx
├── BooleanMon.tsx
├── BooleanSet.tsx
├── AnalogIn.tsx                  # Composite multi-tag widget (9 children)
├── Timer.tsx                     # Set/Mon/Done composite
├── SpectrumChart.tsx             # number[]-tag uPlot line chart (bin-index X axis)
├── css.d.ts                      # Ambient *.css module declaration (uPlot CSS)
└── shared/
    ├── colorMap.ts               # Boolean color constants (hex + Tailwind) keyed by name
    ├── ToggleSwitch.tsx          # Shared toggle switch button (BooleanSet + AnalogIn)
    ├── useNumericInput.ts        # Shared focus/blur/write state for numeric inputs (NumericSet + AnalogIn)
    ├── useTagGroup.ts            # Multi-tag resolver for composite widgets — avoids hooks-in-loops
    ├── useWriteGuard.ts          # Double-click guard (no visual state — invisible)
    ├── useSingleTag.ts           # Single-tag resolver — throws on zero or multiple matches
    ├── WidgetErrorBoundary.tsx   # Error boundary + withErrorBoundary.tsx HOC
    ├── WidgetLabel.tsx
    ├── utils.ts                  # compileFormat, resolveFormat, resolveLabel
    └── widgetStyles.ts           # Shared column widths and class constants
```

`shared/` utilities are internal to `@caro/widgets` and not exported from `index.ts`.

---

## Widget Pattern

Widgets receive an `assetPath` string, not a pre-resolved TagDef object:

```tsx
<NumericMon assetPath="RF_Fwd.monitor" label="RF Forward Power" />
```

Internally, widgets call `useResolveAssetPath(assetPath)` from `@caro/hmi-context`, which does contiguous segment matching against `tag_path` values in the in-memory tag map. Abbreviated paths work as long as they're unambiguous.

Quality is represented by `value === null` — there is no quality enum.

Numeric formatting: `resolveFormat(tag)` reads the registry-resolved `TagDef.format` string (never `meta`) and calls `compileFormat()` once at widget mount:

| Pattern | Output |
|---|---|
| `"#"` | `toFixed(0)` |
| `"#.##"` | `toFixed(2)` |
| `"#.##E+0"` | `toExponential(2)` |
| anything else | `"Format not valid"` |

Default when `format` is null: `"#.##"` (2 decimal places).

---

## Write Guard

Set widgets (`BooleanSet`, `NumericSet`) use `useWriteGuard` from `packages/widgets/src/shared/useWriteGuard.ts` to prevent double-click submissions.
- There is no visual pending state; widgets look identical during writes.
- `NumericSet` uses `readOnly` (not `disabled`) while a write is in flight, so the input keeps focus and the operator can type the next value as soon as the guard clears.

The hook tracks `awaitedValue` and clears it when:

1. The live telemetry value matches the awaited value (write confirmed).
2. A write error is set (rejection surfaced).
3. A safety timeout fires (default 1000ms, configurable via `options.timeoutMs`).

Usage:
```tsx
const { setAwaitedValue, isWriting } = useWriteGuard(tag.tag_id, lv.value, writeError);
// isWriting = true while a write is in flight
// NumericSet: readOnly={!isFocused || isWriting}  (disabled only for badQuality)
// BooleanSet: toggle disabled={badQuality || isWriting}
```

A null live value does not block writes — see the anchor's Key Design Decisions.

---

## Known Limitations

- **Auth is stubbed.** All WebSocket connections and API requests are accepted without authentication.
- **Most HMI database tables are not migrated.** Only `pending_setpoint_values` (016) and `commanded_setpoints` (018) exist; `users`, `sessions`, `audit_log` and the rest are specified in `Docs/db/CARO_DB_Spec.md` but not built.
- **No UI signal when the historian is down.** On `NullDbWriter` the HMI looks healthy while discarding samples — see `Docs/platform/multi_project_runbook.md` § 6.1.
- **JSON WebSocket messages.** Protobuf encoding is planned (Phase 6).

---

## What to Read Next

| If your task involves… | Read… |
|---|---|
| Any HMI work | `apps/caro-hmi/CLAUDE.md` (always first) |
| Server internals | `Docs/hmi/hmi_functional_spec.md` §6, §8 |
| REST or WebSocket API | `Docs/hmi/hmi_API_spec.md` |
| Widget contract or new widgets | `Docs/hmi/hmi_widget_spec.md` |
| Trend viewer | `Docs/hmi/trend-viewer/hmi_trend_viewer_handoff.md` |
| Database schema | `Docs/db/CARO_DB_Spec.md` |
| MQTT message format | `Docs/platform/CARO_MQTT_Spec.md` |
| What's left to build | `Docs/platform/platform_todo.md` |
