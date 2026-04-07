# Tag Registry Admin Tool — Functional Specification
**Draft v1.17** | Generated: 2026-04-02
Companion documents: [Bootstrap v1.21](tag_registry_bootstrap.md) | [API Spec v1.15](tag_registry_api_spec.md)

---

## 1. Glossary

| Term | Definition |
|------|------------|
| template | A JSON file defining an asset — its fields and, for structural templates, its children. |
| template_type | A user-defined classification for a template. The `template_type` field in the JSON file is the source of truth. |
| structural template | Any template that may contain children. All template types except `tag` are structural templates and behave identically. |
| tag template | A leaf template defining a single data point. No children. Carries a `data_type`, an `is_setpoint` boolean flag, and tag-level fields. |
| asset_name | The name assigned to a child template instance within a parent template. |
| root template | The template selected by the user as the starting point for tree resolution and registry generation. Any template type may serve as the root. |
| template graph | The full set of templates reachable from the selected root, held in client memory after a load-root fetch. Used for local cascade simulation and validation. |
| template hash | A short content hash (SHA-1 of canonical JSON) assigned to each template by the server. Used to detect staleness at batch save time. |
| tag_path | The canonical runtime address of a tag. Always begins with the root template's `template_name` (used as its asset_name) followed by a dot, then the dot-joined chain of `asset_name`s down to the tag leaf. Example: `Plant1_System_A.RFPowerModule.ForwardPower.setpoint` |
| tag_id | A stable numeric identifier assigned to a tag at its first registry generation. Stored only in the database. |
| registry generation | The process of resolving the selected root template hierarchy into a flat tag list and writing the result to the database. |
| retired tag | A tag that exists in the database but whose tag_path is no longer present in the resolved hierarchy. |

---

## 2. Purpose

This document describes the complete Tag Registry Admin Tool system across all phases. The Bootstrap Document governs what is implemented in Phase 1 and what is deferred to Phase 2.

The tool enables engineers to:

- Define reusable asset templates at every level of a user-defined hierarchy.
- Compose those templates into asset hierarchies.
- Generate the final tag registry for a selected root template, consumed by the HMI and backend runtime services.

**Design philosophy:** Every asset is defined by a template. A root template is simply whichever template the user selects from the global root dropdown. All template types are user-defined and treated uniformly.

The tool enables engineers to build hierarchical tag structures with instant local feedback. All cascade simulation and validation runs client-side against a locally held template graph, using shared pure functions from `apps/tag-registry/shared/`. The server re-runs the same logic authoritatively on batch save.

---

## 3. Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React (web application) |
| Backend | Node.js / Express |
| Database | PostgreSQL |
| Template storage | JSON files on disk, optionally organised into subfolders by template_type |
| Shared validation | `apps/tag-registry/shared/` — environment-agnostic module consumed by both server and client |
| Source control | Git (recommended for template JSON files) |

---

## 4. High-Level Architecture

The system is organised around two artifacts:

- A `templates/` folder containing one JSON file per template. The `template_type` field is the source of truth; subfolders are optional and for navigation only.
- A PostgreSQL database storing the generated tag registry and revision history.

The HMI and backend runtime services read only the tag registry from the database.

### 4.1 Atomicity Guarantee

All mutating operations are fully atomic. All file writes and database writes for a given operation are applied together. On any failure, the operation is rolled back and the system remains unchanged.

### 4.2 Shared Validation Module

Validation and cascade simulation logic lives in `apps/tag-registry/shared/`. Both the server and client import from this directory via relative paths. The module must be environment-agnostic: no `fs`, no Express, no DOM. Pure functions only.

The shared module exports:

