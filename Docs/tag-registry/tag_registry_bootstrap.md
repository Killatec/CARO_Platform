# Tag Registry Admin Tool — Bootstrap
**Updated:** 2026-10-17 (reconciled with the code)
Companion docs: `tag_registry_spec.md` | `tag_registry_api_spec.md` | `tag_registry_test_spec.md`

---

## 1. Folder Structure

```
apps/tag-registry/
  shared/                        pure-function TypeScript module (built to dist/; consumed as @caro/tag-registry-shared)
    index.ts                     public exports
    types.ts                     centralized interface file (all shared types)
    constants.ts                 ERROR_CODES, limits, type sets, UNIQUE_ANCESTOR_TYPES
    validateTemplate.ts
    validateGraph.ts
    validateParentTypes.ts
    validateResolvedTags.ts
    resolveRegistry.ts           resolveRegistry + resolveDisplayField
    simulateCascade.ts
    applyFieldCascade.ts
    hashTemplate.ts              hashTemplate (6-char SHA-1), hashTagDefs (SHA-256) — one canonicalJSON
    tagDefs.ts                   Tag Defs export builders (listMqttModuleTemplates, buildTagDefs, buildTagDefsFile, validateTagDefs)
    moduleOrder.ts               getModuleNames
    bitPacking.ts                packedBit / setPackedBit
    enums/moduleStatus.ts(.json) ModuleStatus / ModuleStatusLabels
    utils.ts                     deepEqual, deepNotEqual
  server/
    src/
      index.ts                   entry point: loadEnv, TEMPLATES_DIR check, DB ping + migrations, index build, app.listen
      app.ts                     Express app factory, router mount
      routes/
        templates.ts             /templates (list, get, root, batch, delete, validate)
        registry.ts              GET /registry, POST /registry/apply, GET /registry/revisions[/:rev]
        config.ts                GET /config
        tagTypes.ts              GET /tag-types
        moduleTypes.ts           GET /module-types
        tagDefs.ts               GET /tag-defs?root= — Tag Defs ZIP download
      services/
        templateService.ts       in-memory template index + file I/O
        registryService.ts       registry apply (resolve, classify, write)
        tagDefsService.ts        builds the Tag Defs ZIP (fflate) from saved templates
      types/cors.d.ts
  client/
    tailwind.config.js
    vite.config.ts               port 5173, proxy /api → :3001 (a duplicate vite.config.js with the same content also exists)
    vite.test.config.ts          E2E test client config
    src/
      main.tsx
      App.tsx
      api/                       config, templates, registry, tagTypes, moduleTypes, tagDefs — all via apiClient from @caro/ui/api/client (tagDefs uses raw fetch for the binary body)
      stores/
        useTemplateGraphStore.ts
        useRegistryStore.ts
        useUIStore.ts
        useTagTypesStore.ts
        useModuleTypesStore.ts
        useTreeExpandStore.ts    persisted expand/collapse state
      components/
        layout/   AppShell.tsx, Sidebar.tsx
        tree/     AssetTree.tsx, TreeNode.tsx
        panel/    TemplatesTree.tsx, FieldsPanel.tsx, FieldRow.tsx
        registry/ RegistryTable.tsx
        shared/   TagPathLabel, SeverityBadge, FieldValueRow, JsonViewer, TrashIcon, MetaModalBody,
                  CascadeModal, CascadePreviewModal, CascadeDiffContent, NewTemplateModal, AddFieldModal, ValidationPanel
      hooks/
        useValidation.ts
        useRootTemplate.ts
      utils/
        resolveTree.ts
        diffRegistry.ts
        registryRows.ts          row resolution/sort shared by RegistryTable and CSV export
        exportRegistryCsv.ts
        exportTree.ts
        dragTypes.ts             drag payload types + module-level active-drag tracker for HTML5 DnD
      pages/
        EditorPage.tsx
        RegistryPage.tsx
        HistoryPage.tsx
  e2e/
    tests/                       Playwright specs
    helpers/                     api.js, pageObjects.js
    globalSetup.js, globalTeardown.js, playwright.config.js
  scripts/migrate_field_types.js legacy flat-field → { field_type, default } converter
  templates/                     template JSON files (new ones are written flat; the scan is recursive)
```

---

## 2. Environment Variables

