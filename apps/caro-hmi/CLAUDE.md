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
| Telemetry Intake | `server/src/telemetry-intake.ts` | Transport-agnostic ingestion: LKV writes, watchdog (lastSeen tracking, null-write on timeout), DB pipeline enqueue. Universal entry point for all telemetry via `ingest(moduleId, message)`. |
| MQTT Bridge | `server/src/mqtt-bridge.ts` | Transport only — subscribes `caro/+/telemetry`, parses payload, delegates to `TelemetryIntake.ingest()`. Publishes commands to `caro/{module_id}/cmd`. Heartbeat. |
| HMI Tag Source | `server/src/hmi-tag-source.ts` | Proxy-based telemetry producer for `module_type='HMI'` tags. Property names derived from `tag_path` (strips module segment, joins remaining with `_`). Publishes to TelemetryIntake on configurable timer (default 250ms). |
| WS Server | `server/src/ws-server.ts` | Pull-based at configurable tick (default 8 Hz / 125 ms). Per-client generation tracking. SUBSCRIBE → SNAPSHOT → DELTA. JSON encoding. |
| DB Pipeline | `server/src/db-pipeline.ts` | Push-based queue from telemetry intake. Module-level timestamp. Placeholder — real implementation writes to TimescaleDB. |
| Tag Map | `server/src/tag-map.ts` | Loads tag registry from DB. Builds `Map<tag_id, TagDef>`. Meta field resolution: root-to-leaf, first match wins (`getMetaField`). Accepts pre-fetched `ActiveTag[]` to avoid a second DB call. |
| Config | `server/src/config.ts` | All env vars with defaults. |
| Express | `server/src/app.ts` | Express shell with `/api/v1/tags` route. Auth stubbed. |
| Entry | `server/src/index.ts` | Startup sequence: tag rows → tag map → LKV → TelemetryIntake → HmiTagSource → MQTT bridge → WS attach → DB flush timer. |

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
- **Numeric formatting:** `resolveFormat(tag)` calls `compileFormat(pattern)` once at widget mount. Supports `"#.##"` (fixed-point) and `"#.##E+0"` (exponential) patterns. Numeric `format` values are backward-compatible (treated as decimal count). Default: `"#.##"`.
- **WS pipeline is pull-based** (generation comparison per client per tick). DB pipeline is push-based (TelemetryIntake enqueues directly on every ingest call).
- **TelemetryIntake is the universal ingest entry point.** MqttBridge and HmiTagSource are both adapters. `ingest(moduleId, message)` handles LKV writes, watchdog updates, and DB pipeline enqueue.
- **HmiTagSource uses Proxy for typed property access** (e.g., `hmiTags.Module_Count = 11`). Property names derived from tag_path by stripping the module segment and joining remaining segments with `_`. Publishes to TelemetryIntake every 250ms (env: `HMI_PUBLISH_INTERVAL_MS`).
- **Auth is stubbed** — all connections accepted in dev mode.

## Reading Order by Topic

| If your task involves… | Read (in order)… |
|---|---|
| HMI tag telemetry (HmiTagSource, TelemetryIntake) | 1. This file 2. `server/src/telemetry-intake.ts` 3. `server/src/hmi-tag-source.ts` 4. `server/src/index.ts` (wiring) 5. `Docs/hmi_functional_spec.md` §8.8 |
| MQTT bridge / device telemetry | 1. This file 2. `server/src/mqtt-bridge.ts` 3. `server/src/telemetry-intake.ts` 4. `Docs/CARO_MQTT_Spec.md` |
| Widget rendering / formatting | 1. `Docs/hmi_widget_spec.md` 2. `packages/widgets/src/shared/utils.ts` (compileFormat, resolveFormat) |
| LKV / WebSocket pipeline | 1. This file 2. `server/src/lkv.ts` 3. `server/src/ws-server.ts` 4. `Docs/CARO_Telemetry_Path_Reference.docx` |

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
