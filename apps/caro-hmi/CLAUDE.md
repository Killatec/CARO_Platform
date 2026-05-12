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
| Telemetry Intake | `server/src/telemetry-intake.ts` | Transport-agnostic ingestion: LKV writes, watchdog (lastSeen tracking, null-write on timeout), DB pipeline enqueue. Universal entry point for all telemetry via `ingest(moduleId, message)`. **Step 11:** calls `trendDeltaListener(moduleTs, tagId, value)` on every COV write for trendable tags; listener registered via `setTrendDeltaListener(fn)` called at startup. |
| MQTT Bridge | `server/src/mqtt-bridge.ts` | Transport only — subscribes `caro/+/telemetry`, parses payload, delegates to `TelemetryIntake.ingest()`. Routes `caro/+/cmd_ack` to `CommandPublisher`. Publishes commands to `caro/{module_id}/cmd`. Heartbeat. |
| HMI Tag Source | `server/src/hmi-tag-source.ts` | Proxy-based telemetry producer for `module_type='HMI'` tags. Property names derived from `tag_path` (strips module segment, joins remaining with `_`). Publishes to TelemetryIntake on configurable timer (default 250ms). Reads 7 Trend_Info values from `DbPipeline` and `TimescaleSizeMonitor` each tick: Trending, Queue_Depth, Rows_Per_Sec, Flush_ms, Dropped_Pkgs, Error_Count, DB_Size. |
| Duty Tracker | `server/src/duty-tracker.ts` | Wraps telemetry hot paths with `performance.now()` timing. `snapshot(intervalMs)` returns duty cycle as percentage, resets accumulator. Fed into `hmiTags.Telemetry_CPU` via `onBeforePublish`. |
| WS Server | `server/src/ws-server.ts` | Pull-based at configurable tick (default 8 Hz / 125 ms). Per-client generation tracking. SUBSCRIBE → SNAPSHOT → DELTA. JSON encoding. **Trend channel (Step 11):** parallel subscription set for trend deltas. SUBSCRIBE_TREND → per-client outbox accumulates `{ moduleTs, tagId, value }` samples. Flushed at `TREND_FLUSH_HZ` (default 4 Hz) as `TREND_DELTA { samples: [...] }` frames, including synthetic events for subscribed tags with no real ingest in the flush window. UNSUBSCRIBE_TREND tears down the trend subscription for those tagIds. `setTrendDeltaListener(fn)` on WsServer registers the ingest callback that `TelemetryIntake` calls on every COV write. |
| DB Pipeline | `server/src/db-pipeline.ts` | Push-based queue from TelemetryIntake. Peek-then-consume flush with inFlight guard. `TimescaleDbWriter` (or `NullDbWriter` fallback). `TIMESCALE_DB_TICK_MS` tick (default 500ms); queue max 5000 (`TIMESCALE_DB_QUEUE_MAX`); max 500 entries per flush (`TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH`). Counters clipped at 9999. `queueDepth` is a tick-held pre-peek snapshot; `queueLength` is live. |
| TimescaleDbWriter | `server/src/timescale-writer.ts` | Wraps `writeTagSamples()` from `@caro/db`. Coerces bool→float, drops NaN/Infinity to null, drops strings to null (logs once per instance). |
| TimescaleSizeMonitor | `server/src/timescale-size-monitor.ts` | Background poll of `pg_database_size()` every `TIMESCALE_SIZE_POLL_MS` (default 30s). Exposes `sizeGB`; started only on the `TimescaleDbWriter` path. Errors held silently (previous value retained); warn logged at most once per hour. |
| Tag Map | `server/src/tag-map.ts` | Loads tag registry from DB. Builds `Map<tag_id, TagDef>`. Meta field resolution: root-to-leaf, first match wins (`getMetaField`). Accepts pre-fetched `ActiveTag[]` to avoid a second DB call. |
| Trend Snapshot Scheduler | `server/src/trend-snapshot-scheduler.ts` | Ensures every trendable tag gets ≥1 DB row per `TREND_SNAPSHOT_INTERVAL_MS` (default 60s). Piggyback path: arms a per-module flag; consumed at the top of `TelemetryIntake.ingest()` to write a full trendable-tag LKV snapshot (using `message.timestamp` as `moduleTs`) instead of the COV delta. Force-write path: if flag still set at next tick (silent module), calls `forceTrendSnapshot()` directly with `moduleTs = Date.now()`. Runs inside `DutyTracker.track()`. |
| Trends REST Endpoint | `server/src/routes/trends.ts` | Two routes. `GET /api/v1/trends/tile` — v0.9 wire contract: query params `tag_ids` (1..8 csv ints), `start_time` (bigint ms), `end_time` (bigint ms), `bucket_count` (1..2500); derives `bucketS` server-side; dispatches on bucketS to raw / 1s / 10s / 1min / 10min CAG with watermark-aware fall-through; aggregate response carries per-series `value`, `min`, `max` arrays (three-case rule: mixed-null → null, empty-bucket → LOCF'd last × 3, normal → `last`/`bucket_min`/`bucket_max`); raw responses carry `ts`/`value` plus optional `prev: { ts, value }` per series (bounded-prev: most-recent sample in [startTime−5min, startTime), v0.9) — discriminated-union invariant; `source` discriminant (`'raw' | 'Xs_cagg' | 'mixed'`); bigint→Number conversion at wire boundary via `serializeTile()`; optional gzip via `HMI_TRENDS_GZIP`. Watermark lookups memoized in `@caro/db` with 30s TTL + in-flight dedup (see §4.3 of trend viewer spec). `GET /api/v1/trends/extent` — no params; returns `{ oldestTs: number\|null, newestTs: number\|null }` (hypertable-wide min/max ts). All delegate to `@caro/db` functions. |
| Config | `server/src/config.ts` | All env vars with defaults. |
| Command Publisher | `server/src/command-publisher.ts` | Publishes SET_VALUES to MQTT, tracks in-flight commands by command_id, resolves/rejects on CMD_ACK or 1s timeout. |
| Write Route | `server/src/routes/tags.ts` | Three routes: `GET /api/v1/tags` (tag list); `GET /api/v1/tags/trendable` (trendable subset: `{ tags: [{ tag_id, tag_path }] }`, filtered from `trendableTagIds` set passed at startup); `POST /api/v1/tags/write` (setpoint writes — validates is_setpoint, module_type='MQTT', type coercion, delegates to CommandPublisher). `/trendable` handler registered before `/` to prevent route capture. |
| Express | `server/src/app.ts` | Express shell with GET + POST `/api/v1/tags` routes. Auth stubbed. |
| Entry | `server/src/index.ts` | Startup sequence: tag rows → tag map → LKV → DutyTracker → TelemetryIntake → HmiTagSource (with DbPipeline + optional TimescaleSizeMonitor) → MQTT bridge → WS attach → DbPipeline.start() → TrendSnapshotScheduler.start() (if `TREND_SNAPSHOT_ENABLED`). Graceful shutdown stops scheduler before DbPipeline. `DbPipeline` owns its own tick; `config.dbTickMs` is not used. |

## Client Architecture

| Module | Path | Purpose |
|---|---|---|
| Shell | `client/src/shell/` | Header, NavTree, ContentArea. Generic HMI chrome. |
| HMI Definitions | `client/src/hmi-definitions/` | Machine-specific nav trees and page components. Currently `demo/` only. |
| Demo Page | `client/src/hmi-definitions/demo/pages/OverviewPage.tsx` | NumericMon × 4, BooleanMon × 3, NumericSet × 2 with WidgetErrorBoundary wrappers. |
| Module Info Table | `client/src/components/ModuleInfoTable.tsx` | WS-driven. Subscribes to six `CARO_1.HMI.Module_Info.*` tags via `useLiveValue`. Renders per-module: name, status, packets/s, KB/s, tags/pkt, packed-bit watchdog indicator. |

Client is a standard Vite React app. `vite.config.ts` proxies `/api` and `/ws` to the server on port 3003.

## Key Design Decisions

- **No quality enum.** Null value = bad quality. Watchdog writes null on telemetry loss.
- **No per-tag timestamp in LKV.** Generation counters drive WS change detection. DB uses module-level timestamp from MQTT.
- **Widgets use `assetPath` string prop**, not pre-resolved TagDef. `useResolveAssetPath(assetPath)` does contiguous segment matching on dot-separated tag_path. Abbreviated paths supported.
- **Tag path resolution uses a prebuilt index.** `TagPathIndex` is built once when the tag map loads; `useResolveAssetPath` and `useTagGroup` both delegate to `tagPathIndex.resolve(path)` for O(1) contiguous-segment matches. Error semantics (no match / ambiguous match) enforced by the consuming hooks, not the index.
- **`useLiveValue` seeds state via `useState` initializer only.** The `subscribeLiveValue` callback fires synchronously on subscribe with the current LKV value, so no mount-time `setLiveValue` is needed. Avoids N redundant state updates per page mount on dense pages.
- **WS subscription is managed by a level-triggered reconciler.** `HmiContextProvider` maintains `desiredRef` (tag IDs the client wants, derived from `useLiveValue` refcounts) and `serverRef` (tag IDs the client has sent to the server). A microtask-batched `flush()` emits at most one `SUBSCRIBE` and one `UNSUBSCRIBE` per tick by diffing the two sets. Same-tick sub/unsub of a tag cancels out — zero wire messages. On reconnect, `serverRef` is cleared and flush emits one `SUBSCRIBE` with everything currently desired.
- **Meta field resolution:** `eng_min`, `eng_max`, `unit`, `format` resolved root-to-leaf from meta array, first match wins.
- **Numeric formatting:** `resolveFormat(tag)` calls `compileFormat(pattern)` once at widget mount. Supports `"#.##"` (fixed-point) and `"#.##E+0"` (exponential) patterns. Numeric `format` values are backward-compatible (treated as decimal count). Default: `"#.##"`.
- **WS pipeline is pull-based** (generation comparison per client per tick). DB pipeline is push-based (TelemetryIntake enqueues directly on every ingest call).
- **TelemetryIntake is the universal ingest entry point.** MqttBridge and HmiTagSource are both adapters. `ingest(moduleId, message)` handles LKV writes, watchdog updates, and DB pipeline enqueue.
- **HmiTagSource uses Proxy for typed property access** (e.g., `hmiTags.Module_Info_Module_Count = 11`). Property names derived from tag_path by stripping the module segment and joining remaining segments with `_`. Publishes to TelemetryIntake every 250ms (env: `HMI_PUBLISH_INTERVAL_MS`).
- **Auth is stubbed** — all connections accepted in dev mode.
- **Setpoint write flow:** Widget → `useTagWriter.write()` → `HmiContextProvider.writeTag()` → `POST /api/v1/tags/write` → `CommandPublisher.publish()` → MQTT SET_VALUES → CMD_ACK → resolve/reject. On `accepted: false`, `writeTag()` throws so the error surfaces in the widget's error display.
- **No visual pending state on write widgets.** `BooleanSet` and `NumericSet` look identical during writes — no spinner, no opacity change. Double-click prevention only: button/input disabled while `isWriting` (via `useWriteGuard`).
- **`module_type` on TagDef.** All tag definitions include `module_type: string` (sourced from `tag_registry.module_type`). Write route rejects setpoint writes targeting non-MQTT modules with `MODULE_TYPE_UNSUPPORTED`.
- **DbPipeline `queueDepth` is a pre-peek, tick-held snapshot.** Inside `flushOnce()`, `_queueDepthAtTick` is captured after the inFlight guard and before any splice — it reflects how many entries faced that tick, not the post-drain residual. `queueLength` (live queue size) is a separate accessor. The tick-held snapshot is stable for observers between ticks.
- **TelemetryIntake null-sentinel on watchdog stall.** When a trendable module transitions from healthy to stalled, TelemetryIntake enqueues a null value for each trendable tag (bad-quality sentinel). The FAULT status branch falls through to the COV enqueue (no early return) so stall transitions are always recorded.
- **TimescaleDbWriter string-drop log guard is per-instance.** `_strDropLogged` is an instance field, not module-level. In practice there is one writer per process, so the behaviour is equivalent; per-instance makes it unit-testable.
- **HmiTagSource never-sampled sentinel is `0`.** The DutyTracker / HmiTagSource "last-sampled" sentinel uses `0`, not `-1`. `performance.now()` is never exactly `0` at runtime, so this is unambiguous in practice.
- **Trends REST wire contract is v0.9 (start_time/end_time/bucket_count + min/max bands + raw prev).** Query params: `tag_ids`, `start_time`, `end_time`, `bucket_count` — no `bucket_s` or `tile_index` on the wire. `bucketS` is derived server-side. Aggregate response carries per-series `value`/`min`/`max` arrays; three-case rule classifies each bucket (mixed-null / empty-collapse / normal — see §6.5). Raw responses (`source: 'raw'`) carry `ts`/`value` and optional `prev: { ts, value }` per series; the discriminated union enforces no min/max leakage. bigints serialized as numbers via `serializeTile()`. See `Docs/hmi_trend_viewer_spec.md` §6.
- **Trends API enforces N ≤ 8 tags per request.** The N≤8 cap (not 20) comes from gate-tested heap-scatter data — the cliff lives at N≈10–11. Charts with more than 8 plotted tags fan out into multiple parallel requests on the client. Route returns 400 (`INVALID_TAG_IDS`) on violation.
- **`HMI_TRENDS_GZIP` (default unset/off) gates Express `compression` middleware scoped to the `/api/v1/trends` mount only.** Does not affect other routes. Added for Phase A gzip A/B perf measurement against dense aggregate tile payloads.
- **TrendSnapshotScheduler uses `private` keyword (not `#`) and `dutyTracker.track(fn)` (not `track(label, fn)`).** Follows existing codebase convention. `DutyTracker.track` takes `fn: () => T` only — no label parameter.
- **TrendSnapshotScheduler piggyback flag is consumed at the top of `ingest()`, before the COV loop.** This ensures the snapshot row uses `message.timestamp` as `moduleTs` rather than `Date.now()`, anchoring the row to the module's own clock. The flag is set by the scheduler tick and consumed at most once per ingest call per module.

## Reading Order by Topic

| If your task involves… | Read (in order)… |
|---|---|
| HMI tag telemetry (HmiTagSource, TelemetryIntake) | 1. This file 2. `server/src/telemetry-intake.ts` 3. `server/src/hmi-tag-source.ts` 4. `server/src/index.ts` (wiring) 5. `Docs/hmi_functional_spec.md` §8.8 |
| MQTT bridge / device telemetry | 1. This file 2. `server/src/mqtt-bridge.ts` 3. `server/src/telemetry-intake.ts` 4. `Docs/CARO_MQTT_Spec.md` |
| Widget rendering / formatting | 1. `Docs/hmi_widget_spec.md` 2. `packages/widgets/src/shared/utils.ts` (compileFormat, resolveFormat) |
| Setpoint write pipeline | 1. This file 2. `server/src/command-publisher.ts` 3. `server/src/routes/tags.ts` 4. `packages/hmi-context/src/HmiContextProvider.tsx` (writeTag) 5. `packages/widgets/src/shared/useWriteGuard.ts` |
| LKV / WebSocket pipeline | 1. This file 2. `server/src/lkv.ts` 3. `server/src/ws-server.ts` 4. `Docs/CARO_Telemetry_Path_Reference.md` |
| Historian write pipeline | 1. This file 2. `server/src/db-pipeline.ts` 3. `server/src/timescale-writer.ts` 4. `server/src/timescale-size-monitor.ts` 5. `Docs/CARO_DB_Spec.md` §9 6. `Docs/hmi_timescale_setup.md` |

## Environment (.env)

```
# Main PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=KillaDB
POSTGRES_DATABASE=caro_dev

# TimescaleDB historian
TIMESCALE_HOST=localhost
TIMESCALE_PORT=5433
TIMESCALE_USER=postgres
TIMESCALE_PASSWORD=KillaDB
TIMESCALE_DATABASE=caro_timescale

# HMI server
MQTT_URL=mqtt://localhost:1883
PORT=3003
WS_TICK_MS=125

# DbPipeline
TIMESCALE_DB_TICK_MS=500
TIMESCALE_DB_QUEUE_MAX=5000
TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH=500

# TimescaleSizeMonitor
TIMESCALE_SIZE_POLL_MS=30000

# TrendSnapshotScheduler
TREND_SNAPSHOT_ENABLED=true
TREND_SNAPSHOT_INTERVAL_MS=60000

# Trends REST endpoint
HMI_TRENDS_GZIP=                  # unset/off by default — any value enables gzip on /api/v1/trends
TIMESCALE_LOG_TILE_QUERIES=        # unset/off by default — set to 1 to log tile query durations

# Trend live tail (Step 11)
TREND_FLUSH_HZ=4                  # flush cadence for TREND_DELTA frames (default 4 Hz)
```

## Phase Status

| Phase | Status | Summary |
|---|---|---|
| 1 — Package Scaffolding | ✅ Complete | hmi-context, widgets packages with full test suites |
| 2 — Server Core | ✅ Complete | LKV, MQTT bridge, WS server, TimescaleDB write pipeline (TimescaleDbWriter + NullDbWriter fallback, peek-then-consume DbPipeline), TimescaleSizeMonitor, 7 Trend_Info observability tags, Express shell |
| 3 — Client Shell | ✅ Complete | Vite React app, shell components, demo page, E2E pipeline working |
| 4 — Auth | Not started | express-session, Argon2id, TOTP MFA |
| 4.5 — DB Migrations | Not started | HMI tables (users, sessions, audit_log, etc.) |
| 5 — REST Endpoints + Trend Chart | In progress (Steps 1–11 done) | Trends API v0.9 complete (tile + extent + trendable routes; min/max bands; three-case rule; raw bounded-prev; watermark memoization). `@caro/trend-chart` package complete through Step 11: `useLiveSubscription` (FIFO + bucket accumulator + raw buffer + 2×viewportSpanMs trim + commitAndDrain), `mergeTrendData` (isTailing live-wins overlap), `isTailing` tile-fetch suppression in `useTrendData`, `dispatchModeAction` tailing-exit cleanup. Dedicated trend WS channel (SUBSCRIBE_TREND/UNSUBSCRIBE_TREND/TREND_DELTA). 542 @caro/trend-chart + 67 @caro/hmi-context + 236 server + 109 @caro/db tests passing. Remaining: Step 12 (tag picker), remaining CRUD per hmi_API_spec. |
| 6 — Protobuf | Not started | Replace JSON WS messages with Protobuf encoding |

## Related Docs

| Document | Path |
|---|---|
| Bootstrap | `Docs/hmi_bootstrap.md` |
| Functional Spec | `Docs/hmi_functional_spec.md` |
| API Spec | `Docs/hmi_API_spec.md` |
| Widget Spec | `Docs/hmi_widget_spec.md` |
| Spec Deltas | `Docs/hmi_deltas.md` |
| Trend Viewer Spec | `Docs/hmi_trend_viewer_spec.md` |
| Trend Viewer Handoff | `Docs/hmi_trend_viewer_handoff.md` |
| Phase 2 Design | `Docs/Phase2_HMI_ServerCore_Design.docx` |
| MQTT Spec | `Docs/CARO_MQTT_Spec.md` |
| DB Spec | `Docs/CARO_DB_Spec.md` |
