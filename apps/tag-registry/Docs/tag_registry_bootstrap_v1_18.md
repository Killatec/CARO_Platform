# Tag Registry Admin Tool — Project Bootstrap Document
**v1.18** | Generated: 2026-03-17  
Companion documents: [Functional Spec v1.15](tag_registry_spec_v1_15.md) | [API Spec v1.13](tag_registry_api_spec_v1_13.md)

---

## 1. Purpose

This document provides the project structure, tooling decisions, component architecture, and seed data needed to bootstrap the Tag Registry Admin Tool prototype. It is intended to be read by Claude Code before generating any code.

| Phase | Scope |
|-------|-------|
| Phase 1 (this document) | Template editing, asset tree editing, client-side cascade simulation, batch save with hash checking and cascade confirmation modal, on-demand in-memory registry calculation displayed as a flat read-only table. No database. |
| Phase 2 (future) | Registry persistence (PostgreSQL), diff/apply workflow, revision history, retired tag tracking. |

---

## 2. Explicit Phase 1 Assumptions

| Decision | Value |
|----------|-------|
| Package manager | npm |
| Language | JavaScript (no TypeScript) |
| Frontend bundler | Vite + React |
| CSS approach | Tailwind CSS utility classes. No component library (shadcn, MUI, etc.). |
| Backend framework | Node.js + Express |
| Database | None in Phase 1. Do not install pg, knex, or any database client. |
| Authentication | None. |
| Pending operation storage | None. The batch save endpoint is stateless — no `pending_id`, no server-side pending store. |
| Registry storage | In-memory only. Calculated on demand. Never persisted. |
| Root selection | A single global root dropdown. On selection, the client fetches all reachable templates from the server. Root dropdown is disabled while `isDirty` is true. |
| Template type source of truth | The `template_type` field in each JSON file. Subfolders are browsing convenience only. |
| Shared validation | `apps/tag-registry/shared/` — local directory, not a workspace package. Both server and client import via relative paths. |
| UI package | `@caro/ui` workspace package. Contains generic primitives and design tokens only. Tag Registry-specific components live in `client/src/components/shared/`. |
| State management | Zustand stores: `useTemplateGraphStore`, `useRegistryStore`, `useUIStore`. |
| Tests | None. |
| Monorepo position | Tag Registry lives at `CARO_Platform/apps/tag-registry/`. The CARO_Platform monorepo root is the npm workspaces root. |

---

## 3. Folder Structure

```
CARO_Platform/                        # git repository root
  package.json                        # npm workspaces root: [packages/*, apps/*]
  .env.example
  .gitignore
  README.md

  packages/
    ui/                               # @caro/ui — generic primitives and tokens
      package.json                    # name: @caro/ui
      tailwind.config.js
      src/
        tokens/
          index.css                   # CSS custom properties
          tokens.js                   # JS token map
        primitives/                   # stateless, zero domain knowledge
          Button.jsx
          Input.jsx
          Badge.jsx
          Table.jsx
          Modal.jsx
          Tooltip.jsx
          Dropdown.jsx
          index.js

  apps/
    tag-registry/                     # Tag Registry Admin Tool
      Docs/                           # spec documents
      shared/                         # local shared module (NOT a workspace package)
        package.json                  # { "type": "module" } only
        index.js                      # re-exports all functions
        validateTemplate.js
        validateGraph.js
        simulateCascade.js
        applyFieldCascade.js
        validateParentTypes.js
        resolveRegistry.js
        constants.js
        hashTemplate.js
        utils.js                      # deepEqual, deepNotEqual

      server/
        package.json
        src/
          index.js                    # entry point, env validation, app.listen
          app.js                      # Express app factory, router mount
          routes/
            templates.js
            # registry.js — DO NOT CREATE in Phase 1. Phase 2 only.
          services/
            templateService.js
            # registryService.js — Phase 2 only
          middleware/
            errorHandler.js
            asyncWrap.js

      client/
        package.json
        tailwind.config.js            # extends @caro/ui/tailwind.config.js
        vite.config.js                # proxy /api to server on port 3001
        index.html
        src/
          main.jsx
          App.jsx
          api/
            client.js                 # base fetch wrapper, cache: 'no-store' on all GETs
            templates.js              # loadRoot, batchSave, listTemplates, deleteTemplate
          stores/
            useTemplateGraphStore.js
            useRegistryStore.js
            useUIStore.js
          components/
            layout/
              AppShell.jsx
              Sidebar.jsx
            tree/
              AssetTree.jsx
              TreeNode.jsx
            panel/
              TemplatesTree.jsx
              FieldsPanel.jsx
              FieldRow.jsx
            registry/
              RegistryTable.jsx
            shared/
              # Tag Registry-specific UI components (moved from @caro/ui/widgets)
              TagPathLabel.jsx
              SeverityBadge.jsx
              FieldValueRow.jsx
              JsonViewer.jsx
              TrashIcon.jsx           # shared trash icon SVG component
              # Modals and panels
              CascadeModal.jsx        # cascade confirm — server triggered
              CascadePreviewModal.jsx # cascade preview — client triggered
              CascadeDiffContent.jsx  # shared diff renderer for both cascade modals
              NewTemplateModal.jsx
              AddFieldModal.jsx
              ValidationPanel.jsx
          hooks/
            useValidation.js
            useRootTemplate.js
          utils/
            resolveTree.js
          pages/
            EditorPage.jsx
            RegistryPage.jsx

      scripts/
        migrate_field_types.js        # one-off: converts flat fields to { field_type, default }

      templates/                      # seed template JSON files (see Section 7)
        tags/
        parameters/
        modules/
```

