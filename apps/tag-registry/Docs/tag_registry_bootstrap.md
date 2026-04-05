# Tag Registry Admin Tool — Bootstrap
**v1.21** | **Updated:** 2026-04-05
Companion docs: `tag_registry_spec.md` | `tag_registry_api_spec.md` | `tag_registry_test_spec.md`

---

## 1. Folder Structure

```
apps/tag-registry/
  Docs/
  shared/                        local pure-function module (NOT a workspace package)
    package.json                 { "type": "module" } only
    index.js
    validateTemplate.js
    validateGraph.js
    simulateCascade.js
    applyFieldCascade.js
    validateParentTypes.js
    resolveRegistry.js
    constants.js
    hashTemplate.js
    utils.js                     deepEqual, deepNotEqual
  server/
    package.json
    src/
      index.js                   entry point, env validation, app.listen
      app.js                     Express app factory, router mount
      routes/
        templates.js
        registry.js              GET /registry, POST /apply, GET /revisions
      services/
        templateService.js
        registryService.js
  client/
    package.json
    tailwind.config.js           extends @caro/ui/tailwind.config.js
    vite.config.js               proxy /api → :3001
    index.html
    src/
      main.jsx
      App.jsx
      api/
        client.js
        templates.js
        registry.js
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
          TagPathLabel.jsx
          SeverityBadge.jsx
          FieldValueRow.jsx
          JsonViewer.jsx
          TrashIcon.jsx
          MetaModalBody.jsx
          CascadeModal.jsx
          CascadePreviewModal.jsx
          CascadeDiffContent.jsx
          NewTemplateModal.jsx
          AddFieldModal.jsx
          ValidationPanel.jsx
      hooks/
        useValidation.js
        useRootTemplate.js
      utils/
        resolveTree.js
        diffRegistry.js
        formatDate.js
      pages/
        EditorPage.jsx
        RegistryPage.jsx
        HistoryPage.jsx
  e2e/
    tests/
    helpers/
      api.js
      pageObjects.js
    playwright.config.js
  templates/
    tags/
    parameters/
    modules/
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
- Each field in `template.fields` must be `{ field_type, default }`. `field_type` ∈ `{ "Numeric", "String", "Boolean" }`. `typeof default` must match.
- `data_type` and `is_setpoint` are **top-level** template properties — never inside `fields{}`.
- `template_name` must not contain a dot (`INVALID_TEMPLATE_NAME`).

**`validateGraph(templateMap)`**
Returns `{ valid: bool, errors: [], warnings: [] }`.
Runs on the entire `templateMap`, not just the current root's subgraph.

**`simulateCascade(currentTemplateMap, proposedChanges, originalTemplateMap?)`**
Returns `{ requiresConfirmation: bool, diff: { fields_added, fields_removed, fields_changed, instance_fields_changed }, affectedParents: [{ parent_template_name, asset_name, dropped_instance_values }] }`.
- `affectedParents` is per-instance, not per-template.
- `fields_changed` reports `.default` scalar values, not full definition objects.

**`applyFieldCascade(templateMap, changedTemplate)`**
Returns updated `templateMap`. Pure — does not mutate input.

**`validateParentTypes(templateMap, rootName, options)`**
Returns `{ errors: [], warnings: [] }`.
Options: `{ requiredParentTypes: string[], uniqueParentTypes: boolean }`.

**`resolveRegistry(templateMap, rootName)`**
Returns `[{ tag_path, data_type, is_setpoint, meta }]`.
- First segment of every `tag_path` is `rootName` (not the literal string `'root'`).
- Extracts `.default` from field definitions before merging with instance overrides.

**`hashTemplate(template)`**
Returns 6-character hex SHA-1 string.

**`deepEqual(a, b)` / `deepNotEqual(a, b)`**
JSON.stringify-based deep equality.

---

## 4. API Client (`api/client.js`)

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
- `template_type` field in each JSON file is the source of truth. Subfolders are browsing convenience only.
- Batch writes are all-or-nothing: validate all hashes first, then write all changed files, then unlink deleted files, then update index.
- `batchSave` does not call `mkdir({ recursive: true })`. Subdirectories (`tags/`, `parameters/`, `modules/`) must already exist.

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
"dev": "nodemon --ext js,json --watch src src/index.js"
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

---

## 8. `useValidation` Hook

Runs `validateTemplate`, `validateGraph`, `validateParentTypes` synchronously on every `templateMap` change. No server call. No debounce. `EMPTY_BRANCH` declared in `constants.js` but not yet emitted by any validation function.

---

## 9. Component Notes

### `AssetTree` / `TreeNode`
- Collapse state lifted to `AssetTree` as `expandedNodes: Map<ownPath, bool>`. Resets to `{}` on `rootTemplateName` change.
- **Collapse toggle:** `prev[ownPath] !== false ? false : true` — not `!prev[ownPath]`. `undefined` (initial expanded) must transition to `false` (collapsed) on first click.
- Non-`tag` nodes are valid drop targets. `handleDrop` is async — reads parent template via `getState()` after `await` to avoid stale closure.
- Dirty nodes: `font-semibold text-orange-700`.

### `TemplatesTree`
- Leaf click: if template not in `templateMap`, fetches via `GET /api/v1/templates/root/:name` and injects via `injectTemplateGraph` before setting selection.
- Re-fetch trigger: `useEffect` on `dirtySet` and `pendingDeletions` — re-fetches only when **both** are empty (`dirtySet.size === 0 && pendingDeletions.size === 0`).
- Delete flow — `isNew` determined by `hashes.get(name) === null || undefined` (not by `originalTemplateMap`). New unsaved: `removeTemplate`. Saved: fetch hash first if missing, then `markForDeletion`.
- Drag source: `onDragStart` sets `text/plain = template_name`.

### `FieldsPanel`
- Uses `selectionKey + setTimeout(0)` blank-tick pattern on every selection switch. Dependency array must be `[selectionKey]` — not the raw selection fields.
- **Template mode:** `data_type` and `is_setpoint` are top-level — never inside `fields{}`.
- **Instance mode:** child lookup uses `children[selectedSystemTreeNodeChildIndex]` (index-based, not asset_name match).
- `isDirtyField` color: dirty → `font-semibold text-orange-700`; non-dirty override → `text-blue-600`; default → `text-gray-700`.
- `FieldTableRow` is a `<tr>`-based component local to `FieldsPanel.jsx`. Distinct from `FieldRow.jsx` (div/flex). `FieldRow` is not used inside `FieldsPanel`.

### `CascadeDiffContent`
Shared by `CascadeModal` and `CascadePreviewModal`. Props: `newTemplates`, `childrenChanged`, `pendingDeletions`, `diff`, `affectedParents`. "No changes detected" shown only when all props empty.

### `RegistryPage`
- Fetches DB registry via `GET /api/v1/registry`, compares with `resolveRegistry()` using `diffRegistry()`.
- `tag_id` shows `'new'` for added rows.
- Modified rows: changed cells `bg-amber-500/25`. Added rows: green. Retired rows: red.
- Update DB disabled when `isDirty` or no changes. Confirmation modal requires non-empty comment.
- If DB unavailable: amber warning banner, table displays proposed registry undiffed.
- Table layout: `w-auto table-auto` in `border border-black/30 rounded-sm w-fit` container.

### `MetaModalBody`
- Without `dbMeta`: renders meta array as level-by-level list (`meta[0]` = root, `meta[last]` = tag leaf).
- With `dbMeta` (diff mode): shows legend + per-field highlights (added → green, changed → amber, removed → line-through red).

### `AppShell`
- Fetches `GET /api/v1/config` on mount alongside template list. On failure: store retains `{ requiredParentTypes: [], uniqueParentTypes: false }` silently.
- `_buildDiffEnrichment()` computes `new_templates`, `pending_deletions`, `children_changed` from store state for both `handleSeeChanges` and `handleSave`.

### `HistoryPage`
Columns: rev (right-aligned), applied_by, applied_at (`formatDateTime`), comment. Ordered DESC. Read-only.

---

## 10. `formatDate` Utility

`client/src/utils/formatDate.js`:
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

### Tags (`templates/tags/`)
| File | Fields |
|---|---|
| `numeric_set.json` | `unit: { String, "" }`, `eng_min: { Numeric, 0.0 }`, `eng_max: { Numeric, 100.0 }` |
| `numeric_mon.json` | same as numeric_set |
| `boolean_set.json` | (none) |
| `boolean_mon.json` | (none) |

### Parameters (`templates/parameters/`)
`analog_control.json` — fields: `description: { String, "" }`, `eng_min: { Numeric, 0.0 }`, `eng_max: { Numeric, 100.0 }`. Children: `numeric_set → "setpoint"`, `numeric_mon → "monitor"`, `boolean_set → "interlock_enable"`.

### Modules (`templates/modules/`)
`rf_power_module.json` — fields: `description: { String, "" }`. Children: two `analog_control` instances — `"RF_Fwd"` (`eng_max: 25`) and `"RF_Ref"` (defaults).

`Plant1_System_A.json` — `template_type: "module"`. Children: `rf_power_module → "RFPowerModule"` (`description: "Main RF power stage"`). This is the root template — select it from the root dropdown.

---

## 13. `@caro/db` Usage

`POST /api/v1/registry/apply` and the registry query routes use `@caro/db` named functions only. No raw SQL in app code. See `@caro/db` handoff for available functions.
