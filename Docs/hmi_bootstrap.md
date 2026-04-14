# CARO HMI — Bootstrap Guide

**Updated:** 2026-04-08 | **App anchor:** `apps/caro-hmi/CLAUDE.md`

---

## Prerequisites

| Dependency | Required | Notes |
|---|---|---|
| PostgreSQL | Running on 5432 | Database `caro_dev`, user `postgres`, password `KillaDB` |
| Tag Registry | Seeded | At least one tag version applied so `tag_registry` table has rows |
| Mosquitto | Running on 1883 | MQTT broker — no auth required in dev |
| MQTT Simulator | Optional | `apps/mqtt-simulator` — publishes simulated telemetry at ~10 Hz |

---

## First-Time Setup

```bash
# 1. Install all workspace dependencies from monorepo root
npm install

# 2. Verify HMI server .env exists
cat apps/caro-hmi/server/.env
# Should contain: PGHOST, PGPORT, PGUSER=postgres, PGPASSWORD=KillaDB,
# PGDATABASE=caro_dev, MQTT_URL=mqtt://localhost:1883, PORT=3003

# 3. Start everything (all 6 dev servers)
npm run dev

# If ports are stuck from a previous session:
npm run dev:kill   # kills orphans on 3001-3003, 5173-5175, then starts
```

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

The root `npm run dev` starts all six with `concurrently`, color-coded. The `scripts/kill-ports.js` utility handles orphaned Node processes on Windows and Linux.

---

## E2E Data Flow

```
MQTT Simulator (10 Hz)
  → Mosquitto (port 1883)
    → HMI Server mqtt-bridge.ts  (transport only — parses payload, extracts moduleId)
      → TelemetryIntake.ingest(moduleId, message)
          → LKV cache (generation bump on value change)
          → DB pipeline (module-level timestamp, placeholder flush)
          → watchdog (lastSeen tracking, null-write on timeout)

HmiTagSource (250ms timer, module_type='HMI' tags)
  → onBeforePublish: writes DutyTracker.snapshot() → hmiTags.Telemetry_CPU
  → TelemetryIntake.ingest(moduleId, message)
      → (same LKV / DB pipeline path as above)

LKV cache
  → WS server (8 Hz tick, per-client generation diff)
    → Browser WebSocket
      → HmiContextProvider (batched SUBSCRIBE)
        → useLiveValue(tagId) → widget re-render

> **Note:** `HmiContextProvider` returns `null` (renders nothing) until the REST tag map fetch completes (`tagMapLoaded = true`). Children do not mount until tags are available, preventing widgets from throwing "no tags found" before the map is populated.
> **Note:** `TelemetryIntake.ingest()` is the universal entry point for all telemetry regardless of source. MqttBridge and HmiTagSource are both adapters that call it. Future adapters (OPC-UA, Modbus, REST pollers) follow the same pattern.
```

To verify E2E is working: open http://localhost:5175, start the MQTT Simulator from http://localhost:5174, and watch live values update on the demo dashboard.

---

## Folder Structure

```
apps/caro-hmi/
├── CLAUDE.md                    # App anchor (read this first)
├── server/
│   ├── .env                     # PG* vars, MQTT_URL, PORT
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # Entry — startup sequence
│       ├── app.ts               # Express shell
│       ├── config.ts            # Env var loader with defaults
│       ├── lkv.ts               # LKV cache with generation counters
│       ├── telemetry-intake.ts  # Transport-agnostic ingest: LKV write, watchdog, DB enqueue
│       ├── mqtt-bridge.ts       # MQTT transport only — delegates to TelemetryIntake
│       ├── hmi-tag-source.ts    # Proxy-based HMI telemetry producer (module_type='HMI')
│       ├── duty-tracker.ts      # Telemetry_CPU: wraps hot paths with performance.now() timing
│       ├── ws-server.ts         # WebSocket server, per-client subscriptions
│       ├── db-pipeline.ts       # DB write queue (placeholder)
│       ├── tag-map.ts           # Tag registry loader, meta field resolution
│       ├── command-publisher.ts  # SET_VALUES command lifecycle: publish, ACK tracking, timeout
│       ├── routes/
│       │   ├── tags.ts          # GET /api/v1/tags + POST /api/v1/tags/write
│       │   └── modules.ts       # GET /api/v1/modules/status
│       └── middleware/
│           └── auth-stub.ts     # Placeholder auth — accepts all
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts           # Port 5175, proxy /api and /ws → 3003
│   ├── index.html
│   └── src/
│       ├── main.tsx             # Entry — HmiContextProvider wraps App
│       ├── App.tsx              # Routes to Shell
│       ├── components/
│       │   └── ModuleStatusTable.tsx  # Per-module telemetry stats (polls /api/v1/modules/status)
│       ├── shell/
│       │   ├── Shell.tsx        # Layout: Header + NavTree + ContentArea
│       │   ├── Header.tsx
│       │   ├── NavTree.tsx
│       │   ├── ContentArea.tsx
│       │   ├── WidgetErrorBoundary.tsx
│       │   └── types.ts         # TreeNode interface
│       └── hmi-definitions/
│           └── demo/
│               ├── tree.ts      # Nav tree config (single "System Overview" node)
│               └── pages/
│                   └── OverviewPage.tsx   # Demo widgets with assetPath props
```

