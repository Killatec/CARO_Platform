# Tag Registry Admin Tool — Project Handoff

**Last updated:** 2026-03-23
**Monorepo root:** `C:\KillaTec\CARO_Platform`
**App root:** `apps/tag-registry/`

This document is the starting point for any new chat or Claude
Code session working on the Tag Registry Admin Tool. Read this
first, then open the specific spec documents listed below.

---

## 1. What this project is

The Tag Registry Admin Tool is a React + Node.js/Express
single-page application for defining and managing industrial
asset templates and generating tag registries for SCADA/HMI
systems. It is part of the CARO_Platform monorepo.

Phase 1 and Phase 2 are complete. Phase 2 added PostgreSQL
persistence, registry diff/apply workflow, revision history,
and a History page.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, Zustand |
| Backend | Node.js + Express |
| Database | PostgreSQL (Phase 2) via @caro/db workspace package |
| Language | JavaScript (no TypeScript) |
| Package manager | npm workspaces |
| Template storage | JSON files on disk |
| Shared logic | apps/tag-registry/shared/ (pure functions, ESM) |

---

## 3. Monorepo structure

```
CARO_Platform/
  packages/
    ui/                          @caro/ui — generic primitives
    db/                          @caro/db — shared PostgreSQL pool
  db/
    postgres/
      migrations/                001, 002, 003
      seeds/
      scripts/
  apps/
    tag-registry/
      Docs/                      all spec documents (here)
      shared/                    shared pure functions (client + server)
      server/                    Express API server (port 3001)
      client/                    React/Vite frontend (port 5173)
      e2e/                       Playwright E2E test suite
      templates/                 JSON template files on disk
```

---

## 4. How to run

```powershell
# Terminal 1 — API server
cd apps/tag-registry/server
npm run dev        # nodemon, port 3001

# Terminal 2 — Vite client
cd apps/tag-registry/client
npm run dev        # Vite HMR, port 5173

# Terminal 3 — E2E tests (both servers must be running)
cd apps/tag-registry/e2e
npm test           # all 3 browsers
npm run test:chromium:headed  # Chromium headed for debugging
```

---

## 5. Spec documents (read these for full context)

All documents live in `apps/tag-registry/Docs/`.

| Document | Version | Purpose | Reach for this when... |
|---|---|---|---|
| `tag_registry_spec_v1_17.md` | v1.17 | Functional specification — UI concepts, workflows, validation rules, data model | UI behavior, validation rules, workflow logic, data model questions |
| `tag_registry_api_spec_v1_15.md` | v1.15 | REST API contract — all endpoints, request/response shapes, error codes | Endpoint contracts, request/response shapes, error codes |
| `tag_registry_bootstrap_v1_21.md` | v1.21 | Implementation bootstrap — folder structure, component architecture, store behavior, seed data | Component architecture, store behavior, folder structure, seed data |
| `tag_registry_test_spec_v1_2.md` | v1.2 | Test suite specification — E2E and unit test coverage, known gotchas, selector strategy | Writing or debugging tests, selector strategy, E2E gotchas |
| `db/Docs/CARO_DB_Spec_v1_3.md` | v1.3 | Platform PostgreSQL schema — all tables, column types, constraints, indexes | Writing migrations, HMI table schema, audit_log, any PostgreSQL schema question |
| `spec_delta.md` | live | Pending updates to the above docs — read this to know what has diverged from the specs | **Always** — read before any task to know where reality diverges from specs |
| `HANDOFF.md` | live | This file | Read first for orientation |

> **Before every task — read `spec_delta.md` first.**
> The spec documents reflect a snapshot in time. `spec_delta.md` is the
> authoritative record of where the implementation has diverged. Skipping it
> means working from a stale picture, regardless of task scope.

**Reading order for a new session:**
1. This file (HANDOFF.md) — orientation
2. spec_delta.md — what has changed since the last spec revision
3. The specific spec document relevant to your task

---

## 6. Test suite summary

533 total tests/runs, 0 failures.

