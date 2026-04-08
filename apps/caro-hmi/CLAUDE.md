# CARO HMI — App Anchor

## Quick Start

From monorepo root (starts all 6 dev servers with color-coded output):
```bash
npm run dev
```

Or HMI only:
```bash
# Server (port 3003)
cd apps/caro-hmi/server
npm run dev

# Client (port 5175, proxies /api→3003 and /ws→3003)
cd apps/caro-hmi/client
npm run dev
```

Prerequisites: PostgreSQL running with tag registry populated, Mosquitto on 1883.

## Server Architecture

| Module | File | Purpose |
|---|---|---|
| LKV Cache | `server/src/lkv.ts` | In-memory `Map<tag_id, { value, generation }>`. Generation bumps only on value change (strict equality). |
| MQTT Bridge | `server/src/mqtt-bridge.ts` | Subscribes `caro/+/telemetry`, writes to LKV and DB pipeline. Publishes commands to `caro/{module_id}/cmd`. Watchdog writes null on telemetry loss. Heartbeat. |
| WS Server | `server/src/ws-server.ts` | Pull-based at configurable tick (default 8 Hz / 125 ms). Per-client generation tracking. SUBSCRIBE → SNAPSHOT → DELTA. JSON encoding. |
| DB Pipeline | `server/src/db-pipeline.ts` | Push-based queue from MQTT handler. Module-level timestamp. Placeholder — real implementation writes to TimescaleDB. |
| Tag Map | `server/src/tag-map.ts` | Loads tag registry from DB. Builds `Map<tag_id, TagDef>`. Meta field resolution: root-to-leaf, first match wins (`getMetaField`). |
| Config | `server/src/config.ts` | All env vars with defaults. |
| Express | `server/src/app.ts` | Express shell with `/api/v1/tags` route. Auth stubbed. |
| Entry | `server/src/index.ts` | Startup sequence: tag map → LKV init → MQTT connect → WS attach → DB flush timer. |

## Client Architecture

| Module | Path | Purpose |
|---|---|---|
| Shell | `client/src/shell/` | Header, NavTree, ContentArea. Generic HMI chrome. |
| HMI Definitions | `client/src/hmi-definitions/` | Machine-specific nav trees and page components. Currently `demo/` only. |
| Demo Page | `client/src/hmi-definitions/demo/pages/OverviewPage.tsx` | NumericMon × 4, BooleanMon × 3, NumericSet × 2 with WidgetErrorBoundary wrappers. |

Client is a standard Vite React app. `vite.config.ts` proxies `/api` and `/ws` to the server on port 3003.

## Key Design Decisions

- **No quality enum.** Null value = bad quality. Watchdog writes null on telemetry loss.
- **No per-tag timestamp in LKV.** Generation counters drive WS change detection. DB uses module-level timestamp from MQTT.
- **Widgets use `assetPath` string prop**, not pre-resolved TagDef. `useResolveAssetPath(assetPath)` does contiguous segment matching on dot-separated tag_path. Abbreviated paths supported.
- **Meta field resolution:** `eng_min`, `eng_max`, `unit`, `format` resolved root-to-leaf from meta array, first match wins.
- **Decimal formatting:** From tag.meta `format` field via resolution rule, default 2.
- **WS pipeline is pull-based** (generation comparison per client per tick). DB pipeline is push-based (MQTT handler enqueues directly).
- **Auth is stubbed** — all connections accepted in dev mode.

## Environment (.env)

```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=KillaDB
PGDATABASE=caro_dev
MQTT_URL=mqtt://localhost:1883
PORT=3003
WS_TICK_MS=125
DB_TICK_MS=1000
```

## Phase Status

| Phase | Status | Summary |
|---|---|---|
| 1 — Package Scaffolding | ✅ Complete | hmi-context, widgets packages with full test suites |
| 2 — Server Core | ✅ Complete | LKV, MQTT bridge, WS server, DB pipeline placeholder, Express shell |
| 3 — Client Shell | ✅ Complete | Vite React app, shell components, demo page, E2E pipeline working |
| 4 — Auth | Not started | express-session, Argon2id, TOTP MFA |
| 4.5 — DB Migrations | Not started | HMI tables (users, sessions, audit_log, etc.) |
| 5 — REST Endpoints | Not started | Full CRUD per hmi_API_spec |
| 6 — Protobuf | Not started | Replace JSON WS messages with Protobuf encoding |

## Related Docs

| Document | Path |
|---|---|
| Bootstrap | `Docs/hmi_bootstrap.md` |
| Functional Spec | `Docs/hmi_functional_spec.md` |
| API Spec | `Docs/hmi_API_spec.md` |
| Widget Spec | `Docs/hmi_widget_spec.md` |
| Spec Deltas | `Docs/hmi_deltas.md` |
| Phase 2 Design | `Docs/Phase2_HMI_ServerCore_Design.docx` |
| MQTT Spec | `Docs/CARO_MQTT_Spec.md` |
| DB Spec | `Docs/CARO_DB_Spec.md` |
