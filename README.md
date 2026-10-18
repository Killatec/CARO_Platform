# CARO Platform

Industrial automation monorepo:

- **Tag Registry** (`apps/tag-registry/`) — authors a versioned tag registry from templates and applies it to PostgreSQL.
- **MQTT Simulator** (`apps/mqtt-simulator/`) — dev/test tool that publishes simulated module telemetry.
- **CARO HMI** (`apps/caro-hmi/`) — operator HMI with live values, setpoints, module commands and a TimescaleDB-backed trend viewer.

Shared code lives in `packages/` (`@caro/db`, `@caro/ui`, `@caro/server`, `@caro/proto`, `@caro/hmi-context`, `@caro/widgets`, `@caro/trend-chart`). Everything is TypeScript on npm workspaces.

**Documentation starts at [`Docs/README.md`](Docs/README.md).**

## Getting Started

Prerequisites: Node.js, PostgreSQL on 5432, Mosquitto on 1883, and (for trends) Docker Desktop for the TimescaleDB container on 5433.

```bash
npm install

# Project identity and database connections, shared by all three servers
cp .env.example .env            # set POSTGRES_PASSWORD (and TIMESCALE_PASSWORD for the historian)

# Each app's own settings
cp apps/caro-hmi/server/.env.example apps/caro-hmi/server/.env    # likewise for the other apps' server/.env.example

# First run (and after pulling shared-package changes): build packages, then start all six dev servers
npm run dev:fresh

# Subsequent runs
npm run dev
```

| App | API | UI |
|---|---|---|
| Tag Registry | http://localhost:3001 | http://localhost:5173 |
| MQTT Simulator | http://localhost:3002 | http://localhost:5174 |
| CARO HMI | http://localhost:3003 | http://localhost:5175 |

Setting up TimescaleDB: [`Docs/db/hmi_timescale_setup.md`](Docs/db/hmi_timescale_setup.md). Running more than one project: [`Docs/platform/multi_project_runbook.md`](Docs/platform/multi_project_runbook.md).
