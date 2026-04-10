# Tag Registry Admin Tool — Handoff
**Updated:** 2026-04-07 | **Root:** `apps/tag-registry/` | **API:** 3001 | **UI:** 5173

---

## What Is Built

- Template CRUD — create, edit, delete via browser UI; JSON files on disk; atomic writes; hash-checked batch save
- Cascade simulation — field changes simulate downstream parent impact; confirmation modal before save
- Registry calculation — live client-side from in-memory template graph
- Registry persistence — diff live calculation against PostgreSQL; apply via SERIALIZABLE transaction; append-only `tag_registry` table
- Revision history — every apply creates a `registry_revisions` row; History page shows full log
- Client-side validation — circular references, invalid references, schema errors, tag path length, configurable parent type rules; blocks save on error
- Module type support — `module_types` lookup table, `ModuleType` field type with dropdown UI, `Module_Type` required on module templates, `module` and `module_type` columns resolved and persisted to `tag_registry`; `GET /api/v1/module-types` endpoint
- Test suite — 330 Vitest unit tests (server 82, shared 125, client 112, packages/db 11) + 207 Playwright E2E tests (Chromium, Firefox, WebKit); 537 total, 0 failures

## What Is Not Built

- Authentication (`applied_by` hardcoded to `'dev'`)
- Stale conflict merging (discard and re-fetch only)
- Rename tracking (tag_id not preserved across renames)
- Root dropdown `disabled` attribute while dirty (CSS `cursor-not-allowed` only — intentional skip in test suite)

---

## How to Run

```powershell
cd apps/tag-registry/server && npm run dev   # port 3001
cd apps/tag-registry/client && npm run dev   # port 5173
cd apps/tag-registry/e2e   && npm test       # both servers must be running
```

---

## Spec Documents

All in `Docs/`. Read order for a new session: this file → deltas → task-specific spec.

| Document | When to read |
|---|---|
| `tag_registry_deltas.md` | Every session start |
| `tag_registry_spec.md` | UI behavior, workflow logic, data model |
| `tag_registry_api_spec.md` | Endpoint contracts, request/response shapes, error codes |
| `tag_registry_bootstrap.md` | Component architecture, store behavior, folder structure |
| `tag_registry_test_spec.md` | Writing or debugging tests, selector strategy |
| `docs/CARO_DB_Spec.md` | Schema questions, migration authoring |

---

## Key Decisions

- **No URL router.** Page navigation via `useUIStore.activeTab`. `page.goto('/registry')` resets all Zustand state — use sidebar button clicks only.
- **`isDirty` is an inline selector** — `dirtySet.size > 0 || pendingDeletions.size > 0`. Not a store property.
- **Template deletions are pending operations** — queued client-side, committed on next batch save. `DELETE /api/v1/templates/:name` exists for tooling only.
- **Registry apply is server-side** — `POST /api/v1/registry/apply` loads graph, resolves registry, diffs against DB, writes in SERIALIZABLE transaction. Client sends root name + comment only.
- **`apps/tag-registry/shared/` is a local module**, not a workspace package. Pure functions only — no `fs`, no Express, no DOM.
- **Error handling** — route handlers throw errors with `err.status` (HTTP code), `err.code` (string), and optionally `err.details` set at the throw site. All errors flow through `@caro/server` `errorHandler` which formats them into the platform envelope `{ ok: false, error: { code, message, details } }`. Do not use direct `res.status().json()` calls for errors in route code. Both `templateService.js` and `registry.js` follow this pattern.

---

## Gotchas

- **nodemon must not watch `templates/`.** Dev script watches `src/` only. If `--watch ../templates` is re-added, nodemon restarts on every template write and breaks tests.
- **`apps/tag-registry/server/.env` is the only env file the server reads.** Root `.env` changes are never seen.
- **`PGPASSWORD` must be set.** `DATABASE_URL` is not used.
- **`AppShell` fetches template list once on mount.** Templates created via API after mount won't appear in the root dropdown until page remounts.
- **Tag templates do not appear in the root dropdown.** Only non-tag structural templates are selectable as roots.
- **`validateGraph` runs on all templates in the store.** Always begin an edit session with `loadRoot()` to ensure a complete subgraph.
- **Modal has no `role="dialog"`.** Locate with `.locator('.shadow-xl').filter({ hasText: '...' })`.

---

## TypeScript Migration

**Date:** 2026-04-06 — 2026-04-07

All three layers of the tag-registry app migrated to TypeScript (`strict: true`, zero `tsc` errors across all).

**Server (`apps/tag-registry/server/`)**
- 7 source files renamed `.js` → `.ts`
- `tsconfig.json` created extending root `tsconfig.base.json`
- `cors.d.ts` module shim added (`@types/cors` does not exist on npm)
- `dev` script updated to use `tsx` via nodemon
- All 8 `__tests__/*.test.js` imports updated to `.ts`
- `registryService.test.js` rewritten: mock now targets `getActiveTags`/`getRevisions`/`getRevisionTags` directly — old mock targeted `query()` which `registryService` no longer calls after `@caro/db` migration
- 82 unit tests passing

**Client (`apps/tag-registry/client/`)**
- 35 source files renamed `.js`/`.jsx` → `.ts`/`.tsx`
- All stores, hooks, API calls, and components fully typed
- `ApiResponse<T>` from `@caro/ui` used throughout
- `vite.config.js` → `vite.config.ts`
- All 7 `__tests__/*.test.js` mock paths updated
- 112 unit tests passing

**Shared (`apps/tag-registry/shared/`)**
- 10 source files renamed `.js` → `.ts`; `types.ts` added as centralized interface file
- All shared types now exported from `types.ts`: `FieldDef`, `ChildRef`, `Template`, `TemplateEntry`, `ValidationMessage`, `ValidationResult`, `ProposedChange`, `CascadeDiff`, `CascadeResult`, `AffectedParent`, `MetaLevel`, `ResolvedTag`
- Declaration shims (`index.d.ts`, `utils.d.ts`) deleted — replaced by compiled `dist/`
- `resolve-js-to-ts` Vitest plugin added to server `vitest.config.js` — required because Vite does not follow NodeNext `.js`→`.ts` fallback; plugin redirects relative `.js` imports to `.ts` source
- 125 unit tests passing

---

## E2E Test Infrastructure

**Date:** 2026-04-07

The E2E suite is now fully self-contained and database-isolated.

- `globalSetup.js` clones `caro_dev` → `caro_test` via `pg_dump`/`pg_restore` before every run
- Express test server runs on `:3099` against `caro_test`; Vite test client runs on `:5199`
- `globalTeardown.js` kills both processes after suite completes
- `TARGET_DB` env var controls database — defaults to `caro_test`; set to `caro_dev` to skip clone
- All inline `API_BASE` constants removed from spec files — all API calls route through `helpers/api.js`
- `assertPortFree` helper throws with clear error if `:3099` or `:5199` are already bound
- `pgpass.conf` configured at `%APPDATA%\postgresql\pgpass.conf` for passwordless `pg_dump`/`psql`
- Full baseline: 207 E2E tests passing across chromium, firefox, webkit (7.1 minutes)
