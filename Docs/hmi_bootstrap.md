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
    → HMI Server mqtt-bridge.ts
      → LKV cache (generation bump on value change)
      → DB pipeline (module-level timestamp, placeholder flush)
      → WS server (8 Hz tick, per-client generation diff)
        → Browser WebSocket
          → HmiContextProvider (batched SUBSCRIBE)
            → useLiveValue(tagId) → widget re-render

> **Note:** `HmiContextProvider` returns `null` (renders nothing) until the REST tag map fetch completes (`tagMapLoaded = true`). Children do not mount until tags are available, preventing widgets from throwing "no tags found" before the map is populated.
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
│       ├── mqtt-bridge.ts       # MQTT client, telemetry handler, watchdog
│       ├── ws-server.ts         # WebSocket server, per-client subscriptions
│       ├── db-pipeline.ts       # DB write queue (placeholder)
│       ├── tag-map.ts           # Tag registry loader, meta field resolution
│       ├── routes/
│       │   └── tags.ts          # GET /api/v1/tags
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

Quality is represented by `value === null` — there is no quality enum. Decimal formatting comes from the `format` field in `tag.meta`, resolved root-to-leaf (first match wins, default 2).

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