Loaded in two layers via `loadEnv()` from `@caro/server/env`: `apps/tag-registry/server/.env` (app-local) loads first and wins on a conflict; the monorepo root `.env` loads second, filling in only what's still unset. Never pass `override: true`.

Root `.env` (shared with mqtt-simulator and caro-hmi — see root `CLAUDE.md` and `.env.example`):

| Variable | Default | Required |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | No |
| `POSTGRES_PORT` | `5432` | No |
| `POSTGRES_DATABASE` | `caro_dev` | No |
| `POSTGRES_USER` | `postgres` | No |
| `POSTGRES_PASSWORD` | — | **Yes** |
| `PROJECT_ROOT` | — | Gates `POST /api/v1/registry/apply` — unset/empty refuses every apply, `*` allows any root |

App-local `server/.env` (see `server/.env.example`):

| Variable | Default | Required |
|---|---|---|
| `TEMPLATES_DIR` | — | **Yes** — the server exits on startup if it is unset |
| `PORT` | `3001` | No |
| `MAX_TAG_PATH_LENGTH` | `100` | No — only logged at startup; the applied limit is the constant in `shared/constants.ts` |
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
- Checks `template_name` and `template_type` are present and `template_name` ≤ 40 characters. It does **not** check for a dot in `template_name` (only the client's New Template dialog does), and there is no `INVALID_TEMPLATE_NAME` code.
- Children: `asset_name` non-empty, no dot (`INVALID_ASSET_NAME`), ≤ 40 characters, unique among siblings (`DUPLICATE_SIBLING_NAME`).

**`validateGraph(templateMap)`**
Returns `{ valid: bool, errors: [], warnings: [] }`.
Runs on the entire `templateMap`, not just the current root's subgraph. Checks broken references (`INVALID_REFERENCE`) and cycles (`CIRCULAR_REFERENCE`). Its duplicate-name check compares the keys of a `Map`, so it can never fire.

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
Returns `[{ tag_path, tag_name, module, module_type, data_type, is_setpoint, trends, unit, format, eng_min, eng_max, meta }]`.
- `tag_name` is the dot-joined `asset_name`s of meta levels where `In_Tag_Name === true`, root→leaf. `In_Tag_Name` is a reserved Boolean field seeded into all templates: true for `parameter` and `tag` types, false for others.
- First segment of every `tag_path` is `rootName` (not the literal string `'root'`).
- A tag whose `tag_path` is longer than `MAX_TAG_PATH_LENGTH` (100) is **skipped silently**: no error, absent from the result.
- References to missing templates are skipped silently.
- Extracts `.default` from field definitions before merging with instance overrides.
- `module` is the `asset_name` of the nearest ancestor with `template_type: "module"` (null if none). `module_type` is the `Module_Type` field value from that ancestor (null if none).
- Display columns `unit`, `format`, `eng_min`, `eng_max` are resolved by `resolveDisplayField` (see below). They are `null` for tags whose `data_type` is not in `TYPES_WITH_UNIT` (`shared/constants.ts`: `new Set(['f32', 'i16', 'i32', 'f32[]', 'i16[]'])`).

**`resolveDisplayField(fieldName, meta, assetPath)`** — path-aware display column resolver. Replaces the removed helpers `extractDottedFields` and `firstMatch`.
- Walks `meta[0]` → `meta[last]` (root-to-tag). At each level `i`, computes `relPath = assetPath.slice(i)` — the path segments from that level's node down to the tag.
- For each field key in `level.fields`: a plain key (`key === fieldName`) has specificity 0; a dotted key ending with `.fieldName` whose prefix segments are a leading subsequence of `relPath` has specificity equal to the number of prefix segments.
- **Root priority:** the first level with any match (specificity ≥ 0) wins — lower levels are not consulted. Within a level, the highest-specificity match wins.
- Meta levels hold only template field defaults merged with the direct `ChildRef.fields` for that instance. Dotted keys are never propagated down into child meta levels.

**`hashTemplate(template)`**
Returns 6-character hex SHA-1 string.

**`hashTagDefs(tags)`**
Returns full 64-character hex SHA-256 over the same canonical JSON as `hashTemplate` (keys sorted at every level, no whitespace). Input is the nested `tags` tree, so insertion order does not affect it. SHA-256 rather than truncated SHA-1 because the hash leaves the app for firmware-side comparison.

**`listMqttModuleTemplates(templateMap)`** / **`buildTagDefs(templateMap, moduleTemplateName)`** / **`buildTagDefsFile(templateMap, moduleTemplateName)`** — `tagDefs.ts`
Tag Defs export (spec §12.1). `listMqttModuleTemplates` returns `template_type: "module"` templates whose own `Module_Type` default is `MQTT_MODULE_TYPE`, code-unit sorted. `buildTagDefs` resolves the module template on its own via `resolveRegistry` (module as root) and returns a `TagDefGroup` tree nested by the module-relative name's segments (`meta.slice(1)` levels with `In_Tag_Name === true` — the module level is always skipped). Leaves are `{ data_type }` (`TAG_DEF_LEAF_KEY`), and nodes are prototype-less so a `__proto__` segment is an ordinary key. Keys are inserted in code-unit order, and it throws on a leaf-and-group or reserved-segment name. `validateTagDefs(templateMap, moduleTemplateName)` returns `TAG_NAME_EMPTY` / `DUPLICATE_TAG_NAME` / `TAG_NAME_LEAF_AND_GROUP` (both case-insensitive) / `TAG_NAME_RESERVED_SEGMENT` messages for those names; the server refuses the export on any. `buildTagDefsFile` wraps that as `{ _generated: TAG_DEFS_BANNER, template_name, content_hash: "sha256:<hashTagDefs(tags)>", tags }`.

**`validateResolvedTags(resolvedTags)`**
Returns `{ valid, errors, warnings }`. Post-resolution cross-field rules: `trends: true` only on `f32`, `i16`, `i32`, `bool`; `is_setpoint: true` only on scalar types; `TAG_NAME_EMPTY` (empty `tag_name`); `TAG_NAME_TOO_LONG` (>40 chars); `DUPLICATE_TAG_NAME` (case-insensitive duplicate within entire registry, one error per offending tag, empty names excluded). Called by `useValidation` after each `resolveRegistry`, by the server on registry apply, and by `POST /templates/validate`. Not called on batch save.

**`getModuleNames(tagMap)`**
Returns `string[]` — distinct `module_id` values from the tag map, sorted by each module's minimum `tag_id`. Used by `HmiTagSource` and `ModuleInfoTable` for consistent module index assignment.

**`packedBit(words, bitIndex)` / `setPackedBit(words, bitIndex, value)`**
LSB-first read/write of a single bit in a `number[]` word array (16 bits per word). Used for the `Module_Info.Watchdog` packed-bit indicator array.

**`ModuleStatus` / `ModuleStatusLabels`**
Const enum (`UNKNOWN=0`, `OK=1`, `WARNING=2`, `FAULT=3`, `STALLED=4`) and display-label map. Shared between `HmiTagSource` producer and `ModuleInfoTable` widget.

**`deepEqual(a, b)` / `deepNotEqual(a, b)`**
Recursive structural equality; object key order is ignored, array order is not.

---

## 4. API Client (`apiClient` from `@caro/ui/api/client`)

There is no local `api/client.ts`; every `client/src/api/*.ts` module uses the shared client in `packages/ui/src/api/client.ts`:

- Prepends `/api/v1` to all paths.
- Sets `Content-Type: application/json` on every request.
- GETs pass `cache: 'no-store'`.
- Unwraps the envelope: `ok: true` → returns `data`; `ok: false` → throws an `Error` whose `message` is the server message, with `.code` and `.details` set.
- Only `get`, `post` and `delete` exist. `api/tagDefs.ts` uses raw `fetch` because the success body is a ZIP.

---

## 5. Server

### Error Handling
- All async route handlers wrapped with `asyncWrap` from `@caro/server/asyncWrap`.
- `errorHandler` from `@caro/server/errorHandler` is the single Express error handler. It reads `err.status`, `err.code`, and `err.details` from thrown errors and formats the platform envelope.
- Services throw `Error` with `.code` and `.status` set at the throw site. Never call `res.status().json()` directly in error paths.
- `loadRoot` in `client/src/api/templates.ts` has a null guard for an empty template name.

### Template File I/O
- Each file write is atomic: write to `<file>.tmp` then rename over the target. A `*.json.tmp` left in `templates/` is a write that never reached its rename; the scan ignores it (two such files exist as of 2026-10-17).
- `templateService.ts` maintains the in-memory index `template_name → { file_path, hash, template }`. It is built once at startup by a recursive scan of `TEMPLATES_DIR` and updated on every write/delete by this server. Files changed on disk by anything else are not seen until restart. If two files share a `template_name`, the one scanned later replaces the other without a warning.
- `template_type` field in each JSON file is the source of truth.
- Batch writes are **not** all-or-nothing on disk. All hashes and lookups are validated first, so nothing is written for a rejected batch; but the files are then written one by one, and an I/O failure part-way leaves the earlier ones written.
- New templates are written to `{TEMPLATES_DIR}/{template_name}.json` — flat, no subdirectory routing. No `mkdir` required.

### `POST /api/v1/templates/batch` Processing Order
Accepts `{ changes, deletions, confirmed }`.
1. Validate all `original_hash` values for `changes` and `deletions`. Any mismatch → reject entire batch with `STALE_TEMPLATE`. `null` hash for an existing name → `TEMPLATE_NAME_CONFLICT`; unknown name → `TEMPLATE_NOT_FOUND`.
2. Check TagType/ModuleType field defaults against `tag_types` / `module_types` → 400 `SCHEMA_VALIDATION_ERROR` on an unknown value.
3. Build proposed set: current index + `changes` − `deletions`.
4. Run `validateGraph` on proposed set.
5. Run `simulateCascade` on `changes`.
6. If upstream impacts exist and `confirmed !== true` → return `requires_confirmation: true` with `diff` and `affectedParents`. No files written.
7. If `confirmed: true` or no upstream impacts → apply `applyFieldCascade`, write each changed file, unlink deleted files, update index. Return `{ requires_confirmation: false, modified_files, deleted_files }`.

`validateTemplate`, `validateResolvedTags` and `validateParentTypes` are not run.

Graph validation errors returned as `VALIDATION_ERROR` with codes in `details` array.

### `POST /api/v1/registry/apply` Flow
1. Load template graph server-side via `loadRoot()`.
2. Resolve via `resolveRegistry()`.
3. `validateResolvedTags()` — any error → 422 `SCHEMA_VALIDATION_ERROR` with the messages in `details`.
4. Classify against `getActiveTags()` from `@caro/db`, by `tag_path`.
5. Inside SERIALIZABLE transaction (`applyRegistryRevision`):
   - Insert `registry_revisions` row → get `registry_rev`.
   - For each added tag: insert `tag_registry` row, `retired=false`.
   - For each modified tag: insert new `tag_registry` row, `retired=false`.
   - For each retired tag: insert `tag_registry` row, `retired=true`.
   - Unchanged tags produce no inserts. New `tag_id`s start at max + 1 (floor 1000).
6. `applied_by` hardcoded to `'dev'`.
7. Returns `{ ok, registry_rev, added, modified, retired }` or `{ ok, registry_rev: null, message: 'No changes to apply' }` (no revision row is written in that case).

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

**`moveChild(fromParentTemplateName, fromIndex, toParentTemplateName, toIndex)`** — cross-parent move: removes the child from one parent's `children` and inserts it into another's at `toIndex` (clamped), via two `updateTemplate` calls. Same-parent calls are a no-op (those go through `reorderChild`).

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
- `validationConfig` — `{ requiredParentTypes: [], uniqueParentTypes: false, databaseName: '', projectRoot: null }`. Set by `AppShell` on mount via `GET /api/v1/config`. `databaseName`/`projectRoot` back the Registry/History connection indicator and `RegistryPage`'s `PROJECT_ROOT` apply gate.

### `useTagTypesStore` / `useModuleTypesStore`
- `useTagTypesStore` — stores `tagTypes` array and `displayNameMap` (type_name → display_name). Fetched on AppShell mount via `GET /api/v1/tag-types`.
- `useModuleTypesStore` — mirrors `useTagTypesStore`. Stores `moduleTypes` array and `displayNameMap` (type_name → display_name). Fetched on AppShell mount via `GET /api/v1/module-types`.

---

## 8. `useValidation` Hook

Runs `validateTemplate`, `validateGraph`, `validateParentTypes`, and `validateResolvedTags` synchronously on every `templateMap` change. `validateResolvedTags` is called after `resolveRegistry` to enforce cross-field constraints (trendable types, array setpoints). No server call. No debounce. `EMPTY_BRANCH` declared in `constants.ts` but not yet emitted by any validation function.

---

## 9. Component Notes

### `AssetTree` / `TreeNode`
- System Tree header is `flex items-center justify-between`. A `↓` Export button sits on the right; it renders only when `rootTemplateName` is non-null. `onClick` calls `exportTree(templateMap, rootTemplateName)`, serializes to JSON, and triggers a browser download of `{rootTemplateName}_tree.json` via the anchor-click-revoke pattern (no external libs).
- Expanded/collapsed state is persisted via `useTreeExpandStore` (Zustand + `persist` middleware, key `caro.tag-registry.tree-expand`). On first visit (no stored state), the root node starts expanded and all children start collapsed. On subsequent visits, the store restores the previous expand/collapse state per node.
- Collapsing a parent unmounts its subtree (`{isExpanded && hasChildren && ...}`). Re-expanding remounts children with their stored state.
- `AssetTree` passes `key={rootTemplateName}` to the root `TreeNode`. Switching roots remounts the tree, but the store retains state for each root independently so a previously visited root reopens at its last state.
- Non-`tag` nodes are valid drop targets. `handleDrop` is async — reads parent template via `getState()` after `await` to avoid stale closure.
- Dirty nodes: `font-semibold italic text-gray-800` (bold italic gray). Validation error path: `border-l-4 border-red-500 bg-red-50`; warning path: `border-l-4 border-yellow-400 bg-yellow-50`. Selection (`border-l-4 border-blue-600 bg-blue-50`) takes visual priority over tinting.
- **Drag-and-drop reorder:** Each non-root row is draggable. Three drop zones: top 8 px = insert before (sibling), bottom 8 px = insert after (sibling), body = add child (existing). Root nodes are body-only; tag nodes are top/bottom only. Cross-parent drops are allowed: top/bottom into a different parent call `moveChild`, the body zone nests into the hovered node, and same-parent top/bottom calls `reorderChild`. `computeDropZone` returns `'none'` only for no-op positions and cycle-creating targets. `onDragOver` cannot read `dataTransfer` values (HTML5 DnD security restriction) — uses module-level `getActiveDragData()` from `dragTypes.ts` instead. `onDrop` reads via `parseDragData(e)` which does have transfer access.

### `TemplatesTree`
- Leaf click: if template not in `templateMap`, fetches via `GET /api/v1/templates/root/:name` and injects via `injectTemplateGraph` before setting selection.
- Re-fetch trigger: `useEffect` on `dirtySet` and `pendingDeletions` — re-fetches only when **both** are empty (`dirtySet.size === 0 && pendingDeletions.size === 0`).
- Delete flow — `isNew` determined by `hashes.get(name) === null || undefined` (not by `originalTemplateMap`). New unsaved: `removeTemplate`. Saved: fetch hash first if missing, then `markForDeletion`.
- Drag source: `onDragStart` sets `application/json = { source: 'template-panel', templateName }` plus `text/plain` fallback; calls `setActiveDragData` from `dragTypes.ts`; `onDragEnd` calls `clearActiveDragData`.

### `FieldsPanel`
- Uses `selectionKey + setTimeout(0)` blank-tick pattern on every selection switch. Dependency array must be `[selectionKey]` — not the raw selection fields.
- **Template mode:** `template_type` is editable — rendered as `<input type="text" list="template-type-options">` with a `<datalist>` providing suggestions (`system`, `module`, `Group`, `parameter`, `tag`). Custom values are allowed. Changes call `updateTemplate(name, { template_type: newValue })` and participate in dirty tracking. The cell is highlighted bold italic gray when dirty. `template_type` in instance/system-tree mode remains read-only.
- **Template mode:** `data_type` (field_type `TagType`) and `is_setpoint` (field_type `Boolean`) are entries inside `fields{}`, rendered via the tag-types dropdown and boolean toggle respectively. `Module_Type` (field_type `ModuleType`) renders as a dropdown populated from `useModuleTypesStore`. Same pattern as `TagType` / `useTagTypesStore`.
- **Instance mode:** child lookup uses `children[selectedSystemTreeNodeChildIndex]` (index-based, not asset_name match).
- `isDirtyField` color: dirty → `font-semibold italic text-gray-700`; non-dirty override → `text-blue-600`; default → `text-gray-700`.
- `FieldTableRow` is a `<tr>`-based component local to `FieldsPanel.tsx`. Distinct from `FieldRow.tsx` (div/flex). `FieldRow` is not used inside `FieldsPanel`.

### `CascadeDiffContent`
Shared by `CascadeModal` and `CascadePreviewModal`. Props: `newTemplates`, `childrenChanged`, `childrenReordered`, `pendingDeletions`, `diff`, `affectedParents`. "No changes detected" shown only when all props empty. `childrenReordered` renders as "Children Reordered" section showing `new_order` as `A → B → C` joined string. `diff.template_type_changed` renders as "Template Type Changed" (yellow header) with `name: old → new` per entry.

### `RegistryPage`
- Fetches DB registry via `GET /api/v1/registry`, compares with `resolveRegistry()` using `diffRegistry()`.
- Top-level structure: an always-visible `connectionIndicator` strip (`DB: <databaseName>` / `PROJECT_ROOT: <projectRoot ?? '(not configured)'>`, `data-testid="db-connection-indicator"`), then a `mainContent` variable holding whichever body applies (no-root prompt / validation-error banner / the diffed table), rendered inside a `flex-1 min-h-0 overflow-hidden` wrapper below the indicator. The indicator sits outside all three body branches so it shows regardless of root selection or validity — this is a deliberate restructure, not an incidental one, since the three bodies used to be direct early `return`s.
- Layout inside `mainContent`'s table branch: `h-full flex flex-col` container. Scrollable content area (`flex-1 min-h-0 overflow-auto`) wraps banners, diff bar, and table. `ValidationPanel` pinned to bottom via `flex-shrink-0` wrapper.
- `tag_id` shows `'new'` for added rows.
- Modified rows: changed cells `bg-amber-500/25`. Added rows: green. Retired rows: red.
- Update DB disabled when `isDirty`, when there are no changes, **or** when the selected root doesn't match `validationConfig.projectRoot` (`rootMatchesProject = projectRoot !== null && (projectRoot === '*' || projectRoot === rootTemplateName)` — `null` never matches, so an unconfigured `PROJECT_ROOT` always disables the button). Tooltip branches: dirty → save/discard message; mismatch → names both the configured `PROJECT_ROOT` and the selected root; unconfigured → states apply is disabled until it's set; otherwise `undefined`. Confirmation modal requires non-empty comment.
- If DB unavailable: amber warning banner, table displays proposed registry undiffed.
- Table layout: `w-auto table-auto` in `border border-black/30 rounded-sm w-fit` container.
- Columns: tag_id, tag_path, tag_name, module, module_type, data_type, is_setpoint, trends, unit, format, eng_min, eng_max, meta. All columns except meta are sortable. `module_type` displays `display_name` from `useModuleTypesStore`, falling back to raw value. Display columns (`unit`, `format`, `eng_min`, `eng_max`) show `—` when null.
- Sort logic lives in `RegistryTable` via `useMemo` (not in `useRegistryStore`). The store only tracks `sortField` and `sortDirection`. `tag_id` uses numeric comparison (added rows with no tag_id sort to end); all other columns use string comparison.

### `MetaModalBody`
- Without `dbMeta`: renders meta array as level-by-level list (`meta[0]` = root, `meta[last]` = tag leaf).
- With `dbMeta` (diff mode): shows legend + per-field highlights (added → green, changed → amber, removed → line-through red).

### `AppShell`
- Fetches `GET /api/v1/config` on mount alongside template list. On failure: store retains `{ requiredParentTypes: [], uniqueParentTypes: false, databaseName: '', projectRoot: null }` silently.
- Fetches `GET /api/v1/tag-types` and `GET /api/v1/module-types` on mount, populating `useTagTypesStore` and `useModuleTypesStore` respectively.
- `<main>` uses `overflow-hidden` (not `overflow-auto`) — individual pages manage their own scrolling.
- `_buildDiffEnrichment()` computes `new_templates`, `pending_deletions`, `children_changed`, `children_reordered` from store state for both `handleSeeChanges` and `handleSave`. Reorder detection uses ordered intersection: compares only children present in both original and current arrays to avoid false positives on add/remove.

### `EditorPage`
- Layout: `h-full flex flex-col` outer container. Tree panels row (`flex-1 min-h-0`): three independent columns — System Tree (`AssetTree`), Properties (`FieldsPanel`), Templates (`TemplatesTree`) — each `overflow-y-auto`. `ValidationPanel` pinned below all three columns as a full-width bar via `flex-shrink-0` wrapper. Panel is `max-h-[50vh]`; header is `flex-shrink-0`; message list is `overflow-y-auto`.
- `pathSeverityMap` — computed via `useMemo` from `validationState.messages`; splits each `msg.ref.tag_path` by `.` and maps every prefix to worst severity; passed as prop through `AssetTree → TreeNode` for tinting.

### `HistoryPage`
Columns: rev (right-aligned), applied_by, applied_at (`formatDateTime`), comment. Ordered DESC. Read-only. Same connection indicator as `RegistryPage` (`DB: <databaseName>` / `PROJECT_ROOT: <projectRoot>`) rendered at the top, unconditionally — no early returns to work around here, unlike `RegistryPage`.

---

## 10. Date Formatting

There is no local `formatDate.ts`; the client uses `@caro/ui` (`packages/ui/src/dateFormat.ts`):
- `formatDateTime(v, opts?)` → `'dd-MMM-yyyy HH:mm:ss'` (seconds optional, browser-local time unless `opts.timezone`)
- `formatDate(v, opts?)` → `'dd-MMM-yyyy'`

Accepts `Date`, ISO/TIMESTAMPTZ string, number or bigint ms. Returns `'—'` (or `opts.fallback`) for null/undefined/invalid.

---

## 11. Vite Config

```ts
server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:3001' } }
```

`client/vite.config.js` duplicates `vite.config.ts` with identical content today; a change to one must be made to both (or one removed). The E2E client is started with `--config vite.test.config.ts`.

---

## 12. Templates in the Repo

`templates/` holds the project templates, not a fictional seed set: 59 files as of 2026-10-17, all flat at the top level.
- **System templates** (the only ones the root dropdown offers): `CARO_1` and `Narya1`.
- **Module templates:** `Beam_Control`, `Cooling`, `Narya_RF`, `Pole`, `Power_Control`, `RF_Control` (`Module_Type: MQTT`) and `HMI` (`Module_Type: HMI`).
- **Other template types:** `tag`, `parameter`, `Group`, plus project-specific types (`RF`, `Power`, `Beam`, `Cooling`, `Scan`, `Power_Supply`, `interlock`, `HMI`).
- **Generic tag templates:** `numeric_set`, `numeric_mon`, `boolean_set`, `boolean_mon` and others. Each carries `In_Tag_Name`, `data_type`, `is_setpoint` and `Trends`; `numeric_set` and `numeric_mon` add `format`, `unit`, `eng_min` and `eng_max`.

The earlier `Plant1_System_A` / `rf_power_module` / `analog_control` seed set no longer exists. `db/postgres/seeds/dev_seed.sql` still references `Plant1_System_A` (see `Docs/platform/multi_project_runbook.md` §6.6).

---

## 13. `@caro/db` Usage

`POST /api/v1/registry/apply` and the registry query routes use `@caro/db` named functions only. No raw SQL in app code. See `@caro/db` handoff for available functions.

---

## 14. E2E Tests

**Infrastructure (self-contained — no manual server startup required)**

`globalSetup.js` starts a dedicated test Express server on `:3099` and Vite client on `:5199` automatically before the suite runs. `globalTeardown.js` stops both after the suite. No manual server startup is required.

The test server connects to `caro_test` — a fresh clone of the project database (ambient `POSTGRES_DATABASE`, else the root `.env`'s, else `caro_dev`) created before every run via `pg_dump`/`pg_restore`. It runs with `PROJECT_ROOT: '*'`. Set `TARGET_DB=caro_dev` to skip the clone and run against the live database.

`helpers/api.js` sets `API_BASE` to `:3099`. No spec file hardcodes a port or base URL.

**Run commands**

```bash
npm test                   # all browsers — clones the project DB → caro_test first
npm run test:chromium      # Chromium only
npm run test:dev           # all browsers — skips clone, uses caro_dev directly
npm run test:chromium:dev  # Chromium only against caro_dev
```

**Baseline:** see `tag_registry_test_spec.md` §9 (current: 92 Chromium E2E; Firefox/WebKit are not installed on the dev machine).
