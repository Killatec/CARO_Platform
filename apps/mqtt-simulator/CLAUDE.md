# CLAUDE.md — MQTT Simulator

## Session Start Reads

At session start, read in order:
1. `Docs/mqtt_simulator_handoff.md` — current state, key decisions, gotchas
2. `Docs/mqtt_simulator_deltas.md` — open spec divergences

Read this only if the session requires it:
- Simulator architecture, startup sequence, or env vars → `Docs/mqtt_simulator_bootstrap.md`

## App Hard Constraints

- **TypeScript:** Both server and client are fully migrated. `tsc --noEmit` must stay clean in both `server/` and `client/` at all times.

## Simulator Behavior

- **Boolean tags:** Initial value is randomized per tag (`Math.random() < 0.5`). On every 10 Hz publish tick the value flips deterministically (`!prev`). Tags do not move in sync because initial values are independently randomized at sim start.
- **Float/integer tags:** Sine wave: `50 + 25 * sin(2π * simT / 30000)`. Each tag accumulates its own `simT` from `deltaMs` per tick.

## Test Suite

`cd apps/mqtt-simulator/server && npm test`

Baseline: 6 tests, 0 failures. Covers `simGenerators.ts`: `initBoolValue`, `advanceBoolValue`, `advanceF32Value` — injectable RNG for deterministic phase tests.

## Ports

- Broker: `mqtt://localhost:1883` (TCP) | `ws://localhost:8080` (WS) | anonymous | Mosquitto v5
- Server: port `3002`
- Client: port `5174`
