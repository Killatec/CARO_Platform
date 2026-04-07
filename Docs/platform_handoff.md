# CARO_Platform — Platform Handoff
**Updated:** 2026-04-07 | **Root:** `C:\KillaTec\CARO_Platform` | **GitHub:** `Killatec/CARO_Platform` | **Branch:** `dev`

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
| Language | TypeScript — all packages and all apps. No JavaScript source files remain. |
| Packages | npm workspaces |

---

## Platform Rules

- **No raw SQL in apps.** All PostgreSQL access via named functions from `@caro/db` only. No direct `pg` imports in any app.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error: { code, message } }`. Services throw `Error` with `.code`; never set HTTP status directly.
- **Env files:** each app reads its own `server/.env`. Root `.env` is never seen by app processes.
- **Language:** TypeScript is required for all shared packages (`packages/*`) and all apps. All new code must be TypeScript.
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

## Pre-HMI Tasks

### Shared Package TypeScript Migration (required before HMI scaffolding)
Migrate in this order:
1. ✓ `@caro/db` — typed query functions
2. ✓ `@caro/server` — asyncWrap, errorHandler
3. ✓ `@caro/ui` — primitives and tokens
4. ✓ apps/tag-registry — server, client, shared migrated to TypeScript
5. ✓ apps/mqtt-simulator — server and client migrated to TypeScript

Then scaffold new TypeScript packages:
6. ○ `@caro/hmi-context` — HmiContextProvider, useLiveValue, useTagWriter, useTagMap, useTagSubtree
7. ○ `@caro/widgets` — NumericMon, NumericSet, BooleanMon, BooleanSet

---

## Key Documents

| Document | Path |
|---|---|
| Platform Spec Delta | `docs/platform_deltas.md` |
| DB Spec | `docs/CARO_DB_Spec.md` |
| MQTT Spec | `docs/CARO_MQTT_Spec.md` |
| @caro/db Handoff | `Docs/db_handoff.md` |
| Tag Registry Handoff | `Docs/tag_registry_handoff.md` |
| MQTT Simulator Handoff | `Docs/mqtt_simulator_handoff.md` |

---

## Open TODOs

None.

---

## Documentation

All platform and app documentation consolidated to `C:\KillaTec\CARO_Platform\Docs\` as of 2026-04-07.

| Document | File |
|---|---|
| Platform Handoff | `platform_handoff.md` |
| Platform Spec Delta | `platform_deltas.md` |
| DB Spec | `CARO_DB_Spec.md` |
| MQTT Spec | `CARO_MQTT_Spec.md` |
| @caro/db Handoff | `db_handoff.md` |
| Tag Registry Handoff | `tag_registry_handoff.md` |
| Tag Registry Spec Delta | `tag_registry_deltas.md` |
| Tag Registry Functional Spec | `tag_registry_spec.md` |
| Tag Registry API Spec | `tag_registry_api_spec.md` |
| Tag Registry Bootstrap | `tag_registry_bootstrap.md` |
| Tag Registry Test Spec | `tag_registry_test_spec.md` |
| MQTT Simulator Handoff | `mqtt_simulator_handoff.md` |
| MQTT Simulator Spec Delta | `mqtt_simulator_deltas.md` |
| MQTT Simulator Bootstrap | `mqtt_simulator_bootstrap.md` |
| HMI Functional Spec | `hmi_functional_spec.md` |
| HMI API Spec | `hmi_API_spec.md` |
| HMI Widget Spec | `hmi_widget_spec.md` |
