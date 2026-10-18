# MQTT Simulator — Handoff
**Updated:** 2026-10-17 | **Root:** `apps/mqtt-simulator/` | **API:** 3002 | **UI:** 5174
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
- Per-module fault toggle — `status` field in telemetry publishes `'FAULT'` instead of `'ONLINE'` for the duration. Simulator-only feature, not in CARO_MQTT_Spec.
- RESET command handling — increments per-module `Reset_Count` tag (i16 monitor tag, not a setpoint). `Reset_Count` tags are excluded from sine simulation and initialized to 0 at simulator start. CMD_ACK published with empty results array.

## What Is Not Built

- Broad test coverage — intentional. The simulator is a dev/test tool. Only the pure value generators (`server/services/simGenerators.ts`) are unit-tested: `cd apps/mqtt-simulator/server && npm test`.

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
| `Docs/platform/CARO_MQTT_Spec.md` | Topic structure, message shapes, CMD_ACK format |

---

## Key Decisions

- **Full publish is default; delta is opt-in per module.** Spec implied on-change-only for setpoints — overridden for dev simplicity.
- **POST /start returns 202.** MQTT connect is async; `running` flips to `true` ~100ms after response. Do not assert `running: true` immediately.
- **One MQTT client for all modules.**
- **Simulator filters to `module_type = 'MQTT'` tags only.** Tags with other module_type values (e.g., `'HMI'`) are excluded at registry load time.
- **`SIMULATOR_EXCLUDE_MODULES` excludes specific modules by name.** Comma-separated `module` column values (e.g. `Pole`). Applied in `services/registry.ts` after the module_type filter. Excluded modules receive no telemetry publishing and no cmd subscription. Useful when a real device owns a module and the simulator should not interfere. See bootstrap §2.
- **`module_id` derived from `tag_registry.module` column** — not from meta array parsing. Falls back to `'unknown'` if the column is null.
- **`tag_id` coerced to `Number` on registry load** — node-postgres returns INTEGER as string.
- **`protobufjs` installed at monorepo root** — server-local install blocked by `@caro/db` workspace resolution. Run `npm install` from monorepo root if missing.
- **`cors` types come from a local shim**, `server/types/cors.d.ts`.
- **`asyncWrap` and `errorHandler` imported from `@caro/server`** — no local `middleware/` directory. **`apiClient` imported from `@caro/ui/api/client`** — no local `api/client.js`.
- **`command_id` deduplication** — implemented with a 60-second in-memory rolling TTL. If a `command_id` is present and already seen, the command is dropped and a WARN is logged. If `command_id` is absent, the command is processed normally. Known limitation: if the simulator restarts, the dedup Set is lost and a redelivered command from before the restart will be processed again. Acceptable for a dev tool.

---

## Gotchas

- **Zero active MQTT tags = process exit.** Apply a registry in Tag Registry before starting the simulator. The simulator requires at least one tag with `module_type = 'MQTT'`.
- **KNOWN DEFECT (2026-09-19, not fixed): `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, and `LOG_BUFFER_SIZE` are never actually read from `.env`.** `services/mqttClient.ts:5-6` and `services/simulatorService.ts:13` read them as module-scope `const`s, evaluated when `index.ts` imports those modules — which happens before `index.ts`'s own `loadEnv()` call, since ES module imports fully evaluate before the importing module's own statements run regardless of textual order. All three silently fall back to their hardcoded defaults always; latent only because those defaults currently match `.env`'s configured values. Setting any of the three to something else in `.env` has no effect. Fix before pointing the simulator at a second project (multi-project work) — per-project broker URL and client ID are exactly what that work needs to configure, and two of those three are currently the only things that would need to differ.
