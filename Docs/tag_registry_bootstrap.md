# Tag Registry Admin Tool — Bootstrap
**Updated:** 2026-04-07
Companion docs: `tag_registry_spec.md` | `tag_registry_api_spec.md` | `tag_registry_test_spec.md`

---

## 1. Folder Structure

```
apps/tag-registry/
  Docs/
  shared/                        pure-function TypeScript module (NOT a workspace package)
    package.json
    tsconfig.json
    index.ts
    types.ts                     centralized interface file (all shared types)
    validateTemplate.ts
    validateGraph.ts
    simulateCascade.ts
    applyFieldCascade.ts
    validateParentTypes.ts
    resolveRegistry.ts
    constants.ts
    hashTemplate.ts
    utils.ts                     deepEqual, deepNotEqual
  server/
    package.json
    tsconfig.json
    src/
      index.ts                   entry point, env validation, app.listen
      app.ts                     Express app factory, router mount
      routes/
        templates.ts
        registry.ts              GET /registry, POST /apply, GET /revisions
      services/
        templateService.ts
        registryService.ts
  client/
    package.json
    tailwind.config.js           extends @caro/ui/tailwind.config.js
    vite.config.ts               proxy /api → :3001
    index.html
    src/
      main.tsx
      App.tsx
      api/
        client.ts
        templates.ts
        registry.ts
      stores/
        useTemplateGraphStore.ts
        useRegistryStore.ts
        useUIStore.ts
      components/
        layout/
          AppShell.tsx
          Sidebar.tsx
        tree/
          AssetTree.tsx
          TreeNode.tsx
        panel/
          TemplatesTree.tsx
          FieldsPanel.tsx
          FieldRow.tsx
        registry/
          RegistryTable.tsx
        shared/
          TagPathLabel.tsx
          SeverityBadge.tsx
          FieldValueRow.tsx
          JsonViewer.tsx
          TrashIcon.tsx
          MetaModalBody.tsx
          CascadeModal.tsx
          CascadePreviewModal.tsx
          CascadeDiffContent.tsx
          NewTemplateModal.tsx
          AddFieldModal.tsx
          ValidationPanel.tsx
      hooks/
        useValidation.ts
        useRootTemplate.ts
      utils/
        resolveTree.ts
        diffRegistry.ts
        formatDate.ts
        dragTypes.ts             drag payload types (TreeDragData, TemplateDragData) + module-level active-drag tracker for HTML5 DnD
      pages/
        EditorPage.tsx
        RegistryPage.tsx
        HistoryPage.tsx
  e2e/
    tests/
    helpers/
      api.js
      pageObjects.js
    playwright.config.js
  templates/                     flat directory — all template JSON files, no subdirectories
```

---

## 2. Environment Variables

Server reads from `apps/tag-registry/server/.env` only. Root `.env` is never seen.

| Variable | Default | Required |
|---|---|---|
| `TEMPLATES_DIR` | — | **Yes** — exit with clear error if missing |
| `PORT` | `3001` | No |
| `MAX_TAG_PATH_LENGTH` | `100` | No |
| `PGHOST` | `localhost` | No |
| `PGPORT` | `5432` | No |
| `PGDATABASE` | `caro_dev` | No |
| `PGUSER` | `postgres` | No |
| `PGPASSWORD` | — | **Yes** |
| `VALIDATE_REQUIRED_PARENT_TYPES` | — | No — comma-separated list |
| `VALIDATE_UNIQUE_PARENT_TYPES` | — | No — `true`/`false` |

---

## 3. `shared/` Module

Environment-agnostic. No `fs`, no Express, no DOM. Both server and client import via relative paths.

### Function Signatures

**`validateTemplate(template)`**
Returns `{ valid: bool, errors: [], warnings: [] }`.
- Each field in `template.fields` must be `{ field_type, default }`. `field_type` ∈ `{ "Numeric", "String", "Boolean", "TagType", "ModuleType" }`. `typeof default` must match.
- `data_type` and `is_setpoint` are regular entries in `fields{}` with field_type `TagType` and `Boolean` respectively. The resolver extracts them from resolved fields (defaults: `data_type` → `'f32'`, `is_setpoint` → `false`).
- `Module_Type` is a required field on module templates with field_type `ModuleType`. The resolver extracts `module` (instance name) and `module_type` (Module_Type value) from the nearest module-level ancestor in the meta chain.
- Tag templates must also include a `Trends` field (field_type `Boolean`). `validateTemplate` enforces all three required fields on tag templates.
- `template_name` must not contain a dot (`INVALID_TEMPLATE_NAME`).

