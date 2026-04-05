# CARO_Platform — Platform Handoff
**Updated:** 2026-04-05 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

---

## Apps

| App | API Port | UI Port | Status |
|---|---|---|---|
| Tag Registry | 3001 | 5173 | Complete |
| MQTT Simulator | 3002 | 5174 | Active development |
| CARO HMI | TBD | TBD | Not started |

---

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@caro/db` | `packages/db/` | All PostgreSQL access |
| `@caro/ui` | `packages/ui/` | Shared React primitives, tokens, and `apiClient` (`@caro/ui/api/client`) |
| `@caro/server` | `packages/server/` | Shared Express middleware — asyncWrap, errorHandler |
| `@caro/proto` | `packages/proto/` | Shared Protobuf schemas (`tag.proto`) |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, Zustand |
| Backend | Node.js + Express |
| Database | PostgreSQL via `@caro/db` |
| Messaging | Mosquitto v5 — TCP 1883, WS 8080 |
| Language | JavaScript, ESM, no TypeScript |
| Packages | npm workspaces |

---

## Platform Rules

- **No raw SQL in apps.** All PostgreSQL access via named functions from `@caro/db` only. No direct `pg` imports in any app.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error: { code, message } }`. Services throw `Error` with `.code`; never set HTTP status directly.
- **Env files:** each app reads its own `server/.env`. Root `.env` is never seen by app processes.
- **No TypeScript** anywhere in the monorepo.
- **Style reference:** `apps/tag-registry/` is the convention baseline for all apps.

---

## Branching

| Branch | Rule |
|---|---|
| `main` | Stable releases only |
| `dev` | Integration — all work merges here |
| `feature/*` | One branch per feature, PR into `dev` |

---

## Database

Schema spec: `docs/CARO_DB_Spec.md`
Migrations: `db/postgres/migrations/` — never edit existing files, add new ones only.
Applied: `001` `002` `003` `004` `006`

HMI tables (`users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `pending_setpoint_values`, `system_settings`, `audit_log`) specified in DB Spec, not yet migrated. Create when HMI development starts.

---

## Key Documents

| Document | Path |
|---|---|
| Platform Spec Delta | `docs/platform_deltas.md` |
| DB Spec | `docs/CARO_DB_Spec.md` |
| MQTT Spec | `docs/CARO_MQTT_Spec.md` |
| @caro/db Handoff | `db/Docs/db_handoff.md` |
| Tag Registry Handoff | `apps/tag-registry/Docs/tag_registry_handoff.md` |
| MQTT Simulator Handoff | `apps/mqtt-simulator/Docs/mqtt_simulator_handoff.md` |

---

## Open TODOs

- `packages/db/__tests__/query.test.js` — `withTransaction()` failure path tests missing. Required before HMI service development. Detail in `docs/platform_deltas.md`.