---

## Shared Packages (HMI-specific)

| Package | Path | Test Command |
|---|---|---|
| `@caro/hmi-context` | `packages/hmi-context/` | `cd packages/hmi-context && npm test` |
| `@caro/widgets` | `packages/widgets/` | `cd packages/widgets && npm test` |

Both packages have full Vitest test suites. Run from monorepo root:
```bash
npx tsc --noEmit -p packages/hmi-context/tsconfig.json
npx tsc --noEmit -p packages/widgets/tsconfig.json
```

---

## Widget Pattern

Widgets receive an `assetPath` string, not a pre-resolved TagDef object:

```tsx
<NumericMon assetPath="RF_Fwd.monitor" label="RF Forward Power" />
```

Internally, widgets call `useResolveAssetPath(assetPath)` from `@caro/hmi-context` which does contiguous segment matching against `tag_path` values in the in-memory tag map. Abbreviated paths work as long as they're unambiguous.

Quality is represented by `value === null` — there is no quality enum.

Numeric formatting uses string format patterns resolved from the `format` field in `tag.meta` (root-to-leaf, first match wins). Patterns are parsed once at widget mount by `compileFormat()`:

| Pattern | Output |
|---|---|
| `"#"` | `toFixed(0)` |
| `"#.##"` | `toFixed(2)` |
| `"#.##E+0"` | `toExponential(2)` |
| `2` (number, backward compat) | treated as `"#.##"` |

Default when no `format` field is found: `"#.##"` (2 decimal places).

---

## Write Guard

Set widgets (`BooleanSet`, `NumericSet`) use `useWriteGuard` from `packages/widgets/src/shared/useWriteGuard.ts` to prevent double-click submissions. There is no visual pending state — widgets look identical during writes. NumericSet uses `readOnly` (not `disabled`) while a write is in flight, so the input retains focus and the operator can type the next value as soon as the guard clears. The hook tracks `awaitedValue` and clears it when:

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

---

## Known Limitations (as of Phase 3)

- **Auth is stubbed.** All WebSocket connections and API requests are accepted without authentication.
- **DB pipeline is a placeholder.** Telemetry is enqueued but flushed silently — no TimescaleDB writes.
- **No HMI database tables.** Migrations for users, sessions, audit_log, etc. have not been created.
- **Demo page only.** The `hmi-definitions/demo/` config is hardcoded for the MQTT Simulator's tag paths. Real machine configs will follow the same pattern.
- **JSON WebSocket messages.** Protobuf encoding is planned for Phase 6.

---

## What to Read Next

| If your task involves… | Read… |
|---|---|
| Any HMI work | `apps/caro-hmi/CLAUDE.md` (always first) |
| Server internals | `Docs/hmi_functional_spec.md` Sections 6, 8 |
| REST or WebSocket API | `Docs/hmi_API_spec.md` |
| Widget contract or new widgets | `Docs/hmi_widget_spec.md` |
| Database schema | `Docs/CARO_DB_Spec.md` |
| MQTT message format | `Docs/CARO_MQTT_Spec.md` |
| What's left to build | `Docs/platform_todo.md` |
