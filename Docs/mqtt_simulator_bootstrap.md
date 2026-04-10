# MQTT Simulator — Bootstrap
**Updated:** 2026-04-05
Companion docs: `CARO_MQTT_Spec.md` | `CARO_DB_Spec.md`

---

## 1. Folder Structure

```
apps/mqtt-simulator/
  Docs/
  server/
    src/
      index.js                   entry point, env validation, auto-start, app.listen
      app.js                     Express factory, CORS, routes mount, error handler
      routes/
        simulator.js             all REST endpoints
      services/
        mqttClient.js            connect(), disconnect(), getClient()
        simulatorService.js      start(), stop(), getStatus(), getLogs(), tick loop, command handler
        registry.js              loadTagRegistry() — calls @caro/db, maps rows to SimTag
        protobuf.js              loadProto(), encodeProto()
      __tests__/
  client/
    src/
      components/SimulatorPanel.jsx
      stores/useSimulatorStore.js
      api/simulator.js
    vite.config.js               port 5174, proxy /api → :3002
    src/index.css                @import "tailwindcss"; @source "../../../../packages/ui/src"
  e2e/
    tests/
  .env.example
  README.md
```

---

## 2. Environment Variables

Server reads from `apps/mqtt-simulator/server/.env`.

| Variable | Default | Notes |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | |
| `MQTT_CLIENT_ID` | `caro-simulator` | Must be unique on broker |
| `PGHOST` | `localhost` | |
| `PGPORT` | `5432` | |
| `PGDATABASE` | `caro_dev` | |
| `PGUSER` | `postgres` | |
| `PGPASSWORD` | — | **Required** |
| `TICK_INTERVAL_MS` | `100` | 10 Hz default |
| `SINE_PERIOD_S` | `30` | Sine wave period for f32 monitor tags |
| `LOG_BUFFER_SIZE` | `200` | Rolling in-memory log entries |

---

## 3. Startup Sequence

1. Validate `PGPASSWORD`. Exit with clear error if missing.
2. Connect to PostgreSQL via `@caro/db`. Call `getActiveTags()`.
3. If zero active tags returned: log warning and exit.
4. Build in-memory tag map: `Map<tag_id, SimTag>`. Extract `module_id` from `meta` array. Coerce `tag_id` to `Number`.
5. Group tags by `module_id`: `Map<module_id, SimTag[]>`.
6. Initialize simulated values — see Section 5.
7. Load Protobuf schema via `protobuf.js`.
8. Connect MQTT broker. Subscribe to `caro/+/cmd` with QoS 1.
9. Start telemetry loop — see Section 6.
10. **Auto-start:** `index.js` calls `start()` as floating promise inside `app.listen` callback. Startup errors caught, logged to buffer at ERROR level. Process does not exit — server remains up for frontend retry.

---

## 4. SimTag Shape

```js
{
  tag_id:      number,    // coerced from PostgreSQL string
  tag_path:    string,
  data_type:   string,    // 'f32' | 'bool'
  is_setpoint: boolean,
  module_id:   string,    // from meta array
  simValue:    any,       // monitor: auto-simulated; setpoint: from SET_VALUES or type default
  simT:        number,    // time accumulator for sine (monitor f32 only)
  overridden:  boolean,   // true if pinned via REST override (not yet implemented)
}
```

`module_id` extraction:
```js
const moduleAncestor = meta.find(m => m.type === 'module');
return moduleAncestor?.name ?? 'unknown';
```
`meta` is ordered root-to-tag; `find()` is order-agnostic.

---

## 5. Simulated Value Initialization

**Monitor tags (`is_setpoint: false`):**

| `data_type` | Initial | Per-tick update |
|---|---|---|
| `f32` | `50.0` | `50 + 25 * sin(2π * t / periodMs)`. `t` increments by `TICK_INTERVAL_MS` each tick. `periodMs = SINE_PERIOD_S * 1000`. |
| `bool` | `false` | 0.5% probability flip per tick (~1 toggle per 200 ticks). |

**Setpoint tags (`is_setpoint: true`):**

| `data_type` | Initial |
|---|---|
| `f32` | `0` |
| `bool` | `false` |

All tags start with `simT: 0`.

---

## 6. Telemetry Loop

`setInterval` at `TICK_INTERVAL_MS`. Per tick:

1. Advance `simValue` and `simT` for all monitor tags across all modules.
2. For each `module_id`: skip if not in `activeModules`.
3. Determine publish payload by mode flags (four branches below).
4. Set `lastPublishedCount` and `lastPublishedBytes` for the module.
5. Publish to `caro/{module_id}/telemetry`, QoS 0, `retain: false`.

**Per-module mode Sets (initialized in `simulatorService.js`):**
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

**`TelemetryMessage` shape (per `CARO_MQTT_Spec`):**
```js
{
  timestamp: uint64,   // Date.now() ms
  status:    "ONLINE",
  tags: [ { tag_id: uint32, value: <encoded per data_type> } ]
}
```

**`publishNow(moduleId)`** — immediate out-of-tick full publish. Used by REQUEST_SNAPSHOT and `POST /snapshot/:module_id`. Respects `protobufMode`. Updates `lastPublishedCount` and `lastPublishedBytes`. Delta mode not applied.