- `validateTemplate(template)` — schema conformance, field rules, `asset_name` rules for a single template. Each field in `template.fields` must be `{ field_type, default }` where `field_type` is one of `"Numeric" | "String" | "Boolean"` and `default` matches the corresponding JS type.
- `validateGraph(templates)` — circular references, broken references, duplicate template names across the full map.
- `simulateCascade(currentTemplateMap, proposedChanges, originalTemplateMap?)` — computes field-level diffs, dropped instance values, and the list of affected parent templates given a proposed set of changes.
- `applyFieldCascade(templateMap, changedTemplate)` — given a template that has changed, propagates the effect to all child instances in the map. Returns an updated `templateMap`. Pure function — does not mutate its input.
- `validateParentTypes(templateMap, rootName, options)` — evaluates `VALIDATE_REQUIRED_PARENT_TYPES` and `VALIDATE_UNIQUE_PARENT_TYPES` rules. Returns `{ errors: [], warnings: [] }`.
- `resolveRegistry(templateMap, rootName)` — resolves the full hierarchy into a flat tag list with `tag_path`, `data_type`, `is_setpoint`, `trends`, and `meta`. Pure function. Extracts `.default` from each field definition before merging with instance overrides. The `trends` field is `true` if any level in the resolved hierarchy has a field key matching `"trends"` (case-insensitive) with value `true` after instance override resolution, `false` otherwise. The `meta` array is ordered root-to-tag: `meta[0]` is the root level entry, `meta[meta.length - 1]` is the tag-level entry.
- `constants` — error codes, `DATA_TYPES` enum, `MAX_TAG_PATH_LENGTH` default.
- `deepEqual(a, b)` / `deepNotEqual(a, b)` — JSON-serialization-based deep equality utilities (`utils.js`).

### 4.3 Client-Side Template Graph

When the user selects a root template, the client calls `GET /api/v1/templates/root/:template_name`. The server returns a flat map of every template reachable from that root, each with its full JSON and a content hash. This map is held in `useTemplateGraphStore` for the duration of the session.

Templates can also be injected into the graph on demand (without selecting a root) when the user clicks a template leaf in the TemplatesTree or drops a template onto a System Tree node. In this case the same `loadRoot` endpoint is used to fetch the full subgraph for the clicked template, and the result is injected via `injectTemplateGraph`. This enables editing individual templates without loading a full hierarchy.

New templates created by the user exist only in the client graph until batch save. They carry a `null` hash, which the server interprets as an assertion that the name is new.

The client performs all cascade simulation locally against this graph using `simulateCascade`. No server call is made during editing.

---

## 5. Workflows

### 5.1 Batch Save Flow

When the user clicks Save and the ValidationPanel shows no errors or warnings, the client submits a `POST /api/v1/templates/batch` request containing:
- All modified and newly created templates (`changes`) with their original hashes.
- All templates queued for pending deletion (`deletions`) with their original hashes.

The server:

- Checks every `original_hash` against the current file for both `changes` and `deletions`. Any mismatch rejects the entire batch with `STALE_TEMPLATE`. Client re-fetches the full root hierarchy and discards local changes.
- Builds the proposed template set: current on-disk templates + `changes` − `deletions`.
- Runs `validateGraph` on the proposed set. `INVALID_REFERENCE` surfaces naturally if any remaining template references a deleted one.
- Scans for upstream parents — templates outside the submitted batch that reference any of the changed templates. If any are found and `confirmed` is not `true`, returns a `requires_confirmation` response with a diff and `affectedParents` list. No files written.
- If `confirmed: true` or no upstream impacts: writes all changed files atomically (cascade updates applied), unlinks deleted template files, updates the in-memory index. Returns `{ modified_files, deleted_files }`.

### 5.2 Pending Deletion Flow

Template deletions are client-side pending operations, not immediate server calls. When the user clicks the trash icon on a saved template in the TemplatesTree:

1. The template is removed from `templateMap` immediately (tree and validation reflect the deletion).
2. The template is added to `pendingDeletions` in the store (`markForDeletion`).
3. `originalTemplateMap` and `hashes` are preserved — needed to send the correct `original_hash` on Save.
4. The Save bar appears (`isDirty` is true when `pendingDeletions.size > 0`).
5. On Save, the batch request includes the `deletions` array. The server deletes the files atomically alongside any other changes.
6. On Cancel/Discard, `pendingDeletions` is cleared and the template reappears in the tree after re-fetch.

New unsaved templates (null hash) are deleted instantly client-side via `removeTemplate` with no server call and no pending state.

---

## 6. Data Types

| Value | Description |
|-------|-------------|
| `f64` | 64-bit IEEE 754 floating-point |
| `i32` | 32-bit signed integer |
| `bool` | Boolean |
| `str` | UTF-8 string |

---

## 7. Template JSON Schema

### 7.1 Field Definitions

Fields are stored as structured objects:

```json
{
  "fields": {
    "eng_min":     { "field_type": "Numeric", "default": 0.0 },
    "description": { "field_type": "String",  "default": "" },
    "enabled":     { "field_type": "Boolean", "default": false }
  }
}
```