---

## 4. Key Implementation Notes

### 4.1 `apps/tag-registry/shared/` Module

Must be environment-agnostic: no `fs`, no Express, no DOM. Pure functions and constants only. Both server and client declare relative-path imports. A `package.json` containing only `{ "type": "module" }` scopes the ESM declaration to this directory.

**Key function signatures:**

- `validateTemplate(template)` — returns `{ valid: bool, errors: [], warnings: [] }`. Each field in `template.fields` must be `{ field_type, default }`. `field_type` ∈ `{ "Numeric", "String", "Boolean" }`. `typeof default` must match. The `i32_array` type is not supported.
- `validateGraph(templateMap)` — returns `{ valid: bool, errors: [], warnings: [] }`
- `simulateCascade(currentTemplateMap, proposedChanges, originalTemplateMap?)` — returns `{ requiresConfirmation: bool, diff: { fields_added, fields_removed, fields_changed, instance_fields_changed }, affectedParents: [{ parent_template_name, asset_name, dropped_instance_values }] }`. `affectedParents` is per-instance, not per-template. `fields_changed` reports `.default` scalar values, not full definition objects.
- `applyFieldCascade(templateMap, changedTemplate)` — returns updated `templateMap`. Pure.
- `validateParentTypes(templateMap, rootName, options)` — returns `{ errors: [], warnings: [] }`
- `resolveRegistry(templateMap, rootName)` — returns flat tag list: `[{ tag_path, data_type, is_setpoint, meta }]`. Extracts `.default` from field definitions before merging with instance overrides.
- `hashTemplate(template)` — returns 6-character hex SHA-1 string
- `deepEqual(a, b)` / `deepNotEqual(a, b)` — JSON.stringify-based deep equality (`utils.js`). Used by store and components to avoid inline comparisons.

### 4.2 API Client (`api/client.js`)

- Prepends `/api/v1` to all paths.
- Sets `Content-Type: application/json` on all requests with a body.
- All GET requests pass `cache: 'no-store'` to bypass browser caching after saves.
- Unwraps the response envelope: on `ok: true` returns `data` directly; on `ok: false` throws an error object with `code` and `message`.

### 4.3 Error Handling (server)

- All async route handlers are wrapped with `asyncWrap.js`.
- `errorHandler.js` is the single Express error handler, mapping known error codes to HTTP status codes.
- Services throw plain `Error` objects with a `code` property. They never set HTTP status codes directly.
- `loadRoot` in `api/templates.js` has a null guard: logs an error and returns early if called with a null/undefined template name, preventing `GET /api/v1/templates/root/null` 404s.

### 4.4 Template File I/O

- All writes are atomic: write to a `.tmp` file first, then rename over the target.
- `templateService.js` maintains an in-memory index of `template_name → { file_path, hash }` mappings, rebuilt on startup. Updated on every write or delete.
- The `template_type` field in each JSON file is the source of truth.
- All batch writes are all-or-nothing: validate all hashes first, then write all changed files and unlink all deleted files, then update the index.

