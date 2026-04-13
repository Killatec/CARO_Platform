# MQTT Simulator — Handoff
**Updated:** 2026-04-07 | **Root:** `apps/mqtt-simulator/` | **API:** 3002 | **UI:** 5174
⚠ Dev/test tool only — never deploy to production.

---

## What Is Built

- Telemetry publishing — per-module, 10 Hz default, topic `caro/{module_id}/telemetry`
- Encoding — JSON (default) or Protobuf per module, togglable at runtime. Schema: `packages/proto/tag.proto`
- Delta mode — per module; publishes only changed tags. Full publish is default.
- Per-module transmission control — stop/start individual modules independently
- SET_VALUES handling — subscribes `caro/+/cmd`; validates tag_id and is_setpoint; updates simValue; publishes CMD_ACK to `caro/{module_id}/cmd_ack` immediately; updated value surfaces on next tick
- Snapshot injection — immediate full publish for one module, bypasses delta mode
- Random setpoint mutation ("Change Sets") — randomizes all setpoint values for one module
- Rolling log buffer — 200-entry in-memory; all log output captured; served via `GET /logs`
- Auto-start — starts on server boot; startup errors captured in log buffer; process does not exit on failure
- Frontend — React+Vite at 5174; module table with per-module toggles and action buttons; live log panel

## What Is Not Built

- No automated tests — intentional. The simulator is a dev/test tool; test coverage is not required.
- RESET command — CMD_ACK published but values not reset

---

## How to Run

Prerequisites: PostgreSQL with populated `tag_registry` table; Mosquitto on `localhost:1883`.

```powershell
cd apps/mqtt-simulator/server && npm run dev   # port 3002
cd apps/mqtt-simulator/client && npm run dev   # port 5174
```

---

## Spec Documents

Read order: this file → deltas → task-specific spec.

| Document | When to read |
|---|---|
| `mqtt_simulator_deltas.md` | Every session start |
| `mqtt_simulator_bootstrap.md` | Architecture, startup sequence, telemetry loop, command handling, env vars |
| `docs/CARO_MQTT_Spec.md` | Topic structure, message shapes, CMD_ACK format |

---

## Key Decisions

- **Full publish is default; delta is opt-in per module.** Spec implied on-change-only for setpoints — overridden for dev simplicity.
- **POST /start returns 202.** MQTT connect is async; `running` flips to `true` ~100ms after response. Do not assert `running: true` immediately.
- **One MQTT client for all modules.**
- **Simulator filters to `module_type = 'MQTT'` tags only.** Tags with other module_type values (e.g., `'HMI'`) are excluded at registry load time.
- **`module_id` derived from `tag_registry.module` column** — not from meta array parsing. Falls back to `'unknown'` if the column is null.
- **`tag_id` coerced to `Number` on registry load** — node-postgres returns INTEGER as string.
- **`protobufjs` installed at monorepo root** — server-local install blocked by `@caro/db` workspace resolution. Run `npm install` from monorepo root if missing.
- **`asyncWrap` and `errorHandler` imported from `@caro/server`** — no local `middleware/` directory. **`apiClient` imported from `@caro/ui/api/client`** — no local `api/client.js`.
- **`command_id` deduplication** — implemented with a 60-second in-memory rolling TTL. If a `command_id` is present and already seen, the command is dropped and a WARN is logged. If `command_id` is absent, the command is processed normally. Known limitation: if the simulator restarts, the dedup Set is lost and a redelivered command from before the restart will be processed again. Acceptable for a dev tool.

---

## Gotchas

- **Zero active MQTT tags = process exit.** Apply a registry in Tag Registry before starting the simulator. The simulator requires at least one tag with `module_type = 'MQTT'`.
- **Bootstrap §16 references port 4000** — stale, describes an earlier single-process design. Ignore. Correct ports: API 3002, UI 5174.

---

## TypeScript Migration

**Date:** 2026-04-07

Both layers of the MQTT Simulator migrated to TypeScript (`strict: true`, zero `tsc` errors).

**Server (`apps/mqtt-simulator/server/`)**
- 7 source files renamed `.js` → `.ts`: `index`, `app`, `routes/simulator`, `services/mqttClient`, `services/protobuf`, `services/registry`, `services/simulatorService`
- `tsconfig.json` created extending root `tsconfig.base.json`
- `types/cors.d.ts` module shim added (`@types/cors` does not exist on npm)
- Key types: `MqttClient`, `ProtoTag`, `SimTag`, `LogEntry`, `ModuleStatus`, `SimulatorStatus`
- `package.json`: `build: tsc`, `start: node dist/index.js`, `dev` uses `tsx`
- Server starts cleanly: connects to PostgreSQL, loads tag registry, connects to MQTT broker

**Client (`apps/mqtt-simulator/client/`)**
- 5 source files renamed `.js`/`.jsx` → `.ts`/`.tsx`: `main`, `App`, `api/simulator`, `stores/useSimulatorStore`, `components/SimulatorPanel`
- `tsconfig.json` created extending root `tsconfig.base.json`
- `vite.config.js` → `vite.config.ts`
- Key types: `SimulatorStore`, `SimulatorStatus`, `ModuleStatus`, `LogEntry`
- `package.json` build script: `tsc && vite build`
- Client starts cleanly on `:5174`

No automated tests exist for the MQTT Simulator by intentional design.