`field_type` is always one of: `"Numeric"` | `"String"` | `"Boolean"`. The `default` value must be the correct JS type (number, string, boolean).

Instance override values (`child.fields`) remain raw values — the `field_type` is always read from the underlying template definition, never from an override.

Migration script: `apps/tag-registry/scripts/migrate_field_types.js` converts the legacy flat-value format.

### 7.2 Structural Template

```json
{
  "template_type": "module",
  "template_name": "rf_power_module",
  "fields": {
    "description": { "field_type": "String", "default": "" }
  },
  "children": [
    {
      "template_name": "analog_control",
      "asset_name":    "RF_Fwd",
      "fields": {
        "description": "Forward RF power channel",
        "eng_max":     25
      }
    }
  ]
}
```

### 7.3 Tag Template

```json
{
  "template_type": "tag",
  "template_name": "numeric_set",
  "fields": {
    "unit":    { "field_type": "String",  "default": "" },
    "eng_min": { "field_type": "Numeric", "default": 0.0 },
    "eng_max": { "field_type": "Numeric", "default": 100.0 }
  }
}
```

---

## 8. Examples (Seed Data)

See Bootstrap document section 7 for full seed template file specifications.

---

## 9. Tag Identification and Addressing

### 9.1 tag_path Construction

The `tag_path` is the canonical runtime address of a tag. The first segment is the root template's `template_name`, which serves as its own asset_name since the root is not an instance of any parent. This makes the tag_path fully self-describing — any tool reading the database can identify the root template from the first segment without consulting metadata.

Subsequent segments are the dot-joined chain of `asset_name`s from the root template's immediate children down to and including the tag's own `asset_name`. Template names never appear in a `tag_path` beyond the root prefix.

Example: `Plant1_System_A.RFPowerModule.ForwardPower.setpoint`

Dots are not permitted in any `asset_name` OR `template_name`. `template_name` must not contain a dot character. The maximum permitted length of a `tag_path` is configurable via `MAX_TAG_PATH_LENGTH`.

### 9.2 tag_id — Stable Numeric Registry Address

`tag_id` is an INTEGER assigned to a tag at its first registry generation. Stored only in the database. Assigned using `MAX(tag_id) + 1` within the generation transaction at SERIALIZABLE isolation. `tag_id` values are never reused, even if tags are retired.

### 9.3 Tag Matching by Full Path

- If the `tag_path` already exists in the database as an active tag, the existing `tag_id` is reused.
- If the `tag_path` does not exist, a new `tag_id` is assigned.
- If a tag exists in the database but its `tag_path` does not appear in the new registry, that tag is marked as retired.

If a tag is renamed or moved, its original `tag_path` becomes retired and a new `tag_id` is created. There is no rename tracking — see Section 19 Open Items.

---

## 10. Validation Rules

Failures block the operation and display a detailed error report in the ValidationPanel. All validation logic is shared via `apps/tag-registry/shared/` and runs synchronously on every graph change client-side, and authoritatively on the server at batch save time.

### 10.1 Schema Conformance

- Every template must conform to its JSON Schema draft-07 definition.
- Each field must be `{ field_type, default }` where `field_type` ∈ `{ "Numeric", "String", "Boolean" }` and `default` matches the declared type.
- Child instance field values must be a subset of fields defined in the referenced child template.

### 10.2 Name Rules

- All template names must be globally unique across the entire `templates/` folder.
- All `asset_name` values must be non-empty and must not contain a dot (`.`) character.
- No duplicate `asset_name` values among siblings within the same parent template.
- `template_name` must not contain a dot (`.`) character. Error code: `INVALID_TEMPLATE_NAME`.

### 10.3 Reference Rules

- Every child instance must reference a valid, existing template by `template_name`.
- No circular references may exist in the template dependency graph.
- If a pending deletion removes a template that another template still references, `INVALID_REFERENCE` surfaces in the proposed set validation.

### 10.4 Tag-Specific Rules

- `data_type` must be one of the defined enum values (Section 6).
- Tags may not declare children.
- Identifier string fields (`template_name`, `asset_name`) must not exceed 40 characters.

### 10.5 Template Type Consistency

If a template is stored in a subfolder, the tool checks that the subfolder name matches the `template_type` field and flags mismatches as warnings. Non-blocking.

### 10.6 Tag Path Length

If any resolved `tag_path` exceeds the configured maximum path length, the save operation is blocked and the affected paths are listed.

