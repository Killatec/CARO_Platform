# MQTT Simulator — Project Handoff

**Last updated:** 2026-04-04
**Monorepo root:** `C:\KillaTec\CARO_Platform`
**App root:** `apps/mqtt-simulator/`

This document is the starting point for any new chat or Claude Code session working on the MQTT Simulator. Read this first, then open spec documents as needed.

---

## 1. What this project is

The MQTT Simulator is a **dev/test tool only — never deploy to production**. It simulates one or more field modules publishing MQTT telemetry at 10 Hz and responding to SET_VALUES commands with CMD_ACK. It eliminates the need for physical hardware during HMI frontend development and testing.

On startup it reads the active tag registry from PostgreSQL via `@caro/db`, groups tags by module_id, and begins publishing simulated telemetry continuously.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, Zustand |
| Backend | Node.js + Express (port 3002) |
| Database | PostgreSQL via @caro/db |
| Messaging | MQTT.js v5 — broker at mqtt://localhost:1883 |
| Language | JavaScript (ESM, no TypeScript) |
| Package manager | npm workspaces |

---

## 3. Monorepo structure

```
apps/mqtt-simulator/
  Docs/                          spec documents (here)
  server/
    src/
      routes/simulator.js        POST /start, POST /stop, GET /status
      services/mqttClient.js     connect(), disconnect(), getClient()
      services/simulatorService.js  tick loop, command handler
      services/registry.js       loadTagRegistry() via @caro/db
      middleware/
  client/                        React+Vite frontend (port 5174)
    src/
      stores/useSimulatorStore.js
      components/SimulatorPanel.jsx
      api/simulator.js
  e2e/
  .env.example
```

---

## 4. How to run

```powershell
# Terminal 1 — API server
cd apps/mqtt-simulator/server
npm run dev        # nodemon, port 3002

# Terminal 2 — Vite client
cd apps/mqtt-simulator/client
npm run dev        # Vite HMR, port 5174
```

Prerequisites: PostgreSQL running with populated `tag_registry` table. Mosquitto broker running on localhost:1883.

---

## 5. Spec documents

Bootstrap and delta documents live in `apps/mqtt-simulator/Docs/`. The MQTT protocol spec lives in the platform `Docs/`.

| Document | Version | Purpose | Reach for this when... |
|---|---|---|---|
| `mqtt_simulator_bootstrap.md` | v1.13 | Implementation bootstrap — folder structure, startup sequence, telemetry loop, command handling, env vars | Architecture questions, implementing new features, env var reference |
| `Docs/CARO_MQTT_Spec.md` | v1.8 | MQTT message spec — topic structure, TelemetryMessage, CommandEnvelope, CMD_ACK shapes | Message format questions, topic names, Protobuf schema |
| `mqtt_simulator_deltas.md` | live | Divergences from spec and deferred implementation items | Read at session start — not before every task |
| `mqtt_simulator_handoff.md` | live | This file | Read first for orientation |

**Reading order for a new session:**
1. This file — orientation
2. `mqtt_simulator_deltas.md` — what has diverged and what is deferred

---

## 6. Test suite summary

No automated tests yet. Manual testing via `curl` against the REST API and MQTT broker inspection.

---

## 7. Current state

### Implemented
- Server auto-start: index.js calls start() on server boot; errors logged to buffer, process does not exit
- Telemetry publishing: per-module, configurable interval (default 100ms), JSON or Protobuf per module
- Protobuf encoding: packages/proto/tag.proto defines TagValue/TagSample/TelemetryMessage; protobuf.js service loads schema at start(); per-module protobufMode Set; all 4 combinations handled (full/delta × JSON/proto)
- Per-module transmission control: activeModules Set; POST /telemetry/stop/:module_id and /telemetry/start/:module_id
- Per-module delta mode: deltaMode Set; publishes only changed tags per tick; empty tags array published if nothing changed; previousValue tracked per SimTag
- Per-module Protobuf toggle: protobufMode Set; POST /protobuf/enable/:module_id and /protobuf/disable/:module_id
- Payload size tracking: lastPublishedBytes map updated every publish (tick and snapshot); surfaced as bytes per module in GET /status
- Published tag count tracking: lastPublishedCount map (live count, not static registry count); surfaced as tag_count per module in GET /status
- SET_VALUES command handling: validates tag_id and is_setpoint, updates simValue, publishes CMD_ACK immediately; updated values surface on the next scheduled tick (no out-of-tick telemetry publish)
- Snapshot injection: POST /snapshot/:module_id — publishNow() unconditionally for that module, bypasses delta mode
- Random setpoint injection: POST /inject/:module_id — mutates simValues directly for all setpoint tags; next tick publishes naturally
- Rolling log buffer: LOG_BUFFER_SIZE entries (default 200); all log calls append to buffer; GET /logs returns buffer oldest-first
- REST API: POST /start, POST /stop, GET /status, GET /logs, POST /telemetry/stop/:module_id, POST /telemetry/start/:module_id, POST /delta/enable/:module_id, POST /delta/disable/:module_id, POST /protobuf/enable/:module_id, POST /protobuf/disable/:module_id, POST /snapshot/:module_id, POST /inject/:module_id
- Frontend: SimulatorPanel — Start/Stop buttons; modules table (Module | Tags | Bytes | Transmitting | Delta | Protobuf | Actions); Logs terminal panel; status poll 200ms; log poll 2s