### 4.5 Load Root

`GET /api/v1/templates/root/:template_name` walks the template dependency graph starting from the named root and returns a flat map of all reachable templates. This endpoint is used in two contexts:

1. **Root selection:** `useTemplateGraphStore.loadRoot()` fetches the full hierarchy when a root is chosen from the dropdown.
2. **On-demand injection:** `TemplatesTree` leaf clicks, drag-and-drop drops, and template delete flows call the same endpoint to fetch a template's subgraph and inject it via `injectTemplateGraph` without selecting a root.

### 4.6 Batch Save

`POST /api/v1/templates/batch` accepts `{ changes, deletions, confirmed }`.

**`changes`** — array of `{ template_name, original_hash, template }` for modified/new templates.  
**`deletions`** — array of `{ template_name, original_hash }` for templates queued for deletion.  
**`confirmed`** — boolean, `true` when resubmitting after `requires_confirmation`.

Server processing order:

1. Validate all `original_hash` values for both `changes` and `deletions`. Any mismatch → reject entire batch with `STALE_TEMPLATE`.
2. Build proposed set: current index + `changes` − `deletions`.
3. Run `validateGraph` on the proposed set.
4. Run `simulateCascade` on `changes` to identify upstream cascade impacts.
5. If upstream impacts exist and `confirmed` is not `true` → return `requires_confirmation: true` with `diff` and `affectedParents`. No files written.
6. If `confirmed: true` or no upstream impacts → write all changed files atomically (cascade updates applied), unlink deleted template files, update index. Return `{ ok: true, modified_files, deleted_files }`.

> **Note:** No `pending_id` is used. The client holds the full batch in memory and resubmits with `confirmed: true` if required.

### 4.7 `useTemplateGraphStore`

Central store managing the client-side template graph.

> **`isDirty` is not a store property.** Consumers must use the inline selector:  
> `state.dirtySet.size > 0 || state.pendingDeletions.size > 0`

**State:**

| Field | Type | Description |
|-------|------|-------------|
| `templateMap` | `Map<name, { template, hash }>` | All templates in the current graph. |
| `originalTemplateMap` | `Map<name, { template, hash }>` | Snapshot taken at `loadRoot()` or `injectTemplateGraph()` time via `structuredClone()`. Never mutated after set. Baseline for `simulateCascade` and dirty detection. |
| `dirtySet` | `Set<name>` | Templates with unsaved edits or newly created this session. |
| `hashes` | `Map<name, hash>` | Original server hashes. Source for `original_hash` in batch save payload. |
| `pendingDeletions` | `Set<name>` | Templates queued for server-side deletion on next Save. Included in the `deletions` array of the batch request. |
| `rootTemplateName` | `string \| null` | Currently loaded root. `null` in isolation mode. |
| `validationState` | `{ messages, isValid }` | Set by `useValidation` hook. |

**Actions (in logical order):**

**Core data actions:**

- `loadRoot(name)` — fetches full graph from server, resets `templateMap`, `originalTemplateMap`, `hashes`, `dirtySet`, `pendingDeletions`. Sets `rootTemplateName`.
- `updateTemplate(name, partial)` — merges partial into template, applies `applyFieldCascade`. Re-evaluates `dirtySet` membership: removes name if result deeply equals `originalTemplateMap` baseline; adds if different. New templates (no `originalTemplateMap` entry) are always dirty.
- `addTemplate(template, existingHash = null)` — adds a new template to `templateMap`, `hashes`, and `dirtySet`. `existingHash` is the server hash for templates fetched individually; `null` for new unsaved templates.
- `injectTemplateGraph(templates)` — injects a flat map `{ [name]: { template, hash } }` into `templateMap`, `originalTemplateMap`, and `hashes`. **Never overwrites existing entries.** Does not touch `dirtySet`. Sets `originalTemplateMap` baseline at fetch time so `simulateCascade` produces a real diff.

**Deletion actions:**

- `markForDeletion(name)` — queues a **saved** template for server-side deletion on next Save. Removes from `templateMap` and `dirtySet` immediately; keeps in `originalTemplateMap` and `hashes` for `original_hash`; adds to `pendingDeletions`. **Do not call for new unsaved templates** — use `removeTemplate` instead.
- `removeTemplate(name)` — immediately removes from all five maps atomically (`templateMap`, `originalTemplateMap`, `hashes`, `dirtySet`, `pendingDeletions`). Used for: instant deletion of new unsaved templates, and post-save cleanup. **Do not call for saved templates awaiting deletion** — use `markForDeletion` instead.