**`validateGraph(templateMap)`**
Returns `{ valid: bool, errors: [], warnings: [] }`.
Runs on the entire `templateMap`, not just the current root's subgraph.

**`simulateCascade(currentTemplateMap, proposedChanges, originalTemplateMap?)`**
Returns `{ requiresConfirmation: bool, diff: { fields_added, fields_removed, fields_changed, instance_fields_changed, template_type_changed }, affectedParents: [{ parent_template_name, asset_name, dropped_instance_values }] }`.
- `affectedParents` is per-instance, not per-template.
- `fields_changed` reports `.default` scalar values, not full definition objects.
- `template_type_changed` is an array of `{ template_name, old_value, new_value }` entries for any template whose `template_type` was changed.

**`applyFieldCascade(templateMap, changedTemplate)`**
Returns updated `templateMap`. Pure — does not mutate input.

**`validateParentTypes(templateMap, rootName, options)`**
Returns `{ errors: [], warnings: [] }`.
Options: `{ requiredParentTypes: string[], uniqueParentTypes: boolean }`.

**`resolveRegistry(templateMap, rootName)`**
Returns `[{ tag_path, module, module_type, data_type, is_setpoint, trends, unit, format, eng_min, eng_max, meta }]`.
- First segment of every `tag_path` is `rootName` (not the literal string `'root'`).
- Extracts `.default` from field definitions before merging with instance overrides.
- `module` is the `asset_name` of the nearest ancestor with `template_type: "module"` (null if none). `module_type` is the `Module_Type` field value from that ancestor (null if none).
- Display columns `unit`, `format`, `eng_min`, `eng_max` are resolved by `resolveDisplayField` (see below). They are `null` for tags whose `data_type` is not in `NUMERIC_DATA_TYPES` (`shared/constants.ts`: `new Set(['f32', 'i16'])`).

**`resolveDisplayField(fieldName, meta, assetPath)`** — path-aware display column resolver. Replaces the removed helpers `extractDottedFields` and `firstMatch`.
- Walks `meta[0]` → `meta[last]` (root-to-tag). At each level `i`, computes `relPath = assetPath.slice(i)` — the path segments from that level's node down to the tag.
- For each field key in `level.fields`: a plain key (`key === fieldName`) has specificity 0; a dotted key ending with `.fieldName` whose prefix segments are a leading subsequence of `relPath` has specificity equal to the number of prefix segments.
- **Root priority:** the first level with any match (specificity ≥ 0) wins — lower levels are not consulted. Within a level, the highest-specificity match wins.
- Meta levels hold only template field defaults merged with the direct `ChildRef.fields` for that instance. Dotted keys are never propagated down into child meta levels.

**`hashTemplate(template)`**
Returns 6-character hex SHA-1 string.

**`deepEqual(a, b)` / `deepNotEqual(a, b)`**
JSON.stringify-based deep equality.

---

## 4. API Client (`api/client.ts`)

- Prepends `/api/v1` to all paths.
- Sets `Content-Type: application/json` on all requests with a body.
- All GETs pass `cache: 'no-store'`.
- Unwraps response envelope: `ok: true` → returns `data` directly; `ok: false` → throws `{ code, message }`.

---

## 5. Server

### Error Handling
- All async route handlers wrapped with `asyncWrap` from `@caro/server/asyncWrap`.
- `errorHandler` from `@caro/server/errorHandler` is the single Express error handler. It reads `err.status`, `err.code`, and `err.details` from thrown errors and formats the platform envelope.
- Services throw `Error` with `.code` and `.status` set at the throw site. Never call `res.status().json()` directly in error paths.
- `loadRoot` in `api/templates.js` has a null guard — logs and returns early if called with null/undefined.

### Template File I/O
- All writes atomic: write to `.tmp` then rename over target.
- `templateService.js` maintains in-memory index `template_name → { file_path, hash }`, rebuilt on startup, updated on every write/delete.
- `template_type` field in each JSON file is the source of truth.
- Batch writes are all-or-nothing: validate all hashes first, then write all changed files, then unlink deleted files, then update index.
- New templates are written to `{TEMPLATES_DIR}/{template_name}.json` — flat, no subdirectory routing. No `mkdir` required.

