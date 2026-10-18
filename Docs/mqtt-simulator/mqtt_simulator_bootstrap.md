# MQTT Simulator — Bootstrap
**Updated:** 2026-10-18
Companion docs: `CARO_MQTT_Spec.md` | `CARO_DB_Spec.md`

---

## 1. Folder Structure

```
apps/mqtt-simulator/
  CLAUDE.md, README.md
  server/                        the real server package (mqtt-simulator-server); no src/ subfolder
    index.ts                     entry: loadEnv, DB ping + migrations, app.listen, auto-start
    app.ts                       Express factory, CORS, routes mount, error handler
    routes/simulator.ts          all REST endpoints
    services/
      mqttClient.ts              connect(), disconnect(), getClient()
      simulatorService.ts        start(), stop(), getStatus(), getLogs(), tick loop, command handler, module toggles
      simGenerators.ts           pure value generators (tested)
      registry.ts                loadTagRegistry() — calls @caro/db, filters MQTT, maps rows to SimTag
      protobuf.ts                loadProto(), encodeProto()
    __tests__/simGenerators.test.ts
    types/cors.d.ts
    .env / .env.example
  client/
    vite.config.ts               port 5174, proxy /api → :3002
    src/
      App.tsx, main.tsx
      components/SimulatorPanel.tsx
      stores/useSimulatorStore.ts
      api/simulator.ts
      index.css                  @import "tailwindcss"; @source "../../../../packages/ui/src"
  package.json                   stale shell from the pre-TypeScript layout: its scripts point at src/index.js, which does not exist. Run the server from server/.
  test_actual_encoding.js, test_proto.js   loose JavaScript scratch scripts at the app root (not part of the build or tests)
  e2e/, public/, shared/, src/   empty except for .gitkeep
```

---

## 2. Environment Variables

Loaded in two layers via `loadEnv()` from `@caro/server/env`: `apps/mqtt-simulator/server/.env` (app-local) loads first and wins on a conflict; the monorepo root `.env` loads second, filling in only what's still unset. Never pass `override: true`.

