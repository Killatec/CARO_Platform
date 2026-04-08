# CLAUDE.md — MQTT Simulator

## Session Start Reads

At session start, read in order:
1. `Docs/mqtt_simulator_handoff.md` — current state, key decisions, gotchas
2. `Docs/mqtt_simulator_deltas.md` — open spec divergences

Read this only if the session requires it:
- Simulator architecture, startup sequence, or env vars → `Docs/mqtt_simulator_bootstrap.md`

## App Hard Constraints

- **TypeScript:** Both server and client are fully migrated. `tsc --noEmit` must stay clean in both `server/` and `client/` at all times.
- **No automated tests** by intentional design. Do not add a test framework without explicit instruction.

## Ports

- Broker: `mqtt://localhost:1883` (TCP) | `ws://localhost:8080` (WS) | anonymous | Mosquitto v5
- Server: port `3002`
- Client: port `5174`