### `POST /api/v1/templates/batch` Processing Order
Accepts `{ changes, deletions, confirmed }`.
1. Validate all `original_hash` values for `changes` and `deletions`. Any mismatch → reject entire batch with `STALE_TEMPLATE`.
2. Build proposed set: current index + `changes` − `deletions`.
3. Run `validateGraph` on proposed set.
4. Run `simulateCascade` on `changes`.
5. If upstream impacts exist and `confirmed !== true` → return `requires_confirmation: true` with `diff` and `affectedParents`. No files written.
6. If `confirmed: true` or no upstream impacts → write all files atomically, unlink deleted files, update index. Return `{ ok: true, modified_files, deleted_files }`.

Graph validation errors returned as `VALIDATION_ERROR` with codes in `details` array.

### `POST /api/v1/registry/apply` Flow
1. Load template graph server-side via `loadRoot()`.
2. Resolve via `resolveRegistry()`.
3. Diff against `getActiveTags()` from `@caro/db`.
4. Inside SERIALIZABLE transaction:
   - Insert `registry_revisions` row → get `registry_rev`.
   - For each added tag: insert `tag_registry` row, `retired=false`.
   - For each modified tag: insert new `tag_registry` row, `retired=false`.
   - For each retired tag: insert `tag_registry` row, `retired=true`.
   - Unchanged tags produce no inserts.
5. `applied_by` hardcoded to `'dev'`.
6. Returns `{ ok, registry_rev, added, modified, retired }` or `{ ok, registry_rev: null, message: 'No changes to apply' }`.

### nodemon
```json
"dev": "nodemon --ext ts,json --watch src --exec \"npx tsx src/index.ts\""
```
Must NOT watch `../templates`. Adding `--watch ../templates` causes restarts on every template write.

---

## 6. `useTemplateGraphStore`

### State

| Field | Type | Description |
|---|---|---|
| `templateMap` | `Map<name, { template, hash }>` | All templates in current graph |
| `originalTemplateMap` | `Map<name, { template, hash }>` | Snapshot at `loadRoot()` / `injectTemplateGraph()` via `structuredClone()`. Never mutated. |
| `dirtySet` | `Set<name>` | Templates with unsaved edits or newly created |
| `hashes` | `Map<name, hash>` | Original server hashes — source for `original_hash` in batch save |
| `pendingDeletions` | `Set<name>` | Templates queued for server-side deletion |
| `rootTemplateName` | `string \| null` | Currently loaded root. `null` in isolation mode. |
| `validationState` | `{ messages, isValid }` | Set by `useValidation` hook |

`isDirty` is **not** a store property. Compute inline: `dirtySet.size > 0 || pendingDeletions.size > 0`.

### Actions

**`loadRoot(name)`** — fetches full graph, resets `templateMap`, `originalTemplateMap`, `hashes`, `dirtySet`, `pendingDeletions`. Sets `rootTemplateName`.

**`updateTemplate(name, partial)`** — merges partial, applies `applyFieldCascade`. Re-evaluates `dirtySet`: removes if result deeply equals `originalTemplateMap` baseline; adds if different. New templates (no original entry) always dirty.

**`addTemplate(template, existingHash = null)`** — adds to `templateMap`, `hashes`, `dirtySet`. `existingHash` is server hash for individually fetched templates; `null` for new unsaved.

**`injectTemplateGraph(templates)`** — injects `{ [name]: { template, hash } }` into `templateMap`, `originalTemplateMap`, `hashes`. Never overwrites existing entries. Does not touch `dirtySet`.

**`markForDeletion(name)`** — queues a **saved** template for deletion. Removes from `templateMap` and `dirtySet`; keeps in `originalTemplateMap` and `hashes`; adds to `pendingDeletions`. Do not call for new unsaved templates — use `removeTemplate`.

**`removeTemplate(name)`** — removes from all five maps atomically. For new unsaved templates and post-save cleanup only. Do not call for saved templates awaiting deletion — use `markForDeletion`.

**`reorderChild(parentTemplateName, fromIndex, toIndex)`** — splices child at `fromIndex` and inserts it at the adjusted position. No-op if the reorder would produce no change. Delegates to `updateTemplate` to mark dirty.

**`insertChild(parentTemplateName, child, atIndex)`** — inserts a new `ChildRef` at `atIndex` (clamped). Delegates to `updateTemplate` to mark dirty.

**`save(onRequiresConfirmation)`** — no-op if `isValid` false or nothing dirty. Builds `{ changes, deletions }`. On `STALE_TEMPLATE` or success: calls `loadRoot(rootTemplateName)` (rooted) or `_resetToIsolationMode()` (isolation).

**`confirmSave(batch)`** — resubmits with `confirmed: true`. Same post-save reset.

