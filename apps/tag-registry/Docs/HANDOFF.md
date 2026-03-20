# Tag Registry Admin Tool — Project Handoff

**Last updated:** 2026-03-19
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

Phase 1 is complete. Phase 2 (PostgreSQL persistence, registry
diff/apply, revision history) is not yet started.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Tailwind CSS v4, Zustand |
| Backend | Node.js + Express |
| Language | JavaScript (no TypeScript) |
| Package manager | npm workspaces |
| Template storage | JSON files on disk (no database in Phase 1) |
| Shared logic | apps/tag-registry/shared/ (pure functions, ESM) |

---

## 3. Monorepo structure

CARO_Platform/
packages/
ui/                          @caro/ui — generic primitives
apps/
tag-registry/
Docs/                      all spec documents (here)
shared/                    shared pure functions (client + server)
server/                    Express API server (port 3001)
client/                    React/Vite frontend (port 5173)
e2e/                       Playwright E2E test suite
templates/                 JSON template files on disk

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

| Document | Version | Purpose |
|---|---|---|
| `tag_registry_spec_v1_15.md` | v1.15 | Functional specification — UI concepts, workflows, validation rules, data model |
| `tag_registry_api_spec_v1_13.md` | v1.13 | REST API contract — all endpoints, request/response shapes, error codes |
| `tag_registry_bootstrap_v1_18.md` | v1.18 | Implementation bootstrap — folder structure, component architecture, store behavior, seed data |
| `tag_registry_test_spec_v1_0.md` | v1.0 | Test suite specification — E2E and unit test coverage, known gotchas, selector strategy |
| `spec_delta.md` | live | Pending updates to the above docs — read this to know what has diverged from the specs |
| `HANDOFF.md` | live | This file |

**Reading order for a new session:**
1. This file (HANDOFF.md) — orientation
2. spec_delta.md — what has changed since the last spec revision
3. The specific spec document relevant to your task

---

## 6. Test suite summary

321 total tests, 0 failures.

| Layer | Tool | Tests | Location |
|---|---|---|---|
| shared/ pure functions | Vitest | 112 | apps/tag-registry/shared/__tests__/ |
| server/ templateService | Vitest | 42 | apps/tag-registry/server/__tests__/ |
| client/ useTemplateGraphStore | Vitest | 47 | apps/tag-registry/client/__tests__/ |
| Full UI + API (3 browsers) | Playwright | 120 | apps/tag-registry/e2e/tests/ |

Run all unit tests:
```powershell
cd apps/tag-registry/shared  && npm test
cd apps/tag-registry/server  && npm test
cd apps/tag-registry/client  && npm test
```

---

## 7. Current state and next steps

### Completed (Phase 1)
- Template CRUD (create, edit, delete via pending/Save flow)
- Asset tree editing (drag-drop, instance overrides, rename)
- Client-side cascade simulation and confirmation modal
- Batch save with hash checking
- Live client-side registry calculation
- Full E2E test suite (Playwright, 3 browsers)
- Full unit test suite (Vitest, shared + server + store)
- Test specification document

### Pending spec updates (see spec_delta.md)
- Bootstrap v1.18 → v1.19 (nodemon config, collapse bug fix,
  data-testid additions, htmlFor modal fixes, i32_array clarification,
  batchSave mkdir gap, graph validation error shape)
- Functional Spec v1.15 → v1.16 (EMPTY_BRANCH Phase 1 status,
  root dropdown disabled-while-dirty not implemented)

### Not started (Phase 2)
- PostgreSQL database integration
- Registry persistence and diff/apply workflow
- Revision history
- Stale conflict merging

---

## 8. Known gotchas

These are the non-obvious things that will burn you if you
don't know them. Full details in tag_registry_test_spec_v1_0.md
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