### 10.7 Optional Parent Type Validation

Controlled by server environment variables `VALIDATE_REQUIRED_PARENT_TYPES` and `VALIDATE_UNIQUE_PARENT_TYPES`. Evaluated via `validateParentTypes`.

### 10.8 Tool Warnings (Non-Blocking)

- `TYPE_FOLDER_MISMATCH` — template_type does not match subfolder.
- `EMPTY_BRANCH` — structural template in the root hierarchy contains no tag descendants. **Note:** `EMPTY_BRANCH` is declared in `shared/constants.js` but is not yet implemented in Phase 1 validation. It is not emitted by `validateGraph`, `validateTemplate`, or `useValidation`. Reserved for future implementation.

### 10.9 Template Change Propagation

Any structural change to a template triggers `applyFieldCascade` immediately on the client-side `templateMap`. The cascade propagates the effect to all child instances in the loaded graph. All affected templates are added to the dirty set. The server applies the same logic authoritatively on batch save.

---

## 11. Registry Generation

Registry generation uses `resolveRegistry(templateMap, rootName)`. In Phase 1 this runs entirely client-side in-memory. In Phase 2 the same function is called server-side before writing to the database.

`resolveRegistry` extracts `.default` from each field definition before merging with instance overrides, so `meta.fields` in the registry output contains flat `{ name: value }` pairs.

### 11.1 Generation Steps

1. Validate all templates in the graph (Section 10). If any errors are present, the registry preview shows a blank state with a 'Resolve errors to view registry' banner.
2. Call `resolveRegistry(templateMap, rootName)`. Resolve the full hierarchy by walking the template composition graph and constructing `tag_path`s.
3. For each resolved tag, build the `meta` array (root-to-tag provenance chain: `meta[0]` = root level, `meta[meta.length - 1]` = tag level) and compute `trends`.
4. Display the resulting flat tag list in the RegistryPage table immediately. No server call required in Phase 1.
5. *(Phase 2)* Compare candidate registry against the database. Present full diff for review. On user confirmation, apply atomically within a SERIALIZABLE transaction.

### 11.2 Change Classifications

- **Added:** A `tag_path` appears in the resolved hierarchy but has no active entry in the database.
- **Modified:** A `tag_path` exists in both but one or more field values have changed.
- **Retired:** A `tag_path` exists in the database as an active tag but does not appear in the resolved hierarchy.
- **Unchanged:** A `tag_path` exists in both with no field value changes.

---

## 12. Diff Review UI *(Phase 2)*

The Registry page shows the resolved registry compared against the database. Comparison is performed client-side by `diffRegistry()` using key-order-insensitive deep equality. Row classification: added (green `bg-green-500/15` full row), retired (red `bg-red-500/15` full row), modified (per-cell amber `bg-amber-500/25` on changed fields only via `changedFields` array), unchanged (no highlight). A summary line shows counts per status (+N added / ~N modified / N unchanged / -N retired).