**`discard()`** — calls `loadRoot(rootTemplateName)` (rooted) or `_resetToIsolationMode()` (isolation).

**`setValidationState(state)`** — called by `useValidation` hook.

### `_resetToIsolationMode(get, set)` — private helper

Called by `save()`, `confirmSave()`, `discard()` when `rootTemplateName` is null.

1. Capture `selectedTemplateTree` from `useUIStore` **synchronously at position 0** before any `set()` or `await`.
2. Capture `isNewTemplate = selectedTemplate && !get().originalTemplateMap.has(selectedTemplate)` before the wipe.
3. Wipe `templateMap`, `originalTemplateMap`, `hashes`, `dirtySet`, `pendingDeletions` to empty.
4. If `!isNewTemplate` and `selectedTemplate` set: re-fetch subgraph via `loadRoot()` + `injectTemplateGraph()`.
5. If `isNewTemplate`: call `setSelectedTemplateTree(null)`.

---

## 7. `useUIStore`

- `selectedSystemTreeNode` — full dot-separated tree path (e.g. `"Plant1_System_A.RFPowerModule.RF_Fwd.setpoint"`). UI-only identity key, never sent to server.
- `setSelectedSystemTreeNode(ownPath, parentPath, assetName, parentTemplateName, childIndex)` — 5-argument setter. Sets all five fields and clears `selectedTemplateTree` atomically.
- Setting one selection type clears the other atomically (system tree vs template tree).
- `validationConfig` — `{ requiredParentTypes: [], uniqueParentTypes: false }`. Set by `AppShell` on mount via `GET /api/v1/config`.

### `useTagTypesStore` / `useModuleTypesStore`
- `useTagTypesStore` — stores `tagTypes` array and `displayNameMap` (type_name → display_name). Fetched on AppShell mount via `GET /api/v1/tag-types`.
- `useModuleTypesStore` — mirrors `useTagTypesStore`. Stores `moduleTypes` array and `displayNameMap` (type_name → display_name). Fetched on AppShell mount via `GET /api/v1/module-types`.

---

## 8. `useValidation` Hook

Runs `validateTemplate`, `validateGraph`, `validateParentTypes` synchronously on every `templateMap` change. No server call. No debounce. `EMPTY_BRANCH` declared in `constants.js` but not yet emitted by any validation function.

---

## 9. Component Notes

### `AssetTree` / `TreeNode`
- Expanded/collapsed state is **local** to each `TreeNode` via `useState`. Not lifted to `AssetTree` or any store.
- Root node initialises `useState(true)` (expanded); all child nodes initialise `useState(false)` (collapsed). Determined by `parentTemplateName === null` at mount time.
- Collapsing a parent unmounts its subtree (`{isExpanded && hasChildren && ...}`). Re-expanding remounts children fresh → always collapsed.
- `AssetTree` passes `key={rootTemplateName}` to the root `TreeNode`, ensuring a full remount (and state reset) whenever the selected root changes.
- Non-`tag` nodes are valid drop targets. `handleDrop` is async — reads parent template via `getState()` after `await` to avoid stale closure.
- Dirty nodes: `font-semibold text-orange-700`.
- **Drag-and-drop reorder:** Each non-root row is draggable. Three drop zones: top 8 px = insert before (sibling), bottom 8 px = insert after (sibling), body = add child (existing). Root nodes are body-only; tag nodes are top/bottom only. Cross-parent drops are blocked (`computeDropZone` returns `'none'` when `data.parentTemplateName !== parentTemplateName`). `onDragOver` cannot read `dataTransfer` values (HTML5 DnD security restriction) — uses module-level `getActiveDragData()` from `dragTypes.ts` instead. `onDrop` reads via `parseDragData(e)` which does have transfer access.

### `TemplatesTree`
- Leaf click: if template not in `templateMap`, fetches via `GET /api/v1/templates/root/:name` and injects via `injectTemplateGraph` before setting selection.
- Re-fetch trigger: `useEffect` on `dirtySet` and `pendingDeletions` — re-fetches only when **both** are empty (`dirtySet.size === 0 && pendingDeletions.size === 0`).
- Delete flow — `isNew` determined by `hashes.get(name) === null || undefined` (not by `originalTemplateMap`). New unsaved: `removeTemplate`. Saved: fetch hash first if missing, then `markForDeletion`.
- Drag source: `onDragStart` sets `application/json = { source: 'template-panel', templateName }` plus `text/plain` fallback; calls `setActiveDragData` from `dragTypes.ts`; `onDragEnd` calls `clearActiveDragData`.