**Save/discard actions:**

- `save(onRequiresConfirmation)` — no-op if `isValid` is false or both `dirtySet` and `pendingDeletions` are empty. Builds `{ changes, deletions }` batch payload. On `STALE_TEMPLATE` or success, calls `loadRoot(rootTemplateName)` (rooted mode) or `_resetToIsolationMode(get, set)` (isolation mode).
- `confirmSave(batch)` — resubmits `{ changes, deletions }` with `confirmed: true`. Same post-save reset pattern.
- `discard()` — calls `loadRoot(rootTemplateName)` (rooted) or `_resetToIsolationMode(get, set)` (isolation mode).

**Utility:**

- `setValidationState(state)` — called by `useValidation` hook.

**`_resetToIsolationMode(get, set)` — private module-level helper:**

Called by `save()` success, `save()` `STALE_TEMPLATE`, `confirmSave()` success, `confirmSave()` `STALE_TEMPLATE`, and `discard()` — all when `rootTemplateName` is null.

1. Captures `selectedTemplateTree` from `useUIStore` **synchronously at position 0**, before any `set()` or `await`. This prevents a race where the selection is cleared before the async function resumes.
2. Captures `isNewTemplate = selectedTemplate && !get().originalTemplateMap.has(selectedTemplate)` — must be captured before the wipe, since `originalTemplateMap` will be empty after.
3. Wipes `templateMap`, `originalTemplateMap`, `hashes`, `dirtySet`, `pendingDeletions` to empty.
4. If `!isNewTemplate` and `selectedTemplate` is set: re-fetches the full subgraph via `loadRoot(selectedTemplate)` and calls `injectTemplateGraph`. Leaves `selectedTemplateTree` set — the panel and highlight stay intact.
5. If `isNewTemplate`: calls `setSelectedTemplateTree(null)` — nothing to re-fetch since the template was never saved.

### 4.8 `useValidation` Hook

Runs `validateTemplate`, `validateGraph`, and `validateParentTypes` synchronously on every `templateMap` change. Exposes `messages` and `isValid`. No server call. No debounce.

### 4.9 `CascadeModal` (Confirm) Component

Shown when batch save returns `requires_confirmation: true`. Renders diff content via the shared `CascadeDiffContent` component. Confirm button resubmits the original `{ changes, deletions }` batch with `confirmed: true`. Cancel dismisses without saving. Adds Confirm/Cancel footer.

### 4.9b `CascadePreviewModal` Component

Triggered client-side by the "See what's changed" button in `AppShell` header when `isDirty` is true. Calls `simulateCascade` on the current `templateMap` with `originalTemplateMap` as the baseline. Renders diff content via the shared `CascadeDiffContent` component. Informational only. Adds Close footer.

### 4.9c `TemplatesTree` Component

Renders all templates returned by `GET /api/v1/templates` grouped by `template_type`. Each group is a collapsible folder; all folders start collapsed. Folder expand/collapse state is preserved across `fetchTemplates()` re-fetches (functional update preserves existing entries, adds new folders as collapsed, prunes removed folders).

**Leaf click flow:** if the template is not already in `templateMap`, calls `GET /api/v1/templates/root/:name` and injects the full subgraph via `injectTemplateGraph` before setting `selectedTemplateTree`. This eliminates `INVALID_REFERENCE` validation errors and sets the `originalTemplateMap` baseline at fetch time.

**Re-fetch trigger:** `useEffect` on `dirtySet` and `pendingDeletions` — re-fetches when **both** are empty (`dirtySet.size === 0 && pendingDeletions.size === 0`). This prevents re-fetch when only `pendingDeletions` is non-empty (which would incorrectly restore deleted templates).

**New template flow:** "New" button opens `NewTemplateModal`. On confirm, calls `addTemplate(template, null)` and updates local `grouped` state.