### Not yet implemented
- command_id deduplication — required before production use
- /override, /override/clear/:tag_id, /reject/enable, /reject/disable, /tags, /tags/:module_id endpoints
- Env vars CMD_ACK_DELAY_MS, TELEMETRY_ENCODING, REJECT_ALL_WRITES, CONTROL_PORT — defined in bootstrap but not read
- E2E test suite
- Unit tests

---

## 8. Known gotchas

1. **DISTINCT ON subquery pattern for tag query** — `WHERE retired = false` must be in the outer query, not before `DISTINCT ON`. Applying it before DISTINCT ON excludes retired rows from consideration and can surface stale non-retired rows from older revisions. See Bootstrap §6.

2. **SET_VALUES payload shape** — values are nested under `payload.values`, not at the top level of the CommandEnvelope. Earlier Bootstrap versions were wrong on this. Follow CARO_MQTT_Spec §6.1.

3. **MQTT connect is async** — POST /start returns 202 immediately; `running` flips to `true` within ~100ms when the MQTT `connect` event fires. Do not assert `running: true` immediately after /start.

4. **Zero active tags = process exit** — if the tag registry query returns zero active tags, the server logs a warning and exits. Simulator cannot operate without a populated registry.

5. **Telemetry encoding is per-module and runtime-toggleable** — both JSON and Protobuf modes are implemented. JSON is the default on startup; Protobuf can be enabled per module via the frontend checkbox or POST /protobuf/enable/:module_id. JSON mode is a simulator-only convenience and not defined in CARO_MQTT_Spec — production HMI backend always expects Protobuf.

6. **Frontend is React+Vite, not vanilla JS** — original Bootstrap §12 specified plain HTML + vanilla JS. Implementation uses React+Vite for consistency with apps/tag-registry/client/ conventions.

7. **module_id extracted from meta array** — `meta.find(m => m.type === 'module')` — meta is ordered root-to-tag; find() is order-agnostic. `module_id` is the `name` field of that ancestor.

8. **tag_id coerced to Number** — PostgreSQL returns INTEGER columns as strings via node-postgres. `registry.js` coerces `tag_id` to `Number()` on load.

9. **protobufjs installed at monorepo root** — server-local install was blocked by @caro/db workspace resolution. protobufjs resolves from the monorepo root node_modules. If it appears missing, run npm install from the monorepo root.

---

## 9. Behavioral Decisions

Permanent decisions that deviate from the spec. These are intentional and will not be reversed.

### Full publish is the default; delta mode is opt-in per module
- **Spec assumption (Bootstrap v1.13 §8):** setpoint tags publish only when their value changes; monitor tags always publish
- **Reality:** Full publish mode (all tags every tick) is the default. Delta mode (only changed tags per tick) is available per module via POST /delta/enable/:module_id or the frontend checkbox. In delta mode, an empty tags array is published if nothing changed.
- **Rationale:** Full publish simplifies dev use and ensures consumers always receive the current setpoint value. On-change-only logic for setpoints has been removed. Delta mode is available for bandwidth-constrained testing scenarios.

### POST /api/v1/simulator/start returns 202 (async connect)
- **Spec assumption:** response reflects post-connect state
- **Reality:** MQTT `connect` event fires asynchronously; /start responds with `running: false`, flips to `true` within ~100ms
- **Rationale:** 202 correctly signals "accepted, not yet running" — appropriate for a dev tool. Do not change this to a synchronous connect.

### RESET command is a no-op
- **Spec assumption:** RESET resets all tag values to their defaults
- **Reality:** RESET is acknowledged and CMD_ACK is published, but tag values are not reset in memory
- **Rationale:** RESET is not needed for current dev tool use case. If needed in future, implement reset logic in `simulatorService.js`.