### `FieldsPanel`
- Uses `selectionKey + setTimeout(0)` blank-tick pattern on every selection switch. Dependency array must be `[selectionKey]` — not the raw selection fields.
- **Template mode:** `template_type` is editable — rendered as `<input type="text" list="template-type-options">` with a `<datalist>` providing suggestions (`system`, `module`, `Group`, `parameter`, `tag`). Custom values are allowed. Changes call `updateTemplate(name, { template_type: newValue })` and participate in dirty tracking. The cell is highlighted orange bold when dirty. `template_type` in instance/system-tree mode remains read-only.
- **Template mode:** `data_type` (field_type `TagType`) and `is_setpoint` (field_type `Boolean`) are entries inside `fields{}`, rendered via the tag-types dropdown and boolean toggle respectively. `Module_Type` (field_type `ModuleType`) renders as a dropdown populated from `useModuleTypesStore`. Same pattern as `TagType` / `useTagTypesStore`.
- **Instance mode:** child lookup uses `children[selectedSystemTreeNodeChildIndex]` (index-based, not asset_name match).
- `isDirtyField` color: dirty → `font-semibold text-orange-700`; non-dirty override → `text-blue-600`; default → `text-gray-700`.
- `FieldTableRow` is a `<tr>`-based component local to `FieldsPanel.jsx`. Distinct from `FieldRow.jsx` (div/flex). `FieldRow` is not used inside `FieldsPanel`.

### `CascadeDiffContent`
Shared by `CascadeModal` and `CascadePreviewModal`. Props: `newTemplates`, `childrenChanged`, `childrenReordered`, `pendingDeletions`, `diff`, `affectedParents`. "No changes detected" shown only when all props empty. `childrenReordered` renders as "Children Reordered" section showing `new_order` as `A → B → C` joined string. `diff.template_type_changed` renders as "Template Type Changed" (yellow header) with `name: old → new` per entry.

### `RegistryPage`
- Fetches DB registry via `GET /api/v1/registry`, compares with `resolveRegistry()` using `diffRegistry()`.
- Layout: `h-full flex flex-col` outer container. Scrollable content area (`flex-1 min-h-0 overflow-auto`) wraps banners, diff bar, and table. `ValidationPanel` pinned to bottom via `flex-shrink-0` wrapper.
- `tag_id` shows `'new'` for added rows.
- Modified rows: changed cells `bg-amber-500/25`. Added rows: green. Retired rows: red.
- Update DB disabled when `isDirty` or no changes. Confirmation modal requires non-empty comment.
- If DB unavailable: amber warning banner, table displays proposed registry undiffed.
- Table layout: `w-auto table-auto` in `border border-black/30 rounded-sm w-fit` container.
- Columns: tag_id, tag_path, module, module_type, data_type, is_setpoint, trends, unit, format, eng_min, eng_max, meta. All columns except meta are sortable. `module_type` displays `display_name` from `useModuleTypesStore`, falling back to raw value. Display columns (`unit`, `format`, `eng_min`, `eng_max`) show `—` when null.
- Sort logic lives in `RegistryTable` via `useMemo` (not in `useRegistryStore`). The store only tracks `sortField` and `sortDirection`. `tag_id` uses numeric comparison (added rows with no tag_id sort to end); all other columns use string comparison.

### `MetaModalBody`
- Without `dbMeta`: renders meta array as level-by-level list (`meta[0]` = root, `meta[last]` = tag leaf).
- With `dbMeta` (diff mode): shows legend + per-field highlights (added → green, changed → amber, removed → line-through red).

### `AppShell`
- Fetches `GET /api/v1/config` on mount alongside template list. On failure: store retains `{ requiredParentTypes: [], uniqueParentTypes: false }` silently.
- Fetches `GET /api/v1/tag-types` and `GET /api/v1/module-types` on mount, populating `useTagTypesStore` and `useModuleTypesStore` respectively.
- `<main>` uses `overflow-hidden` (not `overflow-auto`) — individual pages manage their own scrolling.
- `_buildDiffEnrichment()` computes `new_templates`, `pending_deletions`, `children_changed`, `children_reordered` from store state for both `handleSeeChanges` and `handleSave`. Reorder detection uses ordered intersection: compares only children present in both original and current arrays to avoid false positives on add/remove.

### `EditorPage`
- Layout: `h-full flex flex-col` outer container. Tree panels row: `flex-1 min-h-0`. Each tree column (`AssetTree`, right panel) has `overflow-y-auto` for independent scrolling. `ValidationPanel` pinned to bottom via `flex-shrink-0` wrapper.