Modified rows also carry `dbMeta` (the db row's meta array) enabling field-level diff highlighting in the meta View modal: changed fields amber, added fields green, removed fields red strikethrough. A legend is shown in the modal when diff data is present.

An **Update DB** button is enabled when changes exist (added, modified, or retired rows). Clicking it opens a confirmation modal requiring a non-empty comment. The Confirm button is disabled until a comment is entered. On confirm, `POST /api/v1/registry/apply` is called. On success a 4-second banner shows the new revision number and the diff is re-run automatically.

The Update DB button is disabled when `isDirty` is true, with tooltip: "Save or discard changes before updating the registry."

---

## 13. Revision Control

The `tag_registry` table is append-only. Each apply action creates a new entry in `registry_revisions`. To reconstruct the registry at revision N: query `tag_registry WHERE registry_rev <= N` and take the latest row per `tag_id`.

---

## 14. Database Schema

The database stores only operational outputs. It does not store template JSON files.

### 14.1 tag_registry

Append-only table. Rows are never updated or deleted.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL (PK) | Surrogate primary key. |
| tag_id | INTEGER NOT NULL | Stable numeric identifier. Never reused. |
| registry_rev | INTEGER NOT NULL | The registry revision when this row was inserted or last modified. |
| tag_path | VARCHAR NOT NULL | Full dot-separated path. Always begins with the root template's `template_name`. |
| data_type | VARCHAR(40) NOT NULL | Data type enum value (Section 6). |
| is_setpoint | BOOLEAN NOT NULL | true = setpoint (writable); false = monitor (read-only). |
| trends | BOOLEAN NOT NULL DEFAULT false | true if any asset in the tag's hierarchy has a field named "trends" (case-insensitive) set to true after instance override resolution. |
| retired | BOOLEAN NOT NULL DEFAULT false | true if the tag is no longer present in the active template hierarchy. |
| meta | JSONB NOT NULL | Full provenance chain for the tag, ordered root-to-tag. `meta[0]` is the root level entry; `meta[meta.length - 1]` is the tag-level entry. Each object has: `type`, `name`, `fields`. |

Constraints: composite (`tag_id`, `registry_rev`) unique. Indexes on `tag_id`, `registry_rev`, `data_type`, `retired`. GIN index on `meta`.

**Note:** The partial unique index on `tag_path` (WHERE retired=false) was removed in migration 003. Uniqueness of active tag_paths is enforced at application level via the `DISTINCT ON` query in `getActiveRegistry()`.

### 14.2 registry_revisions

| Column | Type | Description |
|--------|------|-------------|
| registry_rev | INTEGER (PK) | Revision number, auto-incremented. |
| applied_by | VARCHAR NOT NULL | User who applied the revision. |
| applied_at | TIMESTAMPTZ NOT NULL | Timestamp of the apply action. |
| comment | TEXT NOT NULL | Required comment describing the change. |

---

## 15. Validation Panel

### 15.1 Overview

The ValidationPanel is a shared component rendered below the asset tree on the Editor page and below the registry table on the Registry page. It always renders with a "Validation" section header. The message list is shown only when messages are present — when clean, only the header bar is visible.

Both errors and warnings block the Save operation.

### 15.2 Trigger

All validation checks run synchronously on every change to the local template graph. No server call is made during editing. No debounce. The server re-runs the same validation authoritatively on batch save.

### 15.3 Message Structure

Each message carries: severity (`"error"` or `"warning"`), code (error code string), message (human-readable description), and an optional `ref` object with `template_name`, `field`, or `tag_path`. The panel renders errors before warnings. Within each group, messages are ordered by ref then by code.

### 15.4 Save Blocking

Both errors and warnings set `isValid` to `false`. The Save button is disabled when `isValid` is false.

### 15.5 Client-Side Checks

`INVALID_ASSET_NAME`, `DUPLICATE_SIBLING_NAME`, `CIRCULAR_REFERENCE`, `INVALID_REFERENCE`, `TAG_PATH_TOO_LONG`, `SCHEMA_VALIDATION_ERROR`, `UNKNOWN_FIELD`, `PARENT_TYPE_MISSING`, `DUPLICATE_PARENT_TYPE`, `EMPTY_BRANCH` (warning — declared but not yet emitted in Phase 1).

### 15.6 Registry Page Behaviour

Displays errors from the client-side `resolveRegistry` call. When any errors are present, the registry table is replaced with a blank state and a 'Resolve errors to view registry' banner. Informational only — no save operation on this page.

---

## 16. UI Concepts

### 16.1 Global Root Selector

A single global dropdown allows the user to select the root template. On selection, the client fetches the full reachable template graph from the server (`GET /api/v1/templates/root/:template_name`) and initialises the local template graph. The root dropdown wrapper has `cursor-not-allowed` styling while `isDirty` is true, with a tooltip: "Save or discard changes before switching root."

The **Save / See what's changed / Cancel** button group in AppShell is rendered only when `activeTab === 'editor'`. Navigating to the Registry or History tab hides the bar even if the graph is dirty.

The **Update DB** button on the Registry page is disabled when `isDirty` is true, with tooltip: "Save or discard changes before updating the registry."

### 16.2 System Tree (Left Panel)

The full resolved hierarchy is displayed as a collapsible tree built from the local template graph. Clicking any node populates the Fields Panel with that node's instance data. All edits are applied locally. No server call is made until Save.

Node collapse state is preserved across save/discard re-renders within the session. Selecting a new root resets all nodes to expanded.

Node names are shown in orange bold (`text-orange-700 font-semibold`) when the node represents a changed or new child instance (detected by comparing `children[childIndex]` against `originalTemplateMap` baseline). Clean nodes use regular weight.

Non-root nodes have a trash icon (always visible). Clicking it removes the child entry from the parent template's `children` array via `updateTemplate()`, entering the normal pending/Save flow.

### 16.3 Right Panel Layout

The right panel of the Editor page is divided vertically into two areas: the Templates Tree (top) and the Fields Panel (bottom). The two areas share a single selection state governed by the mutual-exclusion model described in section 16.6.

### 16.4 Templates Tree

Occupies the top portion of the right panel. Always visible. Displays all templates on disk grouped by `template_type` into collapsible folders. All folders are collapsed by default on load but expand/collapse state is preserved across save/discard re-renders within the session.

Clicking a folder header expands or collapses it. Clicking a template leaf node:
1. Fetches the full reachable subgraph via `GET /api/v1/templates/root/:template_name` and injects it via `injectTemplateGraph` (if not already loaded).
2. Clears any System Tree selection.
3. Highlights the leaf.
4. Populates the Fields Panel with the template's name and default field values.

Template leaves are shown in orange bold when their current state differs from the `originalTemplateMap` baseline (new template, or defaults changed). Clean templates use regular weight.

A **"New"** button in the panel header opens `NewTemplateModal` to create a new template. A **trash icon** on each leaf queues the template for deletion (pending/Save flow for saved templates; instant for new unsaved templates).

Template leaf nodes are **draggable**. Dragging a leaf onto a valid System Tree node (any non-`tag` node) creates a new child instance with `asset_name = template_name` (default).

### 16.5 Fields Panel

Occupies the bottom portion of the right panel. Displays the name and editable field values of the currently selected item. When nothing is selected the panel is blank.

**System Tree node selected:**
- Read-only metadata: Template Name, Template Type.
- Editable: Asset Name (not shown for root node). Changes written via `updateTemplate()`.
- All template fields shown, all editable. Fields with an instance override show the override value in orange bold. Fields showing the inherited template default show in normal weight.
- A `+` button in the panel header opens `AddFieldModal` — not shown in instance mode (fields are defined at the template level).

**Template selected via Templates Tree:**
- Read-only metadata: Template Name, Template Type.
- All template default fields shown, all editable. Fields that are new or changed from the `originalTemplateMap` baseline shown in orange bold.
- A `+` button in the panel header opens `AddFieldModal` to add a new field.
- A trash icon on each field row deletes the field from `template.fields` via `updateTemplate()`.

**Dirty field indicator:** `font-semibold text-orange-700` on the field name label. Override/dirty field input text also uses `text-orange-700`. Existing unchanged overrides use `text-blue-600`. Inherited clean defaults use `text-gray-700`.

**Blank-tick mechanism:** On any selection switch, the panel renders blank for one tick before repopulating, preventing stale data from showing while the new selection loads.

### 16.6 Selection Model — Mutual Exclusion

The System Tree and Templates Tree maintain a single shared selection cursor. At most one item across both trees is highlighted at any time.

- Selecting a System Tree node clears any Templates Tree highlight, blanks the Fields Panel momentarily, then populates it with the node's instance data.
- Selecting a template leaf in the Templates Tree clears any System Tree highlight, blanks the Fields Panel momentarily, then populates it with the template's default field data.
- Expanding or collapsing a folder in the Templates Tree does not affect the current selection or the Fields Panel.
- Both trees remain visible and scrollable at all times.

### 16.7 Cascade Preview Modal

A "See what's changed" button is available in the AppShell header whenever the dirty set or pending deletions are non-empty (and `activeTab === 'editor'`). Clicking it calls `simulateCascade` on the current client-side `templateMap`, passing `originalTemplateMap` as the baseline. Opens `CascadePreviewModal`.

The modal displays via `CascadeDiffContent`:
- **New Templates** (purple) — templates in `dirtySet` absent from `originalTemplateMap`.
- **Children Added / Removed** (indigo) — per parent template, green `+` and red `−` lines per child instance.
- **Pending Deletions** (red) — templates in `pendingDeletions`.
- **Fields Added** — new field definitions in changed templates.
- **Fields Removed** — removed field definitions.
- **Fields Changed** — template default value diffs.
- **Instance Overrides Changed** — instance-level field diffs.
- **Affected Instances** — parent templates whose child instances reference a schema-changed template.

This modal is informational — it requires no action. Renders using the shared `CascadeDiffContent` component. Adds Close footer.

### 16.8 Cascade Confirm Modal

Shown when the server returns `requires_confirmation: true` on batch save. Displays the same diff content as the Cascade Preview Modal using the shared `CascadeDiffContent` component. Requires explicit confirmation before the server applies the changes. Confirm resubmits the original batch with `confirmed: true`. Cancel dismisses without saving.

### 16.9 Registry Preview

The RegistryPage fetches the current database registry via `GET /api/v1/registry` on mount and re-fetches after each successful apply. It compares the database tags against the resolved in-memory registry using `diffRegistry()`. The table displays all rows with diff status coloring (see Section 12). If the DB fetch fails, a warning banner is shown and the table displays the proposed registry without diff coloring. If validation errors are present, the table is hidden and a 'Resolve errors to view registry' banner is shown.

### 16.10 History Page

A History nav tab shows the `registry_revisions` table with columns: rev, applied_by, applied_at (formatted `dd-MMM-yyyy HH:mm:ss`), comment. Rows are ordered most recent first (DESC by `registry_rev`). The page is read-only.

---

## 17. User Workflow

1. Define tag templates (leaf nodes) representing individual data points.
2. Define structural templates grouping tag templates into reusable units.
3. Optionally edit templates directly in the Templates Tree without loading a hierarchy.
4. Select a root template from the global root dropdown. Client fetches the full reachable template graph.
5. Use the System Tree to navigate, edit instance names and field overrides. Drag template leaves from the Templates Tree onto System Tree nodes to add child instances.
6. ValidationPanel shows live feedback from local simulation.
7. When ValidationPanel is clear, click Save. If upstream parents are affected, review and confirm the cascade modal.
8. *(Phase 2)* Navigate to the Registry tab. Review the diff against the database. Click Update DB, enter a comment, and confirm to apply.
9. *(Phase 2)* View the History tab to see all past registry revisions.

---

## 18. Phase Split Reference

| Feature | Phase 1 | Phase 2 |
|---------|---------|---------|
| Template graph | Fetched from server on root selection, held in client memory | Same |
| On-demand template fetch | Via `loadRoot` endpoint for individual templates/subgraphs | Same |
| Cascade simulation | Client-side via `simulateCascade` | Same |
| Field cascade on edit | Client-side via `applyFieldCascade`, immediate | Same + server applies on save |
| Batch save | `POST /api/v1/templates/batch` with hash checking, cascade confirm, and deletions array | Same |
| Template deletion | Pending client-side, committed via batch save `deletions` array | Same |
| Registry calculation | Client-side via `resolveRegistry`, live on graph change | Same logic, persisted to PostgreSQL on apply |
| Registry UI | Single table, live client-side, blank on errors | Client-side diff via `diffRegistry()`, per-cell highlighting for modified rows, Update DB button with comment modal, 4-second success banner, History page for revision log |
| Registry persistence | Not implemented | `tag_registry` append-only table |
| Diff / apply workflow | Not implemented | `POST /api/v1/registry/apply` (server resolves server-side, diffs, writes SERIALIZABLE transaction). `GET /api/v1/registry/revisions` and `GET /api/v1/registry/revisions/:rev`. |
| Revision history | Not implemented | `registry_revisions` table + History page |
| Retired tags | Not tracked | Detected during apply; shown in diff as red rows |
| Database | None | node-postgres, SERIALIZABLE transaction |
| Stale conflict on save | Re-fetch full root, discard local changes | Merge support (future work) |

---

## 19. Open Items

- **Rename tracking:** Add a mechanism to allow tag renaming that updates both template JSON files and the database simultaneously, preserving `tag_id` continuity.
- **Stale merge:** When a batch save is rejected due to a stale hash, attempt to merge the client's local changes with the refreshed server state rather than discarding them entirely.
- **Detailed UI wireframes** for the Asset Tree Editor, cascade confirmation modal, and registry diff review view.
- **Root template deletion:** Upon user confirmation, all active tags belonging to that root in the registry will be marked as retired.
- **`data_type` as integer FK:** In Phase 2, `data_type` column in `tag_registry` is intended to become a BIGINT FK referencing a data_types lookup table.
- **Concurrent edit protection** between simultaneous user sessions is not required at this time.
- **Bulk import** of existing flat tag lists into the template hierarchy.
- **Deployment and upgrade strategy** when the tool itself changes.
- **Authentication:** `applied_by` is currently hardcoded to `'dev'`. A real auth system is a Phase 2+ item.