**Delete flow:**
- Determines `isNew` as: `templateMap.has(name) && (hashes.get(name) === null || hashes.get(name) === undefined)`. Uses `hashes` map, not `originalTemplateMap`, to avoid treating unfetched-but-saved templates as new.
- New unsaved: calls `removeTemplate(name)` — instant, no server call.
- Saved: if `!hashes.has(name)`, first fetches hash via `loadRoot(name)` + `injectTemplateGraph` (prevents `STALE_TEMPLATE` on save). Then calls `markForDeletion(name)`.

**Drag source:** each template leaf is `draggable`. `onDragStart` sets `text/plain = template_name`.

**Dirty indicator:** `TemplateLeaf` sub-component uses `useMemo` to compute `isDirty` by comparing full template object against `originalTemplateMap` baseline. New templates (in `templateMap`, absent from `originalTemplateMap`) are always dirty. Dirty leaves show `font-semibold text-orange-700`.

### 4.9d `FieldsPanel` Component

Replaces the former `NodePanel`. Derives content from `useUIStore` selections. Uses `selectionKey + setTimeout(0)` blank-tick pattern to go blank for one tick on every selection switch.

> **Do not split the blank-tick `useEffect` dependency array** — it must be `[selectionKey]`, not the raw selection fields separately, or the blank will fire on unrelated store updates. A `prevKeyRef` is maintained for future conditional guard needs.

**Template mode** (`selectedTemplateTree` set):
- Read-only metadata rows: Template Name, Template Type.
- Editable default fields via `FieldTableRow`. `isDirtyField` computed per-field: new key (absent from `originalTemplateMap` baseline) or changed default value.
- `+` button in `PropertiesHeader` opens `AddFieldModal`.
- Trash icon on each field row removes the field via `updateTemplate()`.

**Instance mode** (`selectedSystemTreeNode` set):
- Read-only metadata rows: Template Name, Template Type.
- Editable Asset Name input (`onChange` only — no `onBlur` or `setSelectedSystemTreeNode` to prevent `selectionKey` mutation on keystroke).
- All template fields editable via `FieldTableRow`. `isDirtyField` per-field: compares current override against `originalTemplateMap` baseline for that specific child entry.
- Child node lookup uses `children[selectedSystemTreeNodeChildIndex]` (index-based, not `asset_name` match — stable across `asset_name` edits).

**Field color scheme** (`FieldTableRow`):
- `isDirtyField=true` (either mode): `font-semibold text-orange-700` on label and input text.
- `isDirtyField=false, isOverride=true` (instance mode): `text-blue-600` on input text.
- `isDirtyField=false, isOverride=false`: `text-gray-700`.

Boolean checkboxes use `accent-orange-600` / `accent-blue-600` accordingly.

**`FieldTableRow`** is a local `<tr>`-based component within `FieldsPanel.jsx`. It is distinct from `FieldRow.jsx` (which uses `FieldValueRow` with div/flex layout). `FieldRow` is not used inside `FieldsPanel`.

### 4.9e `CascadeDiffContent` Component

Shared diff renderer used by both `CascadePreviewModal` and `CascadeModal`. Accepts props:
- `newTemplates` — new templates not yet on server (purple section).
- `childrenChanged` — added/removed child instances per parent template (indigo section).
- `pendingDeletions` — templates queued for deletion (red section).
- `diff` — `{ fields_added, fields_removed, fields_changed, instance_fields_changed }` from `simulateCascade`.
- `affectedParents` — upstream parent instances affected by field schema changes.

"No changes detected" text is shown only when all props are empty/absent.

`AppShell._buildDiffEnrichment()` computes `new_templates`, `pending_deletions`, and `children_changed` from store state and spreads them into the modal payload for both `handleSeeChanges` and the `handleSave` callback.

### 4.10 Global Root Selection

`useRootTemplate` hook holds the selected root template name. Changing the root calls `loadRoot()` on `useTemplateGraphStore`, which re-fetches the full graph and resets all local state. Root selection is session-only. The root dropdown is disabled while `isDirty` is true.

### 4.11 Tree Rendering

The System Tree is rendered from `templateMap` using `resolveTree(templateMap, rootName)` in `utils/resolveTree.js`. No server call on render.

**Collapse state:** lifted to `AssetTree` as `expandedNodes: Map<ownPath, bool>`. `TreeNode` derives `isExpanded = expandedNodes[ownPath] !== false` (undefined = expanded by default). `AssetTree` resets to `{}` on `rootTemplateName` change.