Root `.env` (shared with tag-registry and caro-hmi — see root `CLAUDE.md` and `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DATABASE` | `caro_dev` | |
| `POSTGRES_USER` | `postgres` | |
| `POSTGRES_PASSWORD` | — | **Required** |

App-local `server/.env` (see `server/.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | **Not actually read from env** — see `Docs/mqtt-simulator/mqtt_simulator_handoff.md` Gotchas. Always uses this default. |
| `MQTT_CLIENT_ID` | `caro-simulator` | Must be unique on broker. **Not actually read from env** — see `Docs/mqtt-simulator/mqtt_simulator_handoff.md` Gotchas. Always uses this default. |
| `LOG_BUFFER_SIZE` | `200` | Rolling in-memory log entries. **Not actually read from env** — see `Docs/mqtt-simulator/mqtt_simulator_handoff.md` Gotchas. Always uses this default. |
| `SIMULATOR_EXCLUDE_MODULES` | _(unset)_ | Comma-separated `module` names to exclude at registry load time (e.g. `Pole,Aux`). Excluded modules are stripped from `loadTagRegistry()` — no telemetry published, no cmd subscription. Applied in `services/registry.ts` after the `module_type = 'MQTT'` filter. |

The tick interval and sine period are **not** env-configurable (earlier versions of this doc listed `TICK_INTERVAL_MS` and `SINE_PERIOD_S`; nothing reads them). Auto-start on boot uses a hardcoded 100 ms (10 Hz). `POST /start` accepts an optional `intervalMs` (integer ≥ 50; 1000 if omitted). The sine period is the constant `SINE_PERIOD_MS = 30000` in `services/simGenerators.ts`.

---

## 3. Startup Sequence

`index.ts`:
1. `loadEnv()` (two layers).
2. `ping()` PostgreSQL — failure exits the process. (A missing `POSTGRES_PASSWORD` only produces a warning from `@caro/db`; the connection then fails here.)
3. `runMigrations()` — failure exits the process.
4. `app.listen(PORT)` (default 3002), then **auto-start**: `start(100)` as a floating promise. An error is written to the log buffer as `[SIM] Auto-start failed: <message>`; the process keeps running so the frontend can retry via `POST /start`.

`simulatorService.start(intervalMs = 1000)`:
1. Return with a warning if already running.
2. `loadProto()` — failure is logged and rethrown.
3. `loadTagRegistry()`: `getActiveTags()`, keep rows with `module_type = 'MQTT'` whose `module` is not in `SIMULATOR_EXCLUDE_MODULES`; `module_id = row.module ?? 'unknown'`. **Zero rows throws** `tag_registry returned no active MQTT tags — apply a registry revision first.` (logged as an auto-start failure — the process does not exit).
4. Mark every module active and initialise simulated values (Section 5).
5. `connect()` to the broker (`clean: true`, reconnect every 2 s). On connect: subscribe `caro/+/cmd` (QoS 1), attach the command handler, and start the tick timer at `intervalMs`.

---

## 4. SimTag Shape

```ts
// services/registry.ts
interface SimTag {
  tag_id:      number;   // getActiveTags() already returns it as a number
  tag_path:    string;
  data_type:   string;   // any tag_types value: f32, bool, i16, i32, string, f32[], i16[]
  is_setpoint: boolean;
  module_id:   string;   // row.module ?? 'unknown'
}

// services/simulatorService.ts — per-tag simulation state, Map<tag_id, …>
{ simValue: number | boolean; simT: number; lastPublishedValue?: number | boolean; previousValue?: number | boolean }
```

There is no `overridden` field; the REST override feature it was meant for is not built.

`module_id` derivation:
```ts
module_id: row.module ?? 'unknown'
```
Taken directly from the `tag_registry.module` column — no meta array parsing.

---

## 5. Simulated Value Initialization

**Monitor tags (`is_setpoint: false`):**

| `data_type` | Initial | Per-tick update |
|---|---|---|
| `f32` | Sine-wave value at a random phase (`simT` random in 0–30 000 ms) | `50 + 25 * sin(2π * simT / SINE_PERIOD_MS)`. `simT` advances by the tick interval each tick. `advanceF32Value` in `simGenerators.ts`. |
| `i16`, `i32` | Sine-wave value at a random phase (`simT` random in 0–30 000 ms) | Same sine wave, rounded and clamped to the type's range: `advanceIntValue(simT, deltaMs, range)` in `simGenerators.ts`, with exported `I16_RANGE` / `I32_RANGE`. |
| `bool` | Random (`initBoolValue` — coin flip per tag) | Flips on every tick (`advanceBoolValue`). Tags don't move in sync because their initial values are independent. |

**Setpoint tags (`is_setpoint: true`):**

| `data_type` | Initial |
|---|---|
| `f32` | `0` |
| `i16`, `i32` | `0`; "Change Sets" randomizes to an integer in −100…100 |
| `bool` | `false` |

All tags start with `simT: 0`.

---

## 6. Telemetry Loop

`setInterval` at the start interval (100 ms on auto-start; `intervalMs` from `POST /start`). Per tick:

1. Advance `simValue` and `simT` for all monitor tags across all modules.
2. For each `module_id`: skip if not in `activeModules`.
3. Determine publish payload by mode flags (four branches below).
4. Set `lastPublishedCount` and `lastPublishedBytes` for the module.
5. Publish to `caro/{module_id}/telemetry`, QoS 0, `retain: false`.

**Per-module mode Sets (initialized in `services/simulatorService.ts`):**
```js
const activeModules = new Set(allModuleIds);  // all active on startup
const deltaMode     = new Set();               // empty — full publish default
const protobufMode  = new Set();               // empty — JSON default
```

**Four publish branches:**

| Mode | Payload |
|---|---|
| Full + JSON | All tags; `JSON.stringify(msg)` |
| Full + Protobuf | All tags; `encodeProto()` → Buffer |
| Delta + JSON | Changed tags only (`simValue !== previousValue`); update `previousValue` for all after comparison; may publish empty `tags` array |
| Delta + Protobuf | Changed tags only; `encodeProto()` → Buffer |

**`TelemetryMessage` shape (per `CARO_MQTT_Spec` §5):**
```js
{
  timestamp: uint64,             // Date.now() ms
  status:    "ONLINE" | "FAULT", // "FAULT" while the module's fault toggle is on
  tags: [ { tag_id: uint32, value: <encoded per data_type> } ]
}
```

The HMI backend decodes JSON only. A module switched to Protobuf is ignored by the HMI and soon shows as STALLED there; use Protobuf mode only to exercise other consumers of `tag.proto`.

**`publishNow(moduleId)`** — immediate out-of-tick full publish. Used by REQUEST_SNAPSHOT and `POST /snapshot/:module_id`. Respects `protobufMode`. Updates `lastPublishedCount` and `lastPublishedBytes`. Delta mode not applied.

---

## 7. Command Handling

All commands arrive and are responded to as JSON. Protobuf is for telemetry only.

Subscription: `caro/+/cmd`, QoS 1.

**Pre-processing guards** (checked in order, before any command parsing or dedup):

1. **Skip ACK:** if enabled for the module (`skipAckEnabled.has(moduleId)`), the command is silently dropped — no parsing, no processing, no CMD_ACK published. Log: `[SIM] Module {moduleId} skip-ack enabled — dropping command (no ACK)`.
2. **Transmitting off:** if the module is not in `activeModules`, the command is silently dropped — no CMD_ACK. Log: `[SIM] Module {moduleId} not transmitting — dropping command (no ACK)`.

These guards fire before command_id deduplication — dropped commands are not recorded in the dedup Set.

**SET_VALUES** — incoming `CommandEnvelope` per `CARO_MQTT_Spec` §6.1:
```js
{
  command_id:   "cmd-abc123",
  command_type: "SET_VALUES",
  ts_utc_ms:    1743073812000,
  payload: {
    values: [
      { tag_id: 1003, value: 42.5 },
      { tag_id: 1004, value: true }
    ]
  }
}
```
Note: `values` nested under `payload.values` — not top-level on the envelope.

Processing:
1. **Accept Sets guard:** if disabled for the module (`acceptSetsDisabled.has(moduleId)`), all tags in the command are rejected with `rejection_code: 'MODULE_FAULT'`. CMD_ACK is still published. No tag values are updated. Log: `[SIM] SET_VALUES rejected — acceptSets disabled for {moduleId}`.
2. Validate `command_type === 'SET_VALUES'`.
3. For each `{ tag_id, value }`: validate that the tag exists in the simulator's registry (any MQTT module; the lookup is not scoped to the commanded module) and that `is_setpoint === true`. If valid: update `simValue`. If not: mark `UNKNOWN_TAG` in CMD_ACK. Values are not range-checked, so `OUT_OF_RANGE` is never produced.
4. Publish CMD_ACK immediately to `caro/{module_id}/cmd_ack`, QoS 1.
5. Updated values surface on next scheduled tick — no out-of-tick publish.

> *NOTE: The Accept Sets guard only affects SET_VALUES commands. REQUEST_SNAPSHOT and RESET commands are unaffected.*

**CMD_ACK shape** per `CARO_MQTT_Spec` §6.2:
```js
{
  command_id:   "cmd-abc123",
  command_type: "SET_VALUES",
  ts_utc_ms:    1743073812050,
  results: [
    { tag_id: 1003, accepted: true },
    { tag_id: 9999, accepted: false, rejection_code: "UNKNOWN_TAG" }
  ]
}
```

**RESET** — increments the module's `Reset_Count` tag (an i16 monitor tag, initialized to 0 and excluded from the sine simulation) if it has one. Other tag values are not reset. CMD_ACK published with empty `results`.

**REQUEST_SNAPSHOT** — calls `publishNow(moduleId)`. CMD_ACK published with empty `results`.

**Any other `command_type`** (e.g. `Stop_App`, `Home` from the HMI's `POST /api/v1/commands`) — no effect; CMD_ACK published with empty `results`, which the HMI treats as accepted.

A message without `command_type` is dropped with a warning and no ACK.

`command_id` deduplication: 60-second rolling TTL Set. Duplicate commands within the window are dropped with a warning and **no CMD_ACK**; `CARO_MQTT_Spec` §6.2 expects a `DUPLICATE` rejection instead. A command without `command_id` is processed normally. The simulator does not subscribe to `caro/+/beat` and does not evaluate `EXPIRED`.

**No handshake.** The simulator does not implement the module side of the handshake (`CARO_MQTT_Spec` §7): it neither subscribes to `caro/+/handshake_backend` nor publishes a HANDSHAKE_REQUEST, and it uses the registry's tag_ids directly. Since 2026-10-18 the HMI sends Sets and REQUEST_SNAPSHOT only after a bind (plus REQUEST_SNAPSHOT on watchdog recovery), so a simulated module gets no Set push after an HMI restart. Its telemetry is still ingested, and operator writes and commands still reach it. Tracked in `Docs/platform/platform_todo.md`.

---

## 8. Protobuf Encoding

Implemented in `server/services/protobuf.ts`. Schema: `packages/proto/tag.proto` (authoritative — do not duplicate under `apps/mqtt-simulator/`).

`loadProto()` called once at `start()` time:
```js
const protoPath = path.resolve(__dirname, '../../../../packages/proto/tag.proto');
```

`encodeProto(moduleId, richTags, status)` returns a Buffer.

Tag value `oneof` field per `data_type`:

| `data_type` | Protobuf field | Proto type | JS type |
|---|---|---|---|
| `f32` | `float_value` | `float` (32-bit IEEE 754) | number |
| `bool` | `bool_value` | `bool` | boolean |
| `i16` | `int_value` | `int32` (clamped to −32768…32767) | number |
| `i32` | `int_value` | `int32` (clamped to ±2³¹) | number |
| `string` | `string_value` | `string` | string |
| `f32[]` | `float_array_value` | `FloatArray { repeated float values }` | number[] |
| `i16[]` | `int_array_value` | `Int32Array { repeated int32 values }` | number[] |

Encoding runs `TelemetryMessage.verify()` first; a failure is logged and nothing is published for that tick.

`protobufjs` installed at monorepo root (not server-local — blocked by `@caro/db` workspace resolution). Run `npm install` from monorepo root if missing.

**JSON telemetry format** (`CARO_MQTT_Spec` §5.1 — the default, and the only format the HMI decodes):
```js
{
  timestamp: 1743073812000,
  status: "ONLINE",
  tags: [
    { tag_id: 1003, value: 62.34 },
    { tag_id: 1004, value: true }
  ]
}
```
Values use native JSON types per `data_type`.

---

## 9. REST API

All endpoints prefixed `/api/v1/simulator/`. Base URL: `http://localhost:3002`.
Response envelope: `{ ok, data }` / `{ ok, error: { code, message } }`.

### Implemented

| Method | Path | Description |
|---|---|---|
| `POST` | `/start` | Start simulator. Body: `{ intervalMs? }` (integer ≥ 50, default 1000; else 400 `VALIDATION_ERROR`). Returns 202 with the status — MQTT connect is async, so `running` may still be `false`. 409 `SIMULATOR_ALREADY_RUNNING`. A registry with no MQTT tags fails with 500. |
| `POST` | `/stop` | Stop simulator; clears all per-module modes. 409 `SIMULATOR_NOT_RUNNING`. |
| `GET` | `/status` | Returns `{ running, intervalMs, modules, uptime_s, tickCount }`. |
| `GET` | `/logs` | Returns `[{ ts, level, msg }]` — rolling buffer, oldest-first. |
| `POST` | `/telemetry/stop/:module_id` | Stop telemetry for one module. 404/409. |
| `POST` | `/telemetry/start/:module_id` | Start telemetry for one module. 404/409. |
| `POST` | `/delta/enable/:module_id` | Enable delta mode. 404/409. |
| `POST` | `/delta/disable/:module_id` | Disable delta mode. 404/409. |
| `POST` | `/protobuf/enable/:module_id` | Enable Protobuf encoding. 404/409. |
| `POST` | `/protobuf/disable/:module_id` | Disable Protobuf encoding. 404/409. |
| `POST` | `/snapshot/:module_id` | Immediate full publish, bypasses delta. 404/409. |
| `POST` | `/inject/:module_id` | Randomize all setpoint values. 404/409/400 (no setpoints). |
| `POST` | `/accept-sets/:module_id/activate` | Enable SET_VALUES acceptance (default state). 404/409. |
| `POST` | `/accept-sets/:module_id/deactivate` | Disable SET_VALUES acceptance — rejects all tags with `MODULE_FAULT`. CMD_ACK still published. 404/409. |
| `POST` | `/skip-ack/:module_id/activate` | Enable silent command drop — no parsing, no CMD_ACK published. 404/409. |
| `POST` | `/skip-ack/:module_id/deactivate` | Disable silent command drop — CMD_ACK published normally. 404/409. |
| `POST` | `/fault/enable/:module_id` | Publish `status: "FAULT"` in this module's telemetry. 404/409. |
| `POST` | `/fault/disable/:module_id` | Back to `status: "ONLINE"`. 404/409. |

Per-module routes return 409 `SIMULATOR_NOT_RUNNING` when the simulator is stopped and 404 `MODULE_NOT_FOUND` for an unknown module; `/inject` also returns 400 `NO_SETPOINT_TAGS`. Success bodies are `{ ok: true }`. Unlike the platform convention, these routes call `res.status(...).json(...)` directly for their own errors; only unexpected errors go through `@caro/server`'s `errorHandler`.

### `/status` Response Shape

```js
{
  ok: true,
  data: {
    running:    true,
    intervalMs: 100,
    modules: [
      {
        module_id: "RF1",
        active:    true,
        tag_count: 12,    // live count from last publish, not static registry count
        bytes:     284,   // byte size of last published payload
        delta:      false,
        protobuf:   false,
        acceptSets: true,
        skipAck:    false,
        fault:      false
      }
    ],
    uptime_s:  142,
    tickCount: 1420
  }
}
```

---

## 10. Log Buffer

`log(level, msg)` in `simulatorService.ts` appends `{ ts, level, msg }` to the in-memory `logBuffer` (max 200 entries — `LOG_BUFFER_SIZE` is not read from the environment, see the handoff Gotchas) and also writes to the console. `GET /logs` returns the buffer oldest-first. Startup lines from `index.ts` (DB connect, env, listen URL) go to the console only, except the auto-start failure.

Messages the simulator logs (from `simulatorService.ts`):

| Event | Level | Message |
|---|---|---|
| Start called while running | WARN | `[SIM] Already running.` |
| Protobuf schema load failed | ERROR | `[SIM] Failed to load Protobuf schema: <err>` |
| Registry load | INFO | `[SIM] Loading tag registry from database…` / `[SIM] Loaded <N> tags across modules: <ids>` |
| Subscribed | INFO / ERROR | `[SIM] Subscribed to caro/+/cmd` / `[SIM] Failed to subscribe to cmd topics: <err>` |
| Started / stopped | INFO | `[SIM] Started — interval: <ms>ms` / `[SIM] Stopped.` |
| Tick while broker down | WARN | `[SIM] MQTT not connected — skipping tick` |
| Protobuf encode failed | ERROR | `[SIM] Proto encode failed for <module>: <err>` |
| Command dropped | INFO | `[SIM] Module <id> skip-ack enabled — dropping command (no ACK)` / `[SIM] Module <id> not transmitting — dropping command (no ACK)` |
| Bad command | WARN | `[SIM] Unparseable command on <topic>` / `[SIM] Invalid command envelope on <topic>` / `[SIM] Duplicate command_id <id> — dropping` |
| Command received | INFO | `[SIM] CMD <command_type> ← <module> (id: <command_id>)` |
| SET_VALUES | INFO / WARN | `[SIM] SET_VALUES: tag_id <id> (<path>) → <value>`; rejections: `…acceptSets disabled…`, `…unknown tag_id…`, `…is not a setpoint — rejected` |
| RESET | INFO | `[SIM] RESET for module <id> — count: <n>` |
| Snapshot / Change Sets | INFO | `[SIM] Snapshot published → <id>` / `[SIM] Change Sets → <id>: <n> setpoint tags randomized` |
| Auto-start failure (from `index.ts`) | ERROR | `[SIM] Auto-start failed: <err>` |

---

## 11. Frontend

React+Vite at port 5174. Mirrors `apps/tag-registry/client/` conventions.

**`useSimulatorStore`** state: `{ running, modules, intervalMs, uptime_s, tickCount, error }`. Actions: `setStatus` (spreads the status and clears `error`), `setError`.

**`SimulatorPanel`** layout:
- Header: title, RUNNING/STOPPED badge, Start/Stop button.
- Modules table (`max-w-5xl`): Module | Tags | Bytes | Transmitting | Delta | Protobuf | Accept Sets | Skip ACK | Fault | Actions. All checkbox columns (Transmitting, Delta, Protobuf, Accept Sets, Skip ACK, Fault) are centered. Each checkbox calls the corresponding REST endpoint then re-fetches status. Actions: "Rqst Snapshot", "Change Sets" buttons per row.
- Logs terminal (`max-w-5xl`, `h-64`, dark bg): auto-scrolls to bottom unless user has scrolled up. Entries: `{ ts, level, msg }` with level-coloured brackets.

Poll intervals: status 200ms; logs 2000ms.

**`apiClient`:** imported from `@caro/ui/api/client`. `cache: 'no-store'` on all GETs.

---

## 12. `package.json`

The server package is `apps/mqtt-simulator/server/package.json` (`mqtt-simulator-server`):

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev":   "nodemon --ext ts,json --watch . --exec \"npx tsx index.ts\"",
    "test":  "vitest run"
  },
  "dependencies": { "@caro/db": "*", "@caro/server": "*", "cors": "^2.8.5", "dotenv": "^16.0.0", "express": "^4.18.0", "mqtt": "^5.0.0" }
}
```

`protobufjs` is not a server dependency; it resolves from the monorepo root `node_modules` (see the handoff Key Decisions). The `apps/mqtt-simulator/package.json` at the app root (`@caro/mqtt-simulator`) is a leftover: its `start`/`dev` scripts reference `src/index.js`, which does not exist.

`asyncWrap` and `errorHandler` are imported from `@caro/server` — no local `middleware/` directory.
