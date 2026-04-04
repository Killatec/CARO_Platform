# CARO_Platform — Platform Handoff

**Last updated:** 2026-04-03
**Monorepo root:** C:\KillaTec\CARO_Platform
**GitHub:** Killatec/CARO_Platform, branch: dev

---

## 1. What this platform is
CARO_Platform is an industrial control system monorepo providing SCADA/HMI tag registry management, MQTT telemetry simulation, and HMI visualization. Built for regulated environments with 21 CFR Part 11 audit readiness.

---

## 2. App inventory

| App | Path | Port | Status | Purpose |
|---|---|---|---|---|
| Tag Registry Admin Tool | apps/tag-registry/ | 3001 (API), 5173 (UI) | Phase 2 complete | Template CRUD, tag registry, PostgreSQL persistence |
| MQTT Simulator | apps/mqtt-simulator/ | 3002 (API), 5174 (UI) | Active development | Simulates MQTT tag publishing from DB-backed tag list |
| CARO HMI | apps/hmi/ | TBD | Not started | Real-time HMI visualization consuming MQTT |

---

## 3. Shared packages

| Package | Path | Purpose |
|---|---|---|
| @caro/db | packages/db/ | All PostgreSQL access — pool, queries, migrations |
| @caro/ui | packages/ui/ | Shared React component primitives |

---

## 4. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, Zustand |
| Backend | Node.js + Express |
| Database | PostgreSQL via @caro/db |
| Messaging | MQTT — Mosquitto v5, port 1883 (TCP), port 8080 (WS) |
| Language | JavaScript (no TypeScript) |
| Package manager | npm workspaces |

---

## 5. Platform-wide rules

Coding practices, DB access policy, and spec delta discipline: see `CLAUDE.md`

### Branching strategy
- main — stable releases only
- dev — integration branch, all work merges here
- feature/* — one branch per feature, PR into dev

### Style consistency
All apps follow apps/tag-registry/ conventions for folder structure, component style, error shapes, and API patterns.

---

## 6. Database

Schema spec: Docs/CARO_DB_Spec.md
Migrations: db/postgres/migrations/
Seeds: db/postgres/seeds/
Broker config: Mosquitto — C:\Program Files\mosquitto\mosquitto.conf

---

## 7. How to run the full platform
```powershell
# Tag Registry API
cd apps/tag-registry/server && npm run dev

# Tag Registry UI
cd apps/tag-registry/client && npm run dev

# MQTT Simulator API
cd apps/mqtt-simulator/server && npm run dev

# MQTT Simulator UI
cd apps/mqtt-simulator/client && npm run dev
```

---

## 8. Key documents

| Document | Path | Purpose |
|---|---|---|
| Platform Handoff | Docs/platform_handoff.md | This file — platform constitution |
| Platform Spec Delta | Docs/platform_deltas.md | Cross-app divergences |
| DB Spec | Docs/CARO_DB_Spec.md | PostgreSQL schema — all tables, column types, constraints, indexes, migrations |
| Tag Registry Handoff | apps/tag-registry/Docs/tag_registry_handoff.md | App-specific handoff |
| Tag Registry Spec Delta | apps/tag-registry/Docs/tag_registry_deltas.md | Tag Registry implementation divergences |
| MQTT Simulator CLAUDE.md | apps/mqtt-simulator/CLAUDE.md | Simulator session anchor |
| MQTT Simulator Handoff | apps/mqtt-simulator/Docs/mqtt_simulator_handoff.md | App-specific handoff |
| MQTT Simulator Spec Delta | apps/mqtt-simulator/Docs/mqtt_simulator_deltas.md | Simulator divergences and deferred items |
| MQTT Spec | Docs/CARO_MQTT_Spec.md | MQTT protocol contract — topic structure, TelemetryMessage, CommandEnvelope, CMD_ACK, topic naming |