**Node identity:** each `TreeNode` receives `ownPath` (dot-separated `asset_name` segments from root template name), `parentPath`, `parentTemplateName`, and `childIndex`. These are used for selection identity, dirty detection, and child removal.

**Dirty detection:** `TreeNode` uses `useMemo` comparing `children[childIndex]` in `templateMap` vs `originalTemplateMap`. Root nodes are never dirty. New children (no original entry) are always dirty. Dirty nodes show `font-semibold text-orange-700`.

**Drop target:** non-`tag` nodes accept drops from `TemplatesTree`. `handleDrop` is `async`: if the dropped template is not in `templateMap`, fetches via `loadRoot` + `injectTemplateGraph` before calling `updateTemplate`. Reads parent template via `useTemplateGraphStore.getState()` after the `await` to avoid stale closure.

**Trash icon:** shown on all non-root nodes (`parentTemplateName !== null`). Removes the child from `parent.children` by index via `updateTemplate()`. Clears selection if the removed node was selected.

### 4.12 Vite Proxy

```js
server: { proxy: { '/api': 'http://localhost:3001' } }
```

### 4.13 Environment Variables

`index.js` must validate that `TEMPLATES_DIR` is set at startup and exit with a clear error message if missing. `PORT` defaults to 3001. `MAX_TAG_PATH_LENGTH` defaults to 100. `DATABASE_URL` must not be referenced in Phase 1 code.

### 4.14 Registry Calculation (Phase 1)

Registry calculation is done entirely client-side using `resolveRegistry(templateMap, rootName)`. There is no `GET /api/v1/registry` server endpoint in Phase 1.

- `RegistryPage` calls `resolveRegistry` on mount and subscribes to `templateMap` changes via `useTemplateGraphStore`.
- If validation errors are present, the registry table is replaced by a 'Resolve errors to view registry' banner.
- On success the flat tag list is displayed immediately with no loading state.
- `useRegistryStore` holds the resolved tags array, sort field, and sort direction.

### 4.15 Template Deletion

Template deletions are pending client-side operations, not immediate server calls. See section 4.7 (`markForDeletion`, `removeTemplate`) and section 4.9c (`TemplatesTree` delete flow).

The `DELETE /api/v1/templates/:template_name` endpoint remains on the server for tooling/CI use but is no longer called by the client in normal flow.

---

## 5. UI Architecture

### 5.1 Layer Overview

| Layer | Package | Purpose |
|-------|---------|---------|
| Style tokens | `@caro/ui/tokens` | CSS custom properties and JS token map. |
| UI primitives | `@caro/ui/primitives` | Stateless, zero domain knowledge. Button, Input, Badge, Table, Modal, Tooltip, Dropdown. Shared across all CARO_Platform apps. |
| App shared components | `apps/tag-registry/client/src/components/shared/` | Tag Registry-specific UI: SeverityBadge, FieldValueRow, TagPathLabel, JsonViewer, TrashIcon, cascade modals, ValidationPanel, NewTemplateModal, AddFieldModal. |
| App components | `apps/tag-registry/client/src/components/` | Tag Registry-specific. AssetTree, TemplatesTree, FieldsPanel, RegistryTable. Compose primitives and shared components. |
| Pages | `apps/tag-registry/client/src/pages/` | Full page layouts. EditorPage, RegistryPage. |
| Stores | `apps/tag-registry/client/src/stores/` | Zustand stores. `useTemplateGraphStore`, `useRegistryStore`, `useUIStore`. |

### 5.2 Token System

CSS custom properties defined in `packages/ui/src/tokens/index.css`. The Tailwind config in `packages/ui/tailwind.config.js` maps these to Tailwind utility classes.

### 5.3 Package Boundaries

`@caro/ui` primitives and tokens have no dependency on the Tag Registry domain and are shared across CARO_Platform apps. The widgets that were originally in `@caro/ui/widgets` (TagPathLabel, SeverityBadge, FieldValueRow, JsonViewer) are Tag Registry-specific and have been moved to `apps/tag-registry/client/src/components/shared/`.

### 5.4 Zustand Store Responsibilities