| Layer | Tool | Tests | Location |
|---|---|---|---|
| shared/ pure functions | Vitest | 125 | apps/tag-registry/shared/__tests__/ |
| server/ templateService | Vitest | 42 | apps/tag-registry/server/__tests__/ |
| server/ registryService | Vitest | 19 | apps/tag-registry/server/__tests__/ |
| server/ registry routes | Vitest | 17 | apps/tag-registry/server/__tests__/ |
| server/ config route | Vitest | 11 | apps/tag-registry/server/__tests__/ |
| client/ formatDate | Vitest | 31 | apps/tag-registry/client/__tests__/ |
| client/ diffRegistry | Vitest | 34 | apps/tag-registry/client/__tests__/ |
| client/ updateTemplate | Vitest | 6 | apps/tag-registry/client/__tests__/ |
| client/ addAndInject | Vitest | 12 | apps/tag-registry/client/__tests__/ |
| client/ loadRoot | Vitest | 10 | apps/tag-registry/client/__tests__/ |
| client/ deletionActions | Vitest | 7 | apps/tag-registry/client/__tests__/ |
| client/ saveAndDiscard | Vitest | 12 | apps/tag-registry/client/__tests__/ |
| Phase 1 E2E (7 files, 3 browsers) | Playwright | 120 runs | apps/tag-registry/e2e/tests/ |
| Phase 2 E2E (4 files, 3 browsers) | Playwright | 66 runs | apps/tag-registry/e2e/tests/ |
| Phase 3 E2E (2 files, 3 browsers) | Playwright | 21 runs | apps/tag-registry/e2e/tests/ |

Run all unit tests:
```powershell
cd apps/tag-registry/shared  && npm test
cd apps/tag-registry/server  && npm test
cd apps/tag-registry/client  && npm test
```

---

## 7. Current state

### Completed (Phase 1)
- Template CRUD (create, edit, delete via pending/Save flow)
- Asset tree editing (drag-drop, instance overrides, rename)
- Client-side cascade simulation and confirmation modal
- Batch save with hash checking
- Live client-side registry calculation
- Full Phase 1 E2E test suite (Playwright, 3 browsers, 40 tests)
- Full Phase 1 unit test suite (Vitest, 201 tests)

### Completed (Phase 2)
- PostgreSQL integration via @caro/db package
- Registry persistence — append-only tag_registry table
- GET /api/v1/registry — active tags via DISTINCT ON subquery
- POST /api/v1/registry/apply — SERIALIZABLE transaction
- GET /api/v1/registry/revisions and /revisions/:rev
- Client-side diffRegistry() with per-cell highlighting
- RegistryPage — diff display, Update DB button, apply modal, success banner
- HistoryPage — revision log table
- formatDate utility (dd-MMM-yyyy HH:mm:ss)
- MetaModalBody shared component with diff highlighting
- Full Phase 2 E2E test suite (4 spec files, 22 tests × 3 browsers)
- Full Phase 2 unit test suite (93 additional tests)

### Not started (Phase 3+)
- Authentication (applied_by hardcoded to 'dev')
- Stale conflict merging
- Rename tracking (tag_id preserved across renames)
- TypeScript migration

---

## 8. Known gotchas

These are the non-obvious things that will burn you if you
don't know them. Full details in tag_registry_test_spec_v1_2.md
section 5.

1. **nodemon must not watch templates/** — already fixed in
   server/package.json. Do not add --watch ../templates back.

2. **No URL router** — page.goto('/registry') resets all Zustand
   state. Use sidebar button clicks for in-session navigation.

3. **AppShell fetches template list once on mount** — templates
   created via API after mount won't appear until page remounts.

4. **Tag templates don't appear in root dropdown** — only
   structural templates (module, parameter, etc.) are selectable
   as roots.

5. **Modal has no role="dialog"** — locate by
   page.locator('.shadow-xl').filter({ hasText: '...' })

6. **data_type and is_setpoint are top-level fields on tag
   templates** — never inside fields{}.

7. **validateGraph runs on ALL templates in the store** — not
   just the current root's subgraph. Cross-references from
   pre-existing templates can set isValid=false.

8. **batchSave does not mkdir -p** — subdirectories must exist
   before saving a new template of that type.

9. **Phase 2 DB rows are not cleaned up after E2E tests** —
   tag_registry and registry_revisions rows are append-only.
   Stale rows from prior runs are harmless.

10. **PGPASSWORD must be set in .env** — @caro/db pool.js
    reads PG* vars; DATABASE_URL is not used anywhere.

11. **`apps/tag-registry/server/.env` is the authoritative env file** — the server is started from `apps/tag-registry/server/` so `dotenv.config()` loads `apps/tag-registry/server/.env`, not the root `.env`. Any server-side env var (`VALIDATE_REQUIRED_PARENT_TYPES`, `VALIDATE_UNIQUE_PARENT_TYPES`, `PGPASSWORD`, `PORT`, `TEMPLATES_DIR`) must be set in `apps/tag-registry/server/.env`. Changes to the root `.env` are never seen by the server process.
