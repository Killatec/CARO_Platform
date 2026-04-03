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

### DB access
ALL database queries live in packages/db/. No app contains raw SQL or direct pool usage. Apps import named functions from @caro/db only. See packages/db/README.md.

### Shared UI
Check packages/ui/ before writing new components. Reuse primitives — do not duplicate across apps.

### Spec delta discipline
Every app has its own Docs/spec_delta.md. Update it when implementation diverges from spec. Read it at the start of every session. This platform HANDOFF and platform_spec_delta.md cover cross-app divergences only.

### Branching strategy
- main — stable releases only
- dev — integration branch, all work merges here
- feature/* — one branch per feature, PR into dev

### Style consistency
All apps follow apps/tag-registry/ conventions for folder structure, component style, error shapes, and API patterns.

---

## 6. Database

Schema spec: db/Docs/CARO_DB_Spec_v1_3.md
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

## 8. Session startup order
1. Read this file
2. Read Docs/platform_spec_delta.md — cross-app divergences
3. Read the relevant app CLAUDE.md
4. Read the relevant app Docs/spec_delta.md

---

## 9. Key documents

| Document | Path | Purpose |
|---|---|---|
| Platform Handoff | Docs/HANDOFF.md | This file — platform constitution |
| Platform Spec Delta | Docs/platform_spec_delta.md | Cross-app divergences |
| DB Spec | db/Docs/CARO_DB_Spec_v1_3.md | PostgreSQL schema |
| Tag Registry Handoff | apps/tag-registry/Docs/HANDOFF.md | App-specific handoff |
| MQTT Simulator CLAUDE.md | apps/mqtt-simulator/CLAUDE.md | Simulator session anchor |
