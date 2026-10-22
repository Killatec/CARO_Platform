# Tag Registry Admin Tool — Handoff
**Updated:** 2026-10-21 | **Root:** `apps/tag-registry/` | **API:** 3001 | **UI:** 5173

---

## What Is Built

- Template CRUD — create, edit, delete via browser UI; JSON files on disk; atomic writes; hash-checked batch save
- Cascade simulation — field changes simulate downstream parent impact; confirmation modal before save
- Registry calculation — live client-side from in-memory template graph
- Registry persistence — diff live calculation against PostgreSQL; apply via SERIALIZABLE transaction; append-only `tag_registry` table
- Revision history — every apply creates a `registry_revisions` row; History page shows full log
- Client-side validation — circular references, invalid references, schema errors, tag_name rules, configurable parent type rules; blocks save on error. The server re-checks only part of this (graph and type lookups on save, tag_name rules on apply) — see `tag_registry_spec.md` §10. **Tag path length is not validated:** a tag whose `tag_path` exceeds 100 characters is dropped from the registry silently (spec §10.5).
- Module type support — `module_types` lookup table, `ModuleType` field type with dropdown UI, `Module_Type` required on module templates, `module` and `module_type` columns resolved and persisted to `tag_registry`; `GET /api/v1/module-types` endpoint
- Editable template_type — `template_type` is editable in the Properties panel (template-tree selection mode) via a text input with datalist suggestions. Changes use the same dirty-tracking as other template properties; validation rules (tag/module field requirements) are enforced on save.
- Flat template folder — all templates stored directly in `templates/` with no subdirectory routing. `batchSave` writes `{template_name}.json` at the root of `TEMPLATES_DIR`. The old type-to-subdirectory mapping is removed.
- Drag-and-drop reordering and reparenting — one unified three-zone model (top/bottom 8 px sibling-insert bands, body = nest-as-child) applies regardless of whether the hovered node currently shares the dragged item's parent: top/bottom always inserts into the hovered node's own parent (same-array reorder via `reorderChild` when that parent matches the dragged item's current parent, cross-parent `moveChild` otherwise); body always nests into the hovered node itself, including nesting into a current sibling — availability never depends on the sibling relationship, only on cycle-prevention and the no-op guard below. Template panel drops use the same positional model (top/bottom 8 px bands = insert before/after sibling; body = append as child). Cycle prevention blocks dropping a node onto itself or any of its own descendants (DFS over the template graph from the dragged template, cached at drag-start). A same-array reorder over an adjacent position, and a body drop onto the dragged item's own current parent, are both suppressed as no-ops (no misleading highlight). Reparenting still changes `tag_path` and retires/reissues `tag_id` on the next apply — tag continuity across a reparent is not preserved (see "What Is Not Built"). Reordering appears in the "See what's changed" preview modal under "Children Reordered".
- Registry CSV export — "Export to CSV" button on the Registry page, beside "Update DB", downloads `{rootTemplateName}_registry.csv` with the same rows/sort/labels as the on-screen table (plus a `status` column since CSV loses the row color coding). Pure utilities `client/src/utils/registryRows.ts` (shared row-resolution/sort logic, also used by `RegistryTable`) and `client/src/utils/exportRegistryCsv.ts`.
- Display columns — `unit`, `format`, `eng_min`, `eng_max` stored as flat columns on the `tag_registry` table (migration 013). Resolved via path-aware `resolveDisplayField` algorithm that walks the meta chain root-to-leaf. Non-numeric tags (boolean) get null display values. RegistryTable shows all 4 as sortable columns.
- Dotted override fields — template fields like `I.eng_min` target descendants by asset_name prefix. Resolution uses relative-path matching at each meta level with specificity ranking: more prefix segments = higher priority; lower level (closer to root) wins over deeper levels. Meta holds only template defaults + direct ChildRef overrides — no propagated values.
- System Tree export — Export button (`↓`) in the System Tree header downloads `{rootTemplateName}_tree.json`; payload is `{ asset_name, template_type, children }` at every level with root `asset_name` set to `rootTemplateName`; button visible only when a root is loaded. Pure utility `client/src/utils/exportTree.ts`; 11 unit tests in `client/src/utils/exportTree.test.ts`.
- `tag_name` and `In_Tag_Name` — `resolveRegistry` computes `tag_name` (dot-joined `asset_name`s of meta levels where `In_Tag_Name === true`, root→leaf) and includes it on `ResolvedTag`. `In_Tag_Name` is a Boolean field present in every template JSON file (59 as of 2026-10-17): `true` for `parameter` and `tag` types, `false` for all others. `In_Tag_Name` is reserved — `AddFieldModal` blocks adding it by name. RegistryTable shows `tag_name` as the 3rd column (index 2).
- `tag_name` validation — `validateResolvedTags` enforces three post-resolution rules: `TAG_NAME_EMPTY` (no level with `In_Tag_Name: true`), `TAG_NAME_TOO_LONG` (>40 chars, `MAX_TAG_NAME_LENGTH`), `DUPLICATE_TAG_NAME` (case-insensitive duplicate within entire resolved registry; one error per offending tag; in-app enforcement only — no DB UNIQUE constraint). Constants `MAX_TAG_NAME_LENGTH` and `IN_TAG_NAME_FIELD` in `shared/constants.ts`.
- 3-column editor layout — Editor page uses three independent columns: System Tree | Properties (FieldsPanel) | Templates (TemplatesTree). Each column scrolls independently (`overflow-y-auto`). ValidationPanel is a separate full-width bar below all columns (`flex-shrink-0`).
- ValidationPanel height cap — capped at `max-h-[50vh]`; header is `flex-shrink-0` (always visible); message list is `overflow-y-auto` (scrollable when content overflows).
- Dirty indicator restyle — tree nodes and FieldsPanel dirty fields use `font-semibold italic text-gray-800` (bold italic gray). Old orange bold (`text-orange-700 font-semibold`) removed. Override fields remain `text-blue-600`.
- Validation tree tinting — System Tree nodes whose subtree contains errors receive `border-l-4 border-red-500 bg-red-50`; warnings receive `border-l-4 border-yellow-400 bg-yellow-50`. Computed in `EditorPage` as `pathSeverityMap` from `msg.ref.tag_path` prefixes; passed via props through `AssetTree → TreeNode`. Selection (blue border/bg) takes visual priority over tint.
- Multi-project `PROJECT_ROOT` gate — `POST /api/v1/registry/apply` rejects a `rootName` that doesn't match the server's configured `PROJECT_ROOT` (root `.env`; `PROJECT_ROOT_MISMATCH`, 403). Unset/empty refuses every apply; `*` allows any root (used by the e2e suite). Client-side: Update DB button disabled with an explanatory tooltip on mismatch or when unconfigured; root selection/authoring itself is never gated. See `tag_registry_spec.md` §12, `tag_registry_api_spec.md` §5.3, and `Docs/README.md` § Multi-Project Model for why the gate exists.
- Database connection indicator — Registry and History pages show `DB: <name>` / `PROJECT_ROOT: <value>` sourced from `GET /api/v1/config`'s `databaseName`/`projectRoot` fields.
- Generate Tag Defs export — "Generate Tag Defs" button on the Registry page, beside "Export to CSV", downloads `TagDefs_YYYY-MM-DD_HHmmss.zip` via `GET /api/v1/tag-defs?root=`. The ZIP holds one flat `<template_name>.json` per MQTT module **template** reachable from the root. HMI-type modules are excluded, and a module instanced twice gives one file. Each file's `tags` is a tree nested by module-relative `tag_name` segment (`In_Tag_Name` levels below the module, e.g. `Mag_1.Fwd.Gain` → `tags.Mag_1.Fwd.Gain`). Leaves are `{ data_type }`, and a node is a leaf iff it has `data_type`. The export is refused if any name is empty, duplicated, also a parent of another name, or has a `data_type` segment; `Beam_Control` currently fails the parent rule, so `CARO_1`'s export is refused (spec §12.1). Each file also carries a generated-file banner and `tag_registry_rev`, the latest `registry_rev` (replaced `content_hash` on 2026-10-21; the module sends it in `HANDSHAKE_REQUEST`). There is no timestamp inside the files, so regeneration at the same revision is byte-stable. The export is server-side and reads saved templates, so the button is disabled while dirty. It also refuses with 409 `REGISTRY_NOT_APPLIED` unless the saved templates are applied (`classifyRegistryChanges`, the comparison apply uses): save, apply, then generate. It is not `PROJECT_ROOT`-gated and reads the DB for that check and the revision. Builders are in `shared/tagDefs.ts`. The service is `server/src/services/tagDefsService.ts` (ZIP via `fflate`). See `tag_registry_spec.md` §12.1 and `tag_registry_api_spec.md` §7. Design decision: RF_Control `Docs/CARO_MIGRATION.md` D32.
- Properties panel numeric inputs — focus selects the value; typed text is kept and committed only once it parses (`parseNumericDraft`), so `-` and an empty field are not coerced to `0`; blur shows the stored value (spec §16.5).
- Instance override revert — setting a field with no original override back to its inherited value removes the override, so the node is clean again (spec §16.5).
- Test suite — 542 Vitest unit tests (shared 244, client 176, server 122) + 96 Playwright E2E tests (Chromium); 638 total, 0 failures. Firefox and WebKit are configured but need `npx playwright install`.

## What Is Not Built

- Authentication (`applied_by` hardcoded to `'dev'`)
- Tag path length validation (`TAG_PATH_TOO_LONG` is declared, never emitted), `UNKNOWN_FIELD`, `EMPTY_BRANCH`, duplicate-template-name detection across files, and a server-side check for dots in `template_name` — see `tag_registry_spec.md` §10
- Server-side parent-type validation (`VALIDATE_*` are enforced by the client only)
- Multi-file atomicity: each template file write is atomic, a batch save is not (spec §4.1)
- Stale conflict merging (discard and re-fetch only)
- Rename tracking (tag_id not preserved across renames)

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
| `Docs/db/CARO_DB_Spec.md` | Schema questions, migration authoring |

---

## Key Decisions

- **No URL router.** Page navigation via `useUIStore.activeTab`. `page.goto('/registry')` resets all Zustand state — use sidebar button clicks only.
- **`isDirty` is an inline selector** — `dirtySet.size > 0 || pendingDeletions.size > 0`. Not a store property.
- **Template deletions are pending operations** — queued client-side, committed on next batch save. `DELETE /api/v1/templates/:name` exists for tooling only.
- **Registry apply is server-side** — `POST /api/v1/registry/apply` loads graph, resolves registry, diffs against DB, writes in SERIALIZABLE transaction. Client sends root name + comment only.
- **`apps/tag-registry/shared/` is a local module**, not a workspace package. Pure functions only — no `fs`, no Express, no DOM.
- **Drag-and-drop reparenting is allowed; tag continuity across it is not preserved.** Moving a child to a different parent (including nesting into a sibling) changes `tag_path` and retires the existing `tag_id`, creating a new one on the next apply — this is an accepted, visible tradeoff, not silently hidden. Cycle prevention (self/descendant) and a same-parent no-op guard are the only drop-level restrictions. Full tag-continuity preservation across a reparent would require rename/move tracking, which is not built.
- **Tag Defs is type-level and deliberately minimal.** The export carries only the nested `tag_name` tree with `data_type` leaves; `direction` was dropped 2026-10-01. `tag_id`, `unit`, `eng_min`/`eng_max`, `trends`, `scale`/`offset`, `format` and `is_setpoint` are excluded by decision (D32), not oversight, so do not add them "for completeness". The one binary (non-envelope) success response in the app is `GET /api/v1/tag-defs`. Its errors still use the envelope.
- **Error handling** — route handlers throw errors with `err.status` (HTTP code), `err.code` (string), and optionally `err.details` set at the throw site. All errors flow through `@caro/server` `errorHandler` which formats them into the platform envelope `{ ok: false, error: { code, message, details } }`. Do not use direct `res.status().json()` calls for errors in route code. Both `templateService.js` and `registry.js` follow this pattern.

---

## Gotchas

- **nodemon must not watch `templates/`.** Dev script watches `src/` only. If `--watch ../templates` is re-added, nodemon restarts on every template write and breaks tests.
- **`apps/tag-registry/server/.env` loads first (app-local wins).** The server also loads the monorepo root `.env` second, via `loadEnv()` from `@caro/server/env`, filling in whatever the app-local file leaves unset (`PROJECT_ROOT`, `POSTGRES_*`).
- **`POSTGRES_PASSWORD` must be set.** `DATABASE_URL` is not used.
- **`MAX_TAG_PATH_LENGTH` in `.env` does nothing.** It is only logged at startup; the limit is the constant 100 in `shared/constants.ts`.
- **The template index is built once at startup.** Files edited or added on disk outside the app are not seen until a server restart.
- **`AppShell` fetches template list once on mount.** Templates created via API after mount won't appear in the root dropdown until page remounts.
- **Only `system` templates appear in the root dropdown.** The dropdown filters `template_type === 'system'`. Other types (module, parameter, tag, Group, custom) are not selectable as roots. The label reads "System:" not "Root Template:".
- **`validateGraph` runs on all templates in the store.** Always begin an edit session with `loadRoot()` to ensure a complete subgraph.
- **Server Vitest needs the `resolve-js-to-ts` plugin** (`server/vitest.config.js`). Vite does not follow the NodeNext `.js`→`.ts` fallback; the plugin redirects relative `.js` imports to the `.ts` source when it exists. Don't remove it.
- **`cors` types come from a local shim**, `server/src/types/cors.d.ts`.
- **E2E is self-contained** — it clones the project DB into `caro_test` and runs its own servers on `:3099`/`:5199`. Setup, commands and gotchas: `tag_registry_test_spec.md` §2.
- **Renaming a tag changes its `tag_id`.** Apply matches by `tag_path`, so a rename retires the id and issues a new one, and a rename back issues a third — the history stays under the first. To change only a module-relative name, toggle `In_Tag_Name` on a level: that is a modification and keeps the id.
- **Modal has no `role="dialog"`.** Locate with `.locator('.shadow-xl').filter({ hasText: '...' })`.