- **`useTemplateGraphStore`** — `templateMap`, `originalTemplateMap`, `dirtySet`, `hashes`, `pendingDeletions`, `rootTemplateName`, `validationState`. Actions: `loadRoot`, `updateTemplate`, `addTemplate`, `injectTemplateGraph`, `markForDeletion`, `removeTemplate`, `save`, `confirmSave`, `discard`, `setValidationState`. `isDirty` is an inline selector, not a store property.
- **`useRegistryStore`** — `tags` array, `sortField`, `sortDirection`. Actions: `fetchRegistry`, `setSort`.
- **`useUIStore`** — `selectedSystemTreeNode` (full dot-separated tree path, unique identity key), `selectedSystemTreeNodeParentPath`, `selectedSystemTreeNodeAssetName`, `selectedSystemTreeNodeParentTemplate`, `selectedSystemTreeNodeChildIndex`, `selectedTemplateTree`, `activeModal`, `modalProps`. Setters enforce mutual exclusion between system tree and template tree selections — setting one clears the other atomically.

> **`selectedSystemTreeNode` is the full dot-separated tree path** (e.g. `"Plant1_System_A.RFPowerModule.RF_Fwd.setpoint"`), not just the `asset_name`. It is a UI-only identity key — never sent to the server. Guaranteed unique by the duplicate-sibling-name validation constraint. `selectedSystemTreeNodeChildIndex` is the array index of this node in its parent's `children` array, captured at click time and used for all child reads/writes to avoid stale-by-name lookups.

> **`setSelectedSystemTreeNode(ownPath, parentPath, assetName, parentTemplateName, childIndex)`** — 5-argument setter. Sets all five fields and clears `selectedTemplateTree` atomically.

---

## 6. Phase Split Reference

| Feature | Phase 1 | Phase 2 |
|---------|---------|---------|
| Shared validation | `apps/tag-registry/shared/`, used by both client and server | Same |
| Template graph | Fetched on root select, held in client memory. On-demand injection for individual templates. | Same |
| Cascade simulation | Client-side via `simulateCascade` | Same |
| Template change propagation | Client-side via `applyFieldCascade` on any structural change, immediate | Same + server applies on save |
| Batch save | `POST /api/v1/templates/batch`, stateless, hash checking, deletions array | Same |
| Template deletion | Pending client-side, committed via `deletions` in batch save | Same |
| Registry calculation | Client-side via `resolveRegistry`, live on graph change | Same logic, persisted to PostgreSQL on apply |
| Registry server endpoint | Not implemented | Reintroduced for persistence |
| Registry UI | Single table, column-sortable, live client-side | Two-panel diff view, color-coded rows, Apply button |
| Registry persistence | Not implemented | `tag_registry` append-only table |
| Diff / apply workflow | Not implemented | `POST /registry/preview` + `POST /registry/apply` |
| Revision history | Not implemented | `registry_revisions` + `GET /registry/revisions` |
| Retired tags | Not tracked | Detected during apply |
| Database | None | node-postgres, SERIALIZABLE transaction |
| Stale conflict | Re-fetch root, discard local changes | Merge support (future work) |

---

## 7. Seed Template Files

### 7.1 Tag Templates (`apps/tag-registry/templates/tags/`)

| File | fields |
|------|--------|
| `numeric_set.json` | `unit: { String, "" }`, `eng_min: { Numeric, 0.0 }`, `eng_max: { Numeric, 100.0 }` |
| `numeric_mon.json` | Same as numeric_set |
| `boolean_set.json` | (none beyond required) |
| `boolean_mon.json` | (none beyond required) |

### 7.2 Parameter Template (`apps/tag-registry/templates/parameters/`)

File: `analog_control.json`
- fields: `description: { String, "" }`, `eng_min: { Numeric, 0.0 }`, `eng_max: { Numeric, 100.0 }`
- children: `numeric_set → "setpoint"`, `numeric_mon → "monitor"`, `boolean_set → "interlock_enable"`

### 7.3 Module Template (`apps/tag-registry/templates/modules/`)

File: `rf_power_module.json`
- fields: `description: { String, "" }`
- children: two instances of `analog_control` — `"RF_Fwd"` (`eng_max: 25`) and `"RF_Ref"` (default fields)

### 7.4 Root Template (`apps/tag-registry/templates/modules/`)

File: `Plant1_System_A.json`
- `template_type: "module"`, `template_name: "Plant1_System_A"`
- fields: `{}`
- children: `rf_power_module → "RFPowerModule"` (`description: "Main RF power stage"`)