### `HistoryPage`
Columns: rev (right-aligned), applied_by, applied_at (`formatDateTime`), comment. Ordered DESC. Read-only.

---

## 10. `formatDate` Utility

`client/src/utils/formatDate.ts`:
- `formatDateTime(v)` → `'dd-MMM-yyyy HH:mm:ss'`
- `formatDate(v)` → `'dd-MMM-yyyy'`

Accepts `Date`, ISO string, PostgreSQL TIMESTAMPTZ string. Returns `'—'` for null/undefined/invalid.

---

## 11. Vite Config

```js
server: { proxy: { '/api': 'http://localhost:3001' } }
```

---

## 12. Seed Templates

All seed templates live directly in `templates/` (flat — no subdirectories).

### Tags
| File | Fields |
|---|---|
| `numeric_set.json` | `unit: { String, "" }`, `eng_min: { Numeric, 0.0 }`, `eng_max: { Numeric, 100.0 }` |
| `numeric_mon.json` | same as numeric_set |
| `boolean_set.json` | (none) |
| `boolean_mon.json` | (none) |

### Parameters
`analog_control.json` — fields: `description: { String, "" }`, `eng_min: { Numeric, 0.0 }`, `eng_max: { Numeric, 100.0 }`. Children: `numeric_set → "setpoint"`, `numeric_mon → "monitor"`, `boolean_set → "interlock_enable"`.

### Modules / Systems
`rf_power_module.json` — fields: `description: { String, "" }`. Children: two `analog_control` instances — `"RF_Fwd"` (`eng_max: 25`) and `"RF_Ref"` (defaults).

`Plant1_System_A.json` — `template_type: "module"`. Children: `rf_power_module → "RFPowerModule"` (`description: "Main RF power stage"`). This is the root template — select it from the root dropdown.

---

## 13. `@caro/db` Usage

`POST /api/v1/registry/apply` and the registry query routes use `@caro/db` named functions only. No raw SQL in app code. See `@caro/db` handoff for available functions.

---

## 14. TypeScript Migration

**Date:** 2026-04-06 — 2026-04-07. All three layers are TypeScript (`strict: true`, zero `tsc` errors).

- **Server:** 7 source files renamed `.js` → `.ts`; `tsconfig.json` added; `cors.d.ts` shim added; `dev` script uses `tsx` via nodemon; all 8 `__tests__/*.test.js` imports updated to `.ts`; `registryService.test.js` mock rewritten to target `getActiveTags`/`getRevisions`/`getRevisionTags` directly (old mock targeted `query()` which `registryService` no longer calls after `@caro/db` migration); **82 unit tests passing**
- **Client:** 35 source files renamed `.js`/`.jsx` → `.ts`/`.tsx`; `tsconfig.json` added; `vite.config.js` → `vite.config.ts`; all stores, hooks, API calls, and components fully typed using `ApiResponse<T>` from `@caro/ui`; all 7 `__tests__/*.test.js` mock paths updated; **112 unit tests passing**
- **Shared:** 10 source files renamed `.js` → `.ts`; `types.ts` added as centralized interface file; declaration shims (`index.d.ts`, `utils.d.ts`) deleted — replaced by compiled `dist/`; `resolve-js-to-ts` Vitest plugin added to server `vitest.config.js` — Vite does not follow NodeNext `.js`→`.ts` fallback, plugin redirects relative `.js` imports to `.ts` source when file exists; **125 unit tests passing**

---

## 15. E2E Tests

**Infrastructure (self-contained — no manual server startup required)**

`globalSetup.js` starts a dedicated test Express server on `:3099` and Vite client on `:5199` automatically before the suite runs. `globalTeardown.js` stops both after the suite. No manual server startup is required.

The test server connects to `caro_test` — a fresh clone of `caro_dev` created before every run via `pg_dump`/`pg_restore`. Set `TARGET_DB=caro_dev` to skip the clone and run against the live database.

`helpers/api.js` sets `API_BASE` to `:3099`. No spec file hardcodes a port or base URL.

**Run commands**

```bash
npm test                   # all browsers — clones caro_dev → caro_test first
npm run test:chromium      # Chromium only
npm run test:dev           # all browsers — skips clone, uses caro_dev directly
npm run test:chromium:dev  # Chromium only against caro_dev
```

**Baseline:** 207 tests passing across chromium, firefox, webkit (7.1 minutes), 0 failures.