---

## 7. Command Handling

All commands arrive and are responded to as JSON. Protobuf is for telemetry only.

Subscription: `caro/+/cmd`, QoS 1.

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
1. Validate `command_type === 'SET_VALUES'`.
2. For each `{ tag_id, value }`: validate tag exists for this `module_id` and `is_setpoint === true`. If valid: update `simValue`. If not: mark `UNKNOWN_TAG` in CMD_ACK.
3. Publish CMD_ACK immediately to `caro/{module_id}/cmd_ack`, QoS 1.
4. Updated values surface on next scheduled tick — no out-of-tick publish.

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

**RESET** — CMD_ACK published; tag values are not reset in memory.

**REQUEST_SNAPSHOT** — calls `publishNow(moduleId)`.

`command_id` deduplication: 60-second rolling TTL Set — duplicate commands within the window are silently dropped.

---

## 8. Protobuf Encoding

Implemented in `server/services/protobuf.js`. Schema: `packages/proto/tag.proto` (authoritative — do not duplicate under `apps/mqtt-simulator/`).

`loadProto()` called once at `start()` time:
```js
const protoPath = path.resolve(__dirname, '../../../../packages/proto/tag.proto');
```

`encodeProto(moduleId, richTags, status)` returns a Buffer.

Tag value `oneof` field per `data_type`:

| `data_type` | Protobuf field | JS type |
|---|---|---|
| `f32` | `float_value` | number |
| `bool` | `bool_value` | boolean |

`protobufjs` installed at monorepo root (not server-local — blocked by `@caro/db` workspace resolution). Run `npm install` from monorepo root if missing.

**JSON telemetry format** (simulator-only convenience, not in `CARO_MQTT_Spec`):
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
Production HMI always expects Protobuf.

---

## 9. REST API

All endpoints prefixed `/api/v1/simulator/`. Base URL: `http://localhost:3002`.
Response envelope: `{ ok, data }` / `{ ok, error: { code, message } }`.

### Implemented

| Method | Path | Description |
|---|---|---|
| `POST` | `/start` | Start simulator. Body: `{ intervalMs? }`. Returns 202 — MQTT connect async. 409 if already running. |
| `POST` | `/stop` | Stop simulator. 409 if not running. |
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
        delta:     false,
        protobuf:  false
      }
    ],
    uptime_s:  142,
    tickCount: 1420
  }
}
```

---

## 10. Log Buffer

`log(level, msg)` helper in `simulatorService.js` appends to in-memory `logBuffer` array (max `LOG_BUFFER_SIZE` entries). All internal log calls use this helper. `GET /logs` returns buffer oldest-first.

| Event | Level | Format |
|---|---|---|
| Startup complete | INFO | `[SIM] Started: {N} modules, {M} tags, broker: {url}, tick: {ms}ms` |
| SET_VALUES received | INFO | `[SIM] SET_VALUES from {module_id}: {N} tags` |
| CMD_ACK published | INFO | `[SIM] CMD_ACK → {module_id}: {N} accepted, {R} rejected` |
| Unknown module_id | WARN | `[SIM] Command for unknown module_id: {id} — ignored` |
| MQTT disconnect | WARN | `[SIM] MQTT disconnected — reconnecting...` |
| DB error on startup | ERROR | `[SIM] Failed to load tag registry: {error}` |
| Graceful shutdown | INFO | `[SIM] Shutting down...` |
| Telemetry stopped | INFO | `[SIM] Telemetry stopped: {module_id}` |
| Encoding changed | INFO | `[SIM] Telemetry encoding: {protobuf\|json}` |

---

## 11. Frontend

React+Vite at port 5174. Mirrors `apps/tag-registry/client/` conventions.

**`useSimulatorStore`** state: `{ running, modules, error }`. Actions: `setStatus`, `setError`.

**`SimulatorPanel`** layout:
- Header: title, RUNNING/STOPPED badge, Start/Stop button.
- Modules table (`max-w-5xl`): Module | Tags | Bytes | Transmitting | Delta | Protobuf | Actions. Transmitting/Delta/Protobuf are checkbox toggles — each calls corresponding REST endpoint then re-fetches status. Actions: "Rqst Snapshot", "Change Sets" buttons per row.
- Logs terminal (`max-w-5xl`, `h-64`, dark bg): auto-scrolls to bottom unless user has scrolled up. Entries: `{ ts, level, msg }` with level-coloured brackets.

Poll intervals: status 200ms; logs 2000ms.

**`apiClient`:** imported from `@caro/ui/api/client`. `cache: 'no-store'` on all GETs.

---

## 12. `package.json`

```json
{
  "name": "mqtt-simulator",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev":   "nodemon --ext js --watch src src/index.js"
  },
  "dependencies": {
    "@caro/db":     "*",
    "@caro/server": "*",
    "express":      "^4.18.0",
    "mqtt":         "^5.0.0",
    "protobufjs":   "^7.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

`asyncWrap` and `errorHandler` are imported from `@caro/server` — no local `middleware/` directory.