> **Note:** There is no `machines/` subfolder. `Plant1_System_A` is a module template. The user selects it from the global root dropdown.

---

## 8. Frontend Component Behaviour Notes

### 8.0 Global Root State

`useRootTemplate` hook holds the selected root template name. Changing the root calls `loadRoot()` on `useTemplateGraphStore`, which re-fetches the full graph and resets all local state. Root selection is session-only. The root dropdown is **disabled** while `isDirty` is true to prevent wiping unsaved edits.

### 8.1 Shared Template State

`useTemplateGraphStore` is the single source of truth for template data during a session. `isDirty` is computed inline by consumers as `state.dirtySet.size > 0 || state.pendingDeletions.size > 0`. `isValid` comes from `useValidation`. Save is disabled when `!isDirty || !isValid`.

### 8.2 AssetTree / TreeNode

- Rendered from `templateMap` via `resolveTree`.
- Collapse state lifted to `AssetTree` as `expandedNodes` map keyed by `ownPath`. Default `undefined` = expanded. Resets to `{}` on root change.
- Non-`tag` nodes are valid drag-drop targets (highlighted with blue tint + dashed border on drag-over).
- All non-root nodes have a trash icon for child removal.
- Dirty nodes shown in `font-semibold text-orange-700`.

### 8.3 TemplatesTree / FieldsPanel

See sections 4.9c and 4.9d for full behaviour specifications.

Both trees use `font-normal text-sm text-gray-800` for item names. Dirty items use `font-semibold text-orange-700`. Selection uses `text-blue-800`. Collapse buttons use the same style across both trees.

### 8.4 EditorPage Layout

- **Top bar (AppShell header):** Global root selector dropdown (disabled when dirty). Save / See what's changed / Cancel buttons — visible when `isDirty`. Save disabled when `!isValid`.
- **Left panel (System Tree):** `AssetTree` for the selected root. Content-driven width (`flex-shrink-0 min-w-[25rem]`). `whitespace-nowrap` on nodes.
- **Right panel:** Split vertically into `TemplatesTree` (top) and `FieldsPanel` (bottom). Content-driven width (`flex-shrink-0 min-w-[20rem]`). `whitespace-nowrap` on items.
- **Below row:** `ValidationPanel` — always visible with a "Validation" section header. Message list shown only when messages are present.

### 8.5 RegistryPage (Phase 1)

- Calls `resolveRegistry(templateMap, rootName)` on mount and on `templateMap` change. No server call.
- If no root is selected, shows a prompt to select one first.
- If validation errors are present, shows a 'Resolve errors to view registry' banner instead of the table.
- Columns: `tag_path`, `data_type`, `is_setpoint`, `meta`.
- Column headers toggle ascending/descending sort. Default: `tag_path` ascending.
- `meta` column renders compact JSON with expand-on-click.
- Pagination not implemented in Phase 1.
- `ValidationPanel` below table shows any `resolveRegistry` errors. Informational only.

### 8.6 `useValidation` Hook

Runs all client-side validation checks synchronously on every `templateMap` change. No server call. No debounce. Exposes `messages` and `isValid`. All checks: `INVALID_ASSET_NAME`, `DUPLICATE_SIBLING_NAME`, `CIRCULAR_REFERENCE`, `INVALID_REFERENCE`, `TAG_PATH_TOO_LONG`, `SCHEMA_VALIDATION_ERROR`, `UNKNOWN_FIELD`, `PARENT_TYPE_MISSING`, `DUPLICATE_PARENT_TYPE`, `EMPTY_BRANCH` (warning).

### 8.7 ValidationPanel Component

Always renders with a "Validation" section header. Message list renders only when messages are present. Each row: severity badge, error code, human-readable message, optional ref. Both `"error"` and `"warning"` severity set `isValid = false`.

---

## 9. Out of Scope for Phase 1

- Database of any kind — no pg, no SQL files, no db/ directory.
- Registry persistence, diff, apply, or revision history.
- Authentication and user sessions.
- Bulk import of flat tag lists.
- WebSocket / SSE live refresh.
- Stale conflict merging — discard and re-fetch only.
- Production build configuration or deployment.
- Error boundary components in React.
- `machines/` subfolder or any special machine template type.
