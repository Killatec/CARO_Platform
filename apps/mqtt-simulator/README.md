# CARO MQTT Simulator

> **DEV TOOL ONLY — NOT FOR PRODUCTION DEPLOYMENT**

Simulates one or more field modules publishing telemetry and responding to SET_VALUES commands over MQTT. Reads the active tag registry from PostgreSQL at startup, groups tags by module_id, and publishes simulated values at 10 Hz (configurable). A lightweight REST control API and one-page frontend are available at `http://localhost:4000`.

## Quick Start

```bash
# Prerequisites: PostgreSQL running with populated tag_registry, MQTT broker on localhost:1883
cd apps/mqtt-simulator
cp .env.example .env   # edit PGPASSWORD
npm install
npm run dev
```

See `Docs/mqtt_simulator_bootstrap.md` for full implementation details.
