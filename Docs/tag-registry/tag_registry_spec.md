# Tag Registry Admin Tool — Functional Specification
**Draft** | Generated: 2026-04-02 | **Reconciled with the implementation:** 2026-10-17 — where the current behaviour differs from the intended design, both are stated.
Companion documents: [Bootstrap](tag_registry_bootstrap.md) | [API Spec](tag_registry_api_spec.md)

---

## 1. Glossary

| Term | Definition |
|------|------------|
| template | A JSON file defining an asset — its fields and, for structural templates, its children. |
| template_type | A user-defined classification for a template. The `template_type` field in the JSON file is the source of truth. |
| structural template | Any template that may contain children. All template types except `tag` are structural templates and behave identically. |
| tag template | A leaf template defining a single data point. No children. Tag-level fields include `data_type` (field_type `TagType`, default `f32`) and `is_setpoint` (field_type `Boolean`, default `false`), resolved from the fields record. |
| module template | A structural template representing a hardware or logical module. Must include a `Module_Type` field (field_type `ModuleType`). Can have children. |
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

This document describes the complete Tag Registry Admin Tool system.

The tool enables engineers to:

- Define reusable asset templates at every level of a user-defined hierarchy.
- Compose those templates into asset hierarchies.
- Generate the final tag registry for a selected root template, consumed by the HMI and backend runtime services.

**Design philosophy:** Every asset is defined by a template. A root template is simply whichever template the user selects from the global root dropdown. All template types are user-defined and treated uniformly.

The tool enables engineers to build hierarchical tag structures with instant local feedback. All cascade simulation and validation runs client-side against a locally held template graph, using shared pure functions from `apps/tag-registry/shared/`.

The server re-runs only part of that logic. On batch save it checks hashes, TagType/ModuleType lookups and `validateGraph`, and applies the cascade. On registry apply it runs `validateResolvedTags`. `validateTemplate` and `validateParentTypes` run in the client only (see §10).

---

## 3. Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React (web application) |
| Backend | Node.js / Express |
| Database | PostgreSQL |
| Template storage | JSON files on disk, flat `templates/` directory — no subdirectory routing |
| Shared validation | `apps/tag-registry/shared/` — environment-agnostic module consumed by both server and client |
| Source control | Git (recommended for template JSON files) |

---

## 4. High-Level Architecture

The system is organised around two artifacts:

- A `templates/` folder containing one JSON file per template. All templates live directly in this flat directory — no subdirectory routing. The `template_type` field in each JSON file is the sole source of truth for the template's type.
- A PostgreSQL database storing the generated tag registry and revision history.

The HMI and backend runtime services read only the tag registry from the database.

### 4.1 Atomicity Guarantee

**Intended:** all mutating operations are fully atomic — all file writes and database writes for a given operation are applied together, and any failure leaves the system unchanged.

**As built:**
- **Database:** registry apply is atomic (one SERIALIZABLE transaction).
- **Template files:** each file is written atomically (write `<file>.tmp`, then rename). A batch save or template delete that writes several files is not; an I/O failure part-way through leaves the earlier files written and the in-memory index updated for them.

### 4.2 Shared Validation Module

Validation and cascade simulation logic lives in `apps/tag-registry/shared/`. Both the server and client import from this directory via relative paths. The module must be environment-agnostic: no `fs`, no Express, no DOM. Pure functions only.

The shared module exports:

- `validateTemplate(template)` — schema conformance, field rules, `asset_name` rules for a single template. Each field in `template.fields` must be `{ field_type, default }` where `field_type` is one of `"Numeric" | "String" | "Boolean" | "TagType" | "ModuleType"` and `default` matches the corresponding JS type.
- `validateGraph(templates)` — circular references and broken references across the full map. It also has a duplicate-template-name check, but it runs over a `Map`, whose keys are already unique, so it can never fire (see §10.2).
- `simulateCascade(currentTemplateMap, proposedChanges, originalTemplateMap?)` — computes field-level diffs, dropped instance values, and the list of affected parent templates given a proposed set of changes.
- `applyFieldCascade(templateMap, changedTemplate)` — given a template that has changed, propagates the effect to all child instances in the map. Returns an updated `templateMap`. Pure function — does not mutate its input.
- `validateParentTypes(templateMap, rootName, options)` — evaluates `VALIDATE_REQUIRED_PARENT_TYPES` and `VALIDATE_UNIQUE_PARENT_TYPES` rules. Returns `{ errors: [], warnings: [] }`.
- `resolveRegistry(templateMap, rootName, options?)` — resolves the full hierarchy into a flat tag list with `tag_path`, `tag_name`, `module`, `module_type`, `data_type`, `is_setpoint`, `trends`, `unit`, `format`, `eng_min`, `eng_max`, and `meta`. Pure function. Extracts `.default` from each field definition before merging with instance overrides. `module` is the name of the nearest ancestor with `template_type: "module"` (null if none). `module_type` is the `Module_Type` field value from that module template (null if none). The `trends` field is `true` if any level in the resolved hierarchy has a field key matching `"trends"` (case-insensitive) with value `true` after instance override resolution, `false` otherwise. `tag_name` is the dot-joined `asset_name`s of meta levels where `In_Tag_Name === true`, root→leaf (see §16.11). The display columns `unit`, `format`, `eng_min`, `eng_max` are resolved via `resolveDisplayField` and are `null` for non-numeric tags (see §11.3). The `meta` array is ordered root-to-tag: `meta[0]` is the root level entry, `meta[meta.length - 1]` is the tag-level entry. With `options.withTemplateNames: true` each meta level also carries `template_name` (the template it is an instance of); the Tag Defs export uses it. It is off by default because apply deep-compares `meta` against the database, so the default output must never change.
- `validateResolvedTags(resolvedTags)` — post-resolution cross-field validator. Enforces: `trends` only on `f32`, `i16`, `i32`, or `bool`; `is_setpoint` only on non-array types; `TAG_NAME_EMPTY`, `TAG_NAME_TOO_LONG`, `DUPLICATE_TAG_NAME` (see §10.9 and §16.11). Returns `{ valid, errors, warnings }`. Called by the client (live validation panel) after each `resolveRegistry`, and by the server on registry apply and in `POST /templates/validate`. Not called by the server on batch save.
- `getModuleNames(tagMap)` — returns a sorted `string[]` of distinct module_id values from the resolved tag map, ordered by each module's minimum tag_id. Used by `HmiTagSource` (producer) and `ModuleInfoTable` (widget) for consistent module index assignment.
- `packedBit(words, bitIndex)` / `setPackedBit(words, bitIndex, value)` — LSB-first read/write of a single bit within a `number[]` word array (16 bits per word). Used for the `Module_Info.Watchdog` packed-bit array.
- `ModuleStatus` / `ModuleStatusLabels` — const enum (`UNKNOWN=0`, `OK=1`, `WARNING=2`, `FAULT=3`, `STALLED=4`) and display-label map. Shared between producer and widget.
- `constants` — error codes, `DEFAULT_DATA_TYPE`, `MAX_TAG_PATH_LENGTH` (the constant 100 — not read from the environment), `MAX_TAG_NAME_LENGTH`, `UNIQUE_ANCESTOR_TYPES`, the type sets.
- `deepEqual(a, b)` / `deepNotEqual(a, b)` — recursive structural equality, insensitive to object key order (`utils.ts`).
- `listMqttModuleTemplates(templateMap)` / `buildTagDefs(templateMap, moduleTemplateName)` / `buildTagDefsFile(templateMap, moduleTemplateName, tagRegistryRev)` / `validateTagDefs(templateMap, moduleTemplateName)` — Tag Defs export builders (nested `tags` tree) and module-relative name validation (§12.1).

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

- Checks every `original_hash` against the server's index for both `changes` and `deletions`. Any mismatch rejects the entire batch with `STALE_TEMPLATE`; the client re-fetches the full root hierarchy and discards local changes. A `null` hash for an existing name gives `TEMPLATE_NAME_CONFLICT`.
- Checks TagType and ModuleType field defaults against the `tag_types` / `module_types` tables (400 `SCHEMA_VALIDATION_ERROR` on an unknown value).
- Builds the proposed template set: current templates + `changes` − `deletions`.
- Runs `validateGraph` on the proposed set. `INVALID_REFERENCE` surfaces naturally if any remaining template references a deleted one.
- Scans for upstream parents — templates outside the submitted batch that reference any of the changed templates. If any are found and `confirmed` is not `true`, returns a `requires_confirmation` response with a diff and `affectedParents` list. No files written.
- If `confirmed: true` or no upstream impacts: writes each changed file (cascade updates applied; each file atomic, the batch not — §4.1), unlinks deleted template files, updates the in-memory index. Returns `{ modified_files, deleted_files }`.

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

| Value | Display Name | Scalar/Array | Trendable | Setpoint-capable |
|-------|-------------|-------------|-----------|-----------------|
| `f32` | Float 32 | Scalar | Yes | Yes |
| `bool` | Boolean | Scalar | Yes | Yes |
| `i16` | Int 16 | Scalar | Yes | Yes |
| `i32` | Int 32 | Scalar | Yes | Yes |
| `string` | String | Scalar | No | No |
| `f32[]` | Float 32 Array | Array | No | No |
| `i16[]` | Int 16 Array | Array | No | No |

Data types are stored in the `tag_types` database table (see DB Spec §3.3). `DEFAULT_DATA_TYPE = 'f32'` is the only hardcoded constant. The server validates `TagType` field values against `tag_types.type_name` on template save using `Promise.all` alongside `ModuleType` validation. New types can be added by inserting rows into `tag_types`.

**Constraints enforced at resolved-tag level (see §10.9):**
- Only `f32`, `i16`, `i32`, and `bool` may have `trends = true`. Setting `trends: true` on a `string` or array tag is a validation error.
- Array types (`f32[]`, `i16[]`) may not be setpoints. Setting `is_setpoint: true` on an array tag is a validation error.

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

`field_type` is one of: `"Numeric"` | `"String"` | `"Boolean"` | `"TagType"` | `"ModuleType"`. For `Numeric`, `String`, and `Boolean`, the `default` value must be the correct JS type (number, string, boolean). For `TagType`, the `default` is a string referencing a `tag_types.type_name` value (e.g. `"f32"`); the server validates it against the `tag_types` table on save. For `ModuleType`, the `default` is a string referencing a `module_types.type_name` value (e.g. `"HMI"`); the server validates it against the `module_types` table on save.

Instance override values (`child.fields`) remain raw values — the `field_type` is always read from the underlying template definition, never from an override.

Migration script: `apps/tag-registry/scripts/migrate_field_types.js` converts the legacy flat-value format.

### 7.2 Structural Template

```json
{
  "template_type": "module",
  "template_name": "rf_power_module",
  "fields": {
    "Module_Type":  { "field_type": "ModuleType", "default": "MQTT" },
    "description":  { "field_type": "String",     "default": "" }
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
    "data_type":   { "field_type": "TagType",  "default": "f32" },
    "is_setpoint": { "field_type": "Boolean",  "default": true },
    "Trends":      { "field_type": "Boolean",  "default": true },
    "unit":        { "field_type": "String",   "default": "" },
    "eng_min":     { "field_type": "Numeric",  "default": 0.0 },
    "eng_max":     { "field_type": "Numeric",  "default": 100.0 }
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

Dots are not permitted in any `asset_name` OR `template_name`. As built, the `asset_name` rule is enforced by `validateTemplate` (`INVALID_ASSET_NAME`), but the `template_name` rule only by the client's New Template dialog. The server accepts a dotted name, and renaming isn't possible in the UI.

The maximum `tag_path` length is 100 characters, the constant `MAX_TAG_PATH_LENGTH` in `shared/constants.ts`. The `MAX_TAG_PATH_LENGTH` environment variable is only logged at startup and has no effect. A tag whose path exceeds the limit is **dropped by `resolveRegistry` without any error** (see §10.5).

**Child array order is registry-neutral.** Reordering children within a parent template does not change any `tag_path` value — paths are built from `asset_name` strings, not from array indices. A pure reorder therefore produces zero diff when compared against the current database registry. The template file hash does change (array order is part of the canonical JSON), so the batch save pipeline correctly detects and persists the reorder.

### 9.2 tag_id — Stable Numeric Registry Address

`tag_id` is an INTEGER assigned to a tag at its first registry generation. Stored only in the database. Assigned using `MAX(tag_id) + 1` within the generation transaction at SERIALIZABLE isolation, with a floor of 1000, so the first tag in an empty database gets `1001`. `tag_id` values are never reused, even if tags are retired.

### 9.3 Tag Matching by Full Path

- If the `tag_path` already exists in the database as an active tag, the existing `tag_id` is reused.
- If the `tag_path` does not exist, a new `tag_id` is assigned.
- If a tag exists in the database but its `tag_path` does not appear in the new registry, that tag is marked as retired.

If a tag is renamed or moved, its original `tag_path` becomes retired and a new `tag_id` is created. There is no rename tracking — see Section 19 Open Items.

---

## 10. Validation Rules

Failures block the operation and display a detailed error report in the ValidationPanel. All validation logic is shared via `apps/tag-registry/shared/` and runs synchronously on every graph change client-side.

**Where each rule runs (as built):**

| Validator | Client (live) | Server: batch save | Server: registry apply |
|---|---|---|---|
| `validateTemplate` | Yes | No | No |
| `validateGraph` | Yes | Yes | No |
| TagType / ModuleType lookup | Dropdowns only offer table values | Yes | No |
| `validateParentTypes` | Yes | No | No |
| `validateResolvedTags` | Yes | No | Yes |

`POST /templates/validate` runs `validateTemplate`, `validateGraph` and `validateResolvedTags` over every indexed template.

### 10.1 Schema Conformance

- Each field must be `{ field_type, default }` where `field_type` ∈ `{ "Numeric", "String", "Boolean", "TagType", "ModuleType" }` and `default` matches the declared type (`validateTemplate`, `SCHEMA_VALIDATION_ERROR`).
- *Intended, not implemented:* conformance to a JSON Schema draft-07 definition (no schema or schema validator exists), and child instance field values limited to the fields defined in the referenced child template (`UNKNOWN_FIELD` is declared but never emitted; an unknown override key is accepted and carried into `meta`).

### 10.2 Name Rules

- All template names must be globally unique across the entire `templates/` folder. *As built, not detected:* the server indexes templates by `template_name`, so if two files declare the same name, whichever is scanned second silently replaces the first. `validateGraph`'s duplicate check can't fire (§4.2). Creating a duplicate through the UI is still refused, by `TEMPLATE_NAME_CONFLICT` on save.
- All `asset_name` values must be non-empty and must not contain a dot (`.`) character (`INVALID_ASSET_NAME`).
- No duplicate `asset_name` values among siblings within the same parent template (`DUPLICATE_SIBLING_NAME`).
- `template_name` must not contain a dot (`.`) character. *As built:* enforced only by the client's New Template dialog; there is no `INVALID_TEMPLATE_NAME` code.

### 10.3 Reference Rules

- Every child instance must reference a valid, existing template by `template_name`.
- No circular references may exist in the template dependency graph.
- If a pending deletion removes a template that another template still references, `INVALID_REFERENCE` surfaces in the proposed set validation.

### 10.4 Tag-Specific Rules

- Fields with `field_type: "TagType"` must have a `default` value matching a row in `tag_types.type_name`. Fields with `field_type: "ModuleType"` must have a `default` value matching a row in `module_types.type_name`. The server validates both TagType and ModuleType fields on template save using `Promise.all` to fetch both lookup tables concurrently. The `data_type` and `is_setpoint` values are extracted from the resolved fields record by the registry resolver (defaults: `data_type` → `'f32'`, `is_setpoint` → `false`).
- Tag templates must include three required fields: `data_type` (field_type `TagType`), `is_setpoint` (field_type `Boolean`), and `Trends` (field_type `Boolean`). `validateTemplate` returns `SCHEMA_VALIDATION_ERROR` if any are missing or have the wrong field_type.
- Module templates (`template_type: "module"`) must include the required field `Module_Type` (field_type `ModuleType`). `validateTemplate` returns `SCHEMA_VALIDATION_ERROR` if it is missing or has the wrong field_type.
- Tags may not declare children.
- Identifier string fields (`template_name`, `asset_name`) must not exceed 40 characters.

### 10.5 Tag Path Length

**Intended:** if any resolved `tag_path` exceeds the maximum path length, the save operation is blocked and the affected paths are listed (`TAG_PATH_TOO_LONG`).

**As built:** no validator checks path length, and `TAG_PATH_TOO_LONG` is never emitted. `resolveRegistry` silently skips any tag whose `tag_path` is longer than 100 characters:
- the tag is absent from the registry preview;
- it is never added to the database;
- an existing tag renamed or moved past the limit is retired.

### 10.6 Optional Parent Type Validation

Controlled by server environment variables `VALIDATE_REQUIRED_PARENT_TYPES` and `VALIDATE_UNIQUE_PARENT_TYPES`, which the server only reports to the client via `GET /api/v1/config`. Evaluated via `validateParentTypes` **in the client only** — neither batch save nor registry apply checks them.

- **`VALIDATE_REQUIRED_PARENT_TYPES`** — comma-separated list of `template_type` values that must appear in every tag's ancestor chain. Produces `PARENT_TYPE_MISSING` if absent. Example: `module`.
- **`VALIDATE_UNIQUE_PARENT_TYPES`** — when `true`, enforces that certain ancestor types appear at most once in a tag's ancestor chain. Only types listed in `UNIQUE_ANCESTOR_TYPES` (defined in `shared/constants.ts`) are subject to this check — currently `module` and `parameter`. Other types (e.g. `Group`, `system`) may repeat in the hierarchy without error. Produces `DUPLICATE_PARENT_TYPE` on violation.

### 10.7 Tool Warnings (Non-Blocking)

- `EMPTY_BRANCH` — structural template in the root hierarchy contains no tag descendants. **Note:** `EMPTY_BRANCH` is declared in `shared/constants.ts` but is not emitted by `validateGraph`, `validateTemplate`, or `useValidation`.

### 10.8 Template Change Propagation

Any structural change to a template triggers `applyFieldCascade` immediately on the client-side `templateMap`. The cascade propagates the effect to all child instances in the loaded graph. All affected templates are added to the dirty set. The server applies the same logic authoritatively on batch save.

### 10.9 Post-Resolution Cross-Field Validation

After `resolveRegistry` produces the flat tag list, `validateResolvedTags(resolvedTags)` enforces rules that span multiple resolved fields:

- **Trendable types:** `trends: true` is only valid when `data_type` is `f32`, `i16`, `i32`, or `bool`. Setting `trends: true` on a `string` or array tag (`f32[]`, `i16[]`) is a validation error.
- **Array setpoints:** `is_setpoint: true` is only valid on scalar types. Array tags (`f32[]`, `i16[]`) may not be setpoints.
- **`tag_name` rules:** `TAG_NAME_EMPTY` (empty `tag_name`), `TAG_NAME_TOO_LONG` (>40 chars), `DUPLICATE_TAG_NAME` (case-insensitive duplicate within the entire resolved registry; one error per offending tag; empty names excluded). See §16.11 for full `tag_name` / `In_Tag_Name` specification.

All rules return errors (blocking). `validateResolvedTags` is the sole enforcement point for these constraints — `validateTemplate` does not check them because the relevant fields live on different template levels. The function is exported from `apps/tag-registry/shared/` and runs in the client (live validation panel, called after each `resolveRegistry`) and on the server at registry apply, where a failure returns 422 `SCHEMA_VALIDATION_ERROR` with the messages in `details`. Batch save does not run it.

---

## 11. Registry Generation

Registry generation uses `resolveRegistry(templateMap, rootName)`. It runs client-side in-memory for the live preview, and server-side before writing to the database on apply.

`resolveRegistry` extracts `.default` from each field definition before merging with instance overrides, so `meta.fields` in the registry output contains flat `{ name: value }` pairs.

### 11.1 Generation Steps

1. Validate all templates in the graph (Section 10). If any errors are present, the registry preview shows a blank state with a 'Resolve errors to view registry' banner.
2. Call `resolveRegistry(templateMap, rootName)`. Resolve the full hierarchy by walking the template composition graph and constructing `tag_path`s.
3. For each resolved tag, build the `meta` array (root-to-tag provenance chain: `meta[0]` = root level, `meta[meta.length - 1]` = tag level) and compute `trends`.
4. Display the resulting flat tag list in the RegistryPage table immediately.
5. Compare candidate registry against the database. Present full diff for review. On user confirmation, apply atomically within a SERIALIZABLE transaction.

### 11.2 Change Classifications

- **Added:** A `tag_path` appears in the resolved hierarchy but has no active entry in the database.
- **Modified:** A `tag_path` exists in both but one or more field values have changed.
- **Retired:** A `tag_path` exists in the database as an active tag but does not appear in the resolved hierarchy.
- **Unchanged:** A `tag_path` exists in both with no field value changes.

### 11.3 Display Column Resolution

Four flat display columns — `unit`, `format`, `eng_min`, `eng_max` — are resolved per tag and stored as nullable columns on `tag_registry` (added by migration 013). They are populated only for **numeric tags**: those whose resolved `data_type` is in `TYPES_WITH_UNIT` (`shared/constants.ts`, currently `{ 'f32', 'i16', 'i32', 'f32[]', 'i16[]' }`). Boolean, string, and other non-numeric tags receive `null` for all four columns.

Resolution is performed by `resolveDisplayField(fieldName, meta, assetPath)` in `resolveRegistry.ts`. The algorithm walks the meta chain from root (index 0) to tag (index last) and applies these rules:

1. **Root priority** — the first meta level that has any match for the field wins. Lower level (closer to root) always beats a deeper level's match.
2. **Specificity within a level** — at meta level `i`, the relative path from that node down to the tag is `relPath = assetPath.slice(i)`. A dotted key such as `I.RSS.unit` matches when its prefix segments (`["I", "RSS"]`) are a leading subsequence of `relPath`, and its specificity equals the number of prefix segments. A plain `unit` key has specificity 0. Within the same level, the highest-specificity match wins.
3. **Meta content** — each meta level's `fields` contains only the template's field defaults merged with the direct `ChildRef.fields` overrides for that instance. Dotted keys (e.g. `I.eng_min`) are stored at the ancestor level that defines them; they are never propagated down into child meta levels.

---

## 12. Diff Review UI

The Registry page shows the resolved registry compared against the database. Comparison is performed client-side by `diffRegistry()` using key-order-insensitive deep equality. Row classification: added (green `bg-green-500/15` full row), retired (red `bg-red-500/15` full row), modified (per-cell amber `bg-amber-500/25` on changed fields only via `changedFields` array), unchanged (no highlight). A summary line shows counts per status (+N added / ~N modified / N unchanged / -N retired).

Modified rows also carry `dbMeta` (the db row's meta array) enabling field-level diff highlighting in the meta View modal: changed fields amber, added fields green, removed fields red strikethrough. A legend is shown in the modal when diff data is present.

An **Update DB** button is enabled when changes exist (added, modified, or retired rows) **and** the selected root matches this server's configured `PROJECT_ROOT` (`GET /api/v1/config`'s `projectRoot` — see `tag_registry_api_spec.md` §2.6/§2.7). Clicking it opens a confirmation modal requiring a non-empty comment. The Confirm button is disabled until a comment is entered. On confirm, `POST /api/v1/registry/apply` is called; the server independently enforces the same `PROJECT_ROOT` match (§5.3) and rejects a mismatch with `PROJECT_ROOT_MISMATCH` regardless of what the client sent — the client-side gate is a UI convenience, not the enforcement point. On success a 4-second banner shows the new revision number and the diff is re-run automatically.

The Update DB button is disabled in three cases, each with its own tooltip:
- `isDirty` is true: "Save or discard changes before updating the registry."
- The selected root doesn't match a configured `PROJECT_ROOT`: names both the configured `PROJECT_ROOT` and the currently selected root.
- `PROJECT_ROOT` is not configured on this server at all: states that apply is disabled until it's set.

Selecting and authoring any root in the dropdown stays unrestricted regardless of `PROJECT_ROOT` — only the apply action is gated.

Both the Registry and History pages also show a quiet, always-visible connection indicator (`DB: <databaseName>` / `PROJECT_ROOT: <projectRoot>`, or `(not configured)` when unset) sourced from the same `GET /api/v1/config` response. On the Registry page this sits above the root-selection/validation-error states, not inside them, so it shows regardless of whether a root is selected or valid.

### 12.1 Generate Tag Defs

A **Generate Tag Defs** button on the Registry page, beside **Export to CSV**, downloads a template-level tag definition export for firmware builds (design decision: RF_Control `Docs/CARO_MIGRATION.md` D32). It calls `GET /api/v1/tag-defs?root=<selected root>` (API spec §7).

**Scope.** One file per **MQTT module template** reachable from the selected root — module *types*, not instances. A system that instances one module template twice (RF1, RF2) produces one file. A template qualifies when `template_type` is `module` and its own `Module_Type` default is `MQTT`. `HMI`-type modules are excluded: their tags are produced in-process by the HMI server (`HmiTagSource`) and never cross MQTT. As of 2026-09-26 every module template in `templates/` is either `MQTT` (`Beam_Control`, `Cooling`, `Narya_RF`, `Pole`, `Power_Control`, `RF_Control`) or `HMI` (`HMI`). No instance overrides `Module_Type`.

**Output.** A ZIP named `TagDefs_YYYY-MM-DD_HHmmss.zip` (server local time), containing one `<template_name>.json` per qualifying template, flat at the ZIP root:

```json
{
  "_generated": "GENERATED FILE - DO NOT EDIT. ...",
  "template_name": "Narya_RF",
  "tag_registry_rev": 13,
  "tags": {
    "Mag_1": { "_template": "Coupler2", "Fwd": {
      "_template": "RF_Pwr",
      "Gain": { "data_type": "f32" },
      "kW":   { "data_type": "f32" }
    } },
    "RF_Enable": { "data_type": "bool" }
  }
}
```

- **`tags` is a tree nested by `tag_name` segment** (since 2026-10-01; previously a flat array of `{ tag_name, direction, data_type }`). The tag `Mag_1.Fwd.Gain` becomes `tags.Mag_1.Fwd.Gain`. A node is a **leaf iff it has a `data_type` key**, and a group node otherwise. The consumer generates a C++ struct from it for compile-time, name-addressed access (`Mag_1.Fwd.Gain`, not a string lookup).

- `tag_name` is **module-relative**. It was named `tag_path` until 2026-10-01 and was renamed because the value is a name, not an asset path. It holds the dot-joined `asset_name`s of levels *below* the module whose `In_Tag_Name` is true (§16.11). It is not the full asset path, so organizational groupings such as `Pwr_Mon` drop out. For example, `Narya1.RF1.Pwr_Mon.Mag_1.Fwd.Gain` with system `tag_name` `RF1.Mag_1.Fwd.Gain` exports as `Mag_1.Fwd.Gain`. The module level itself is always skipped, even when an instance sets `In_Tag_Name` on it (as `Narya1` does for `RF1`), because whether the instance name is shown is an instance decision. The template is resolved on its own with `resolveRegistry`, using the module template as root, so nothing above the module can affect the output.
- **Name validation.** Each module-relative name must be non-empty and unique within its template, compared case-insensitively. Two further rules come from the tree shape. No name may also be the parent of another (`Comb.Fwd` beside `Comb.Fwd.Gain`), compared case-insensitively, because that node would have to be leaf and group at once (`TAG_NAME_LEAF_AND_GROUP`). No segment may be `data_type` (the leaf key) or `_template` (the template key), because a node would then be ambiguous (`TAG_NAME_RESERVED_SEGMENT`). Every template that marks a node must have a C identifier as its name (`TEMPLATE_NAME_INVALID`). Violations reject the export with `VALIDATION_ERROR`, carrying `TAG_NAME_EMPTY` / `DUPLICATE_TAG_NAME` / `TAG_NAME_LEAF_AND_GROUP` / `TAG_NAME_RESERVED_SEGMENT` / `TEMPLATE_NAME_INVALID` details from `validateTagDefs`. As of 2026-10-01, `Narya_RF`, `Cooling`, `Pole`, `Power_Control` and `RF_Control` pass. `Beam_Control` fails `TAG_NAME_LEAF_AND_GROUP` twice (`Scanning`, `Scanning.X`): `Scan.Enable` has `In_Tag_Name: false`, so it takes its parent's name while that parent's children sit below it. Export from any root that reaches `Beam_Control` is therefore refused until that template changes. Of the two system templates today, that is `CARO_1` (`Narya1` does not reach it); `Beam` itself is a `Beam`-type template, not a selectable root. This is checked separately because system-level `tag_name` validation can pass while module-relative names collide: the instance-name prefix may be the only thing that disambiguates.
- **Handshake contract.** The MQTT handshake's `TAG_LIST` identifies tags by this same module-relative `tag_name` (`CARO_MQTT_Spec.md` §7.1, §7.4). A module built from this export binds ids by name, so the export and the backend's `TAG_LIST` assembly derive the name with one shared function, `moduleRelativeTagName(meta)` in `shared/tagDefs.ts`: the levels below the first `module` level whose `In_Tag_Name` is true. Here `meta[0]` is the module; the backend passes registry rows whose `meta` starts at the system root.
- **`_template` marks** (since 2026-10-26; CARO_MQTT_Interface decision P70). A group node that is exactly one instance of a registry template carries `"_template": "<template name>"`, so the consumer's generator emits one C type, `caro_tpl_<template>_t`, per template and uses it for every instance. A node is marked only when the instance's own level has `In_Tag_Name` true (otherwise it has no node — its children merge into the parent), it is the only instance on that node, and every leaf under the node comes from inside it (descendants flattened in by `In_Tag_Name` false levels count). Leaves and the root are never marked. Every node marked with one template has the same members by construction: instance overrides only touch the instance's own level, and a node mixing in outside content is not marked, so there is no shape check. `_template` is a reserved segment, and a marking template whose name is not a C identifier refuses the export (`TEMPLATE_NAME_INVALID`). Template instances are found with `resolveRegistry`'s `withTemplateNames` option. For `Narya_RF` (rev 13) this marks 23 nodes with 10 templates: `RF_Pwr` ×6, `DI_Intk` ×4, `Coupler2` ×3, `Analog_In` ×3, `Set_Mon` ×2, and `Phase`, `Phase_PID`, `PhPower`, `Pulse`, `SpecA` once each; `CARO_TAG_FIELD_COUNT` stays 224.
- Each leaf's `data_type` is the resolved `data_type`.
- **Only `data_type` per leaf.** `direction` (Set/Mon) was dropped on 2026-10-01: compile-time name addressing does not need it. It remains in the registry's own data model as `is_setpoint`. `tag_id`, `unit`, `eng_min`, `eng_max`, `trends`, `scale`, `offset`, `format` and `is_setpoint` are deliberately excluded (D32 records why for each). Do not add them. The file has no instance dependency, so commissioning an instance or editing display metadata never changes it.
- **`tag_registry_rev`** (integer, since 2026-10-21; replaces `content_hash`) is the database's latest `registry_rev` at export time. The module sends it as `tag_registry_rev` in its `HANDSHAKE_REQUEST` (`CARO_MQTT_Spec.md` §7.2). The export guarantees that the file's `tags` are what that revision applied (see Gating). It is a database-wide number, not a per-template one: it goes up on every apply, for any template, so a re-export can carry a new revision with identical `tags`. The Tag Registry has no per-template revision (`CARO_MQTT_Spec.md` Open Questions).
- Keys are written in a fixed order: `_generated`, `template_name`, `tag_registry_rev`, `tags`. Within `tags`, keys are inserted in code-unit order (reproducible with `strcmp`), except that a node's `_template` key is always written first, and integer-like keys (none today) would print first, as JS objects enumerate them that way.
- No generation timestamp goes inside the files. The timestamp is in the ZIP name only, so regenerating an unchanged template at the same revision yields a byte-identical file and no diff churn in the consuming repo.

**Gating.** The export reads **saved** templates from disk, not the client's in-memory graph. The button is therefore disabled while `isDirty`, with the tooltip "Save or discard changes before generating Tag Defs — the export reads saved templates".

The saved templates must also be **applied**: the server runs the same comparison as apply (`classifyRegistryChanges` in `registryService.ts`) and refuses with `409 REGISTRY_NOT_APPLIED` unless it finds nothing to add, modify or retire. It also refuses when no revision exists yet. So the order is save, apply (Update DB), then Generate Tag Defs. This is what makes `tag_registry_rev` describe the file's `tags`. The export is read-only and not gated by `PROJECT_ROOT`. Server errors, such as `REGISTRY_NOT_APPLIED`, `NO_MQTT_MODULES` or a graph `VALIDATION_ERROR`, show in a red banner above the table.

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
| module | VARCHAR(40) NULL | `asset_name` of the nearest `module` ancestor; `null` if none. Indexed. Added by migration 011. |
| module_type | VARCHAR(40) NULL | That module's `Module_Type` value (`MQTT`, `HMI`); `null` if none. Indexed. Added by migration 011. |
| data_type | VARCHAR(40) NOT NULL | Data type value (Section 6). Foreign key to `tag_types(type_name)` (migration 008). |
| is_setpoint | BOOLEAN NOT NULL | true = setpoint (writable); false = monitor (read-only). |
| trends | BOOLEAN NOT NULL DEFAULT false | true if any asset in the tag's hierarchy has a field named "trends" (case-insensitive) set to true after instance override resolution. |
| retired | BOOLEAN NOT NULL DEFAULT false | true if the tag is no longer present in the active template hierarchy. |
| meta | JSONB NOT NULL | Full provenance chain for the tag, ordered root-to-tag. `meta[0]` is the root level entry; `meta[meta.length - 1]` is the tag-level entry. Each object has: `type`, `name`, `fields`. |
| unit | VARCHAR(40) NULL | Engineering unit string (e.g. `"kA"`, `"kV"`). Resolved via `resolveDisplayField`. `null` for non-numeric tags. Added by migration 013. |
| format | VARCHAR(40) NULL | Display format string (e.g. `"#"`, `"#.##"`). Resolved via `resolveDisplayField`. `null` for non-numeric tags. Added by migration 013. |
| eng_min | DOUBLE PRECISION NULL | Engineering range minimum. Resolved via `resolveDisplayField`. `null` for non-numeric tags. Added by migration 013. |
| eng_max | DOUBLE PRECISION NULL | Engineering range maximum. Resolved via `resolveDisplayField`. `null` for non-numeric tags. Added by migration 013. |
| tag_name | VARCHAR(40) NULL | Resolved tag name: dot-joined `asset_name`s of meta levels where `In_Tag_Name === true`, root→leaf. Uniqueness enforced in-app by `validateResolvedTags` — no DB UNIQUE constraint. Added by migration 015. |

Constraints: composite (`tag_id`, `registry_rev`) unique; `data_type` → `tag_types(type_name)`. Indexes on `tag_id`, `registry_rev`, `data_type`, `retired`, `module`, `module_type`. GIN index on `meta`.

**Note:** The partial unique index on `tag_path` (WHERE retired=false) was removed in migration 003. Uniqueness of active tag_paths follows from the apply logic, which classifies by `tag_path` against the `DISTINCT ON (tag_id)` active set from `getActiveTags()`; no database constraint enforces it.

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

The panel is height-capped at `max-h-[50vh]`. The "Validation" header is `flex-shrink-0` (always visible). The message list is `overflow-y-auto` (scrollable). When the message count overflows the capped height, the list scrolls independently while the header remains pinned.

Both errors and warnings block the Save operation.

### 15.2 Trigger

All validation checks run synchronously on every change to the local template graph. No server call is made during editing. No debounce. The server re-runs only part of the validation (§10).

### 15.3 Message Structure

Each message carries: severity (`"error"` or `"warning"`), code (error code string), message (human-readable description), and an optional `ref` object with `template_name`, `field`, or `tag_path`. The panel renders errors before warnings. Within each group, messages keep the order the validators produced them in (there is no further sort).

### 15.4 Save Blocking

Both errors and warnings set `isValid` to `false`. The Save button is disabled when `isValid` is false.

### 15.5 Client-Side Checks

Emitted: `INVALID_ASSET_NAME`, `DUPLICATE_SIBLING_NAME`, `CIRCULAR_REFERENCE`, `INVALID_REFERENCE`, `SCHEMA_VALIDATION_ERROR`, `PARENT_TYPE_MISSING`, `DUPLICATE_PARENT_TYPE`, `TAG_NAME_EMPTY`, `TAG_NAME_TOO_LONG`, `DUPLICATE_TAG_NAME`.

Declared but never emitted: `TAG_PATH_TOO_LONG` (§10.5), `UNKNOWN_FIELD` (§10.1), `EMPTY_BRANCH` (warning, §10.7).

### 15.6 Registry Page Behaviour

Displays errors from the client-side `resolveRegistry` call. When any errors are present, the registry table is replaced with a blank state and a 'Resolve errors to view registry' banner. Informational only — no save operation on this page.

---

## 16. UI Concepts

### 16.1 Global Root Selector

A single global dropdown allows the user to select the root template. On selection, the client fetches the full reachable template graph from the server (`GET /api/v1/templates/root/:template_name`) and initialises the local template graph. While `isDirty` is true the root dropdown is disabled, inside a `cursor-not-allowed` wrapper with the tooltip "Save or discard changes before switching root".

The **Save / See what's changed / Cancel** button group in AppShell is rendered only when `activeTab === 'editor'`. Navigating to the Registry or History tab hides the bar even if the graph is dirty.

The **Update DB** button on the Registry page is disabled when `isDirty` is true, when the selected root doesn't match the configured `PROJECT_ROOT`, or when `PROJECT_ROOT` isn't configured at all — see §12 for the full gating rule and tooltip text per case. Selecting the root itself is never gated by `PROJECT_ROOT`, only the apply action.

### 16.2 System Tree (Left Panel)

The full resolved hierarchy is displayed as a collapsible tree built from the local template graph. Clicking any node populates the Fields Panel with that node's instance data. All edits are applied locally. No server call is made until Save.

Each node's expanded/collapsed state is persisted via `useTreeExpandStore` (Zustand + `persist` middleware, storage key `caro.tag-registry.tree-expand`). On first visit (no stored state), the root node starts expanded and all children start collapsed. On subsequent visits, the store restores the previous expand/collapse state. Selecting a new root remounts the entire tree (`key={rootTemplateName}`), but the store retains per-node state so a previously visited root reopens at its last state.

Node names are shown in bold italic gray (`font-semibold italic text-gray-800`) when the node represents a changed or new child instance (detected by comparing `children[childIndex]` against `originalTemplateMap` baseline). Clean nodes use regular weight.

#### 16.2.1 Validation Path-Severity Tinting

Tree nodes in the System Tree whose subtree contains validation errors or warnings receive a colored left border and background tint. Errors: `border-l-4 border-red-500 bg-red-50`. Warnings: `border-l-4 border-yellow-400 bg-yellow-50`. Error severity beats warning. The selection state (blue border/bg, `border-l-4 border-blue-600 bg-blue-50`) takes visual priority over tinting.

Tinting is computed in `EditorPage` as `pathSeverityMap` (a `Map<string, 'error'|'warning'>`) from `msg.ref.tag_path` prefixes: for each validation message, every dot-separated prefix of `tag_path` maps to the worst severity at that prefix. The map is passed via props: `EditorPage → AssetTree → TreeNode`. Each node looks up its `ownPath` in the map to determine its tint.

Non-root nodes have a trash icon (always visible). Clicking it removes the child entry from the parent template's `children` array via `updateTemplate()`, entering the normal pending/Save flow.

Every non-root tree node is **draggable**. Drop targets use a three-zone model determined by cursor position within the target row:

- **Top band (8 px):** Insert the dragged item as a sibling before this node, within this node's own parent's `children` array.
- **Body (middle area):** Nest the dragged item as a new child of this node — non-`tag` nodes only (tags cannot have children).
- **Bottom band (8 px):** Insert the dragged item as a sibling after this node, within this node's own parent's `children` array.

Root nodes expose only the body zone (they have no parent to insert into). Tag nodes expose only top and bottom zones (tags cannot have children).

**Visual feedback:** top and bottom zones display a 2 px blue horizontal line at the corresponding edge of the row. The body zone displays a blue dashed border.

**Drag-and-drop reordering and reparenting** — the same three-zone model applies whether or not the hovered node currently shares the dragged item's parent:
- **Top/bottom bands** always insert the dragged item as a sibling within the *hovered node's own parent*. When that parent happens to be the dragged item's current parent, this is a same-array reorder (splice out, splice back in); otherwise it's a cross-parent sibling insert.
- **Body zone** always nests the dragged item as a new child of the *hovered node itself* — including when the hovered node is currently a sibling of the dragged item. Whether nesting is available never depends on the current sibling relationship, only on the two restrictions below.

Two things block a drop regardless of zone:
- **Cycle prevention:** a node cannot be dropped where it would create a cycle — the target cannot be the dragged template itself or any of its own descendants (computed from the template graph via a DFS from the dragged template, not from tree position, so it correctly accounts for templates referenced from more than one place in the graph).
- **No-op suppression:** a same-array reorder that wouldn't change the array (top/bottom over an adjacent position) is suppressed, and a body drop onto the dragged item's own current parent is excluded from the body zone entirely (it would be a no-op — the item is already there) — so no misleading "droppable" highlight appears in either case.

**Tag continuity is not preserved across a reparent.** Reparenting changes the node's `tag_path` (and everything beneath it), which retires the existing `tag_id`(s) and issues new ones on the next registry apply — this is an accepted, known consequence, not a bug. Preserving `tag_id` continuity across a reparent would require rename/move tracking, which is not built (see `platform_todo.md` / handoff "What Is Not Built").

### 16.3 Editor Page Layout

The editor uses a **3-column layout**: **System Tree | Properties (FieldsPanel) | Templates (TemplatesTree)**. All three columns are side-by-side peers with independent vertical scrolling (`overflow-y-auto`). Below all three columns is the **ValidationPanel**, rendered as a separate full-width bar (`flex-shrink-0`). The two areas share a single selection state governed by the mutual-exclusion model described in section 16.6.

### 16.4 Templates Tree

The rightmost column of the editor. Always visible. Displays all templates on disk grouped by `template_type` into collapsible folders. The panel header label is **"Templates"**. All folders are collapsed by default on load but expand/collapse state is preserved across save/discard re-renders within the session.

Clicking a folder header expands or collapses it. Clicking a template leaf node:
1. Fetches the full reachable subgraph via `GET /api/v1/templates/root/:template_name` and injects it via `injectTemplateGraph` (if not already loaded).
2. Clears any System Tree selection.
3. Highlights the leaf.
4. Populates the Fields Panel with the template's name and default field values.

Template leaves are shown in bold italic gray (`font-semibold italic text-gray-800`) when their current state differs from the `originalTemplateMap` baseline (new template, or defaults changed). Clean templates use regular weight.

A **"New"** button in the panel header opens `NewTemplateModal` to create a new template. A **trash icon** on each leaf queues the template for deletion (pending/Save flow for saved templates; instant for new unsaved templates).

Template leaf nodes are **draggable**. The drop behaviour on System Tree nodes uses the three-zone model described in §16.2:

- **Body zone** — appends a new child instance to the target node (any non-`tag` node) with `asset_name = template_name` (default).
- **Top or bottom zone** — inserts the new child at that position rather than appending to the end. The parent for the insert is the target node's parent, and the insertion index is computed from the drop zone (before or after the target sibling).

### 16.5 Fields Panel

Occupies the bottom portion of the right panel. Displays the name and editable field values of the currently selected item. When nothing is selected the panel is blank.

**System Tree node selected:**
- Read-only metadata: Template Name, Template Type.
- Editable: Asset Name (not shown for root node). Changes written via `updateTemplate()`.
- All template fields shown, all editable. Fields with an instance override are shown in `text-blue-600`. Fields showing the inherited template default show in normal weight.
- Setting a field that had no override back to its inherited value removes the override instead of storing one equal to the default, so the node returns to clean. An existing override is always kept, even when it equals the default; an override equal to the default can therefore not be created by typing it.
- A `+` button in the panel header opens `AddFieldModal` — not shown in instance mode (fields are defined at the template level).

**Template selected via Templates Tree:**
- Read-only: Template Name. Editable: Template Type — rendered as a text input with datalist suggestions (`system`, `module`, `Group`, `parameter`, `tag`). Custom values are permitted. Changing `template_type` uses the same dirty-tracking as other template properties; existing validation rules are enforced on save (e.g., changing to `tag` requires `data_type`, `is_setpoint`, and `Trends` fields and no children; changing to `module` requires `Module_Type`). When dirty, the Template Type cell uses the dirty style (`text-gray-700 font-semibold italic`).
- All template default fields shown, all editable. Fields that are new or changed from the `originalTemplateMap` baseline use the dirty style.
- A `+` button in the panel header opens `AddFieldModal` to add a new field.
- A trash icon on each field row deletes the field from `template.fields` via `updateTemplate()`.

**Numeric fields** (both modes): focusing the input selects its value, so typing replaces it. The typed text is kept while editing and committed only when it is a complete number (`parseNumericDraft` in `client/src/utils/numericDraft.ts`), so partial input such as `-` or an empty field is not turned into `0`. On blur the input shows the stored value again, which drops partial text and normalises it (`05` reads `5`).

**Dirty field indicator:** `font-semibold italic text-gray-700` on the field name label and input. Existing unchanged overrides use `text-blue-600`. Inherited clean defaults use `text-gray-700`.

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
- **Children Reordered** (indigo) — per parent template, the new child order displayed as asset names joined by `→`. Shown when the relative order of shared children has changed, independently of any add/remove changes.
- **Pending Deletions** (red) — templates in `pendingDeletions`.
- **Fields Added** — new field definitions in changed templates.
- **Fields Removed** — removed field definitions.
- **Fields Changed** — template default value diffs.
- **Template Type Changed** (yellow) — templates whose `template_type` was changed, showing old → new values.
- **Instance Overrides Changed** — instance-level field diffs.
- **Affected Instances** — parent templates whose child instances reference a schema-changed template.

**Reorder detection algorithm:** For each dirty template, the enrichment function computes the *ordered intersection* — the subsequence of children present in both the original and current arrays, in their respective orders. If these two subsequences differ at any index, a reorder is recorded for that parent. Requiring at least two shared children prevents a false positive when all but one child has been replaced. Reorder detection fires independently of add/remove detection — both sections can appear simultaneously for the same parent template.

This modal is informational — it requires no action. Renders using the shared `CascadeDiffContent` component. Adds Close footer.

### 16.8 Cascade Confirm Modal

Shown when the server returns `requires_confirmation: true` on batch save. Displays the same diff content as the Cascade Preview Modal using the shared `CascadeDiffContent` component. Requires explicit confirmation before the server applies the changes. Confirm resubmits the original batch with `confirmed: true`. Cancel dismisses without saving.

### 16.9 Registry Preview

The RegistryPage fetches the current database registry via `GET /api/v1/registry` on mount and re-fetches after each successful apply. It compares the database tags against the resolved in-memory registry using `diffRegistry()`. The table displays all rows with diff status coloring (see Section 12). If the DB fetch fails, a warning banner is shown and the table displays the proposed registry without diff coloring. If validation errors are present, the table is hidden and a 'Resolve errors to view registry' banner is shown.

### 16.10 History Page

A History nav tab shows the `registry_revisions` table with columns: rev, applied_by, applied_at (formatted `dd-MMM-yyyy HH:mm:ss`), comment. Rows are ordered most recent first (DESC by `registry_rev`). The page is read-only.

### 16.11 `tag_name` and `In_Tag_Name`

#### Resolution rule

`resolveRegistry` computes a `tag_name` for each resolved tag: the dot-joined `asset_name` values of every meta level (root→leaf) where `In_Tag_Name === true`. Levels where `In_Tag_Name` is `false` or absent are skipped. The result is included as `tag_name: string` on `ResolvedTag`.

Example: given a path `SYS.chan_A.setpoint` where `SYS` has `In_Tag_Name: false`, `chan_A` has `In_Tag_Name: true`, and `setpoint` has `In_Tag_Name: false`, the resolved `tag_name` is `'chan_A'`.

#### `In_Tag_Name` field convention

`In_Tag_Name` is a reserved Boolean field (field_type `Boolean`) seeded into all template JSON files:

- `true` for `parameter` and `tag` template types.
- `false` for `system`, `module`, `Group`, and custom types.

`In_Tag_Name` is **reserved** — `AddFieldModal` blocks the user from adding a field with this name (the modal shows an error and stays open).

#### RegistryTable column

The RegistryTable includes a `tag_name` column (3rd column, index 2, between `tag_path` and `module`).

#### Validation

`validateResolvedTags` enforces three post-resolution `tag_name` rules (all severity `'error'`, all blocking):

- **`TAG_NAME_EMPTY`** — `tag_name === ''` (no level in the path has `In_Tag_Name: true`).
- **`TAG_NAME_TOO_LONG`** — `tag_name.length > MAX_TAG_NAME_LENGTH` (40 chars, from `shared/constants.ts`).
- **`DUPLICATE_TAG_NAME`** — two or more resolved tags in the same registry share the same `tag_name` (case-insensitive comparison, entire-registry scope). One error is emitted per offending tag. Empty names are excluded from duplicate checking (they are already covered by `TAG_NAME_EMPTY`). Uniqueness is enforced in-app only — the `tag_registry` database column has **no UNIQUE constraint**.

---

## 17. User Workflow

1. Define tag templates (leaf nodes) representing individual data points.
2. Define structural templates grouping tag templates into reusable units.
3. Optionally edit templates directly in the Templates Tree without loading a hierarchy.
4. Select a root template from the global root dropdown. Client fetches the full reachable template graph.
5. Use the System Tree to navigate, edit instance names and field overrides. Drag template leaves from the Templates Tree onto System Tree nodes to add child instances.
6. ValidationPanel shows live feedback from local simulation.
7. When ValidationPanel is clear, click Save. If upstream parents are affected, review and confirm the cascade modal.
8. Navigate to the Registry tab. Review the diff against the database. Click Update DB, enter a comment, and confirm to apply.
9. View the History tab to see all past registry revisions.

---

## 18. Implementation Summary

| Feature | Implementation |
|---------|----------------|
| Template graph | Fetched from server on root selection via `loadRoot`, held in client memory |
| Cascade simulation | Client-side via `simulateCascade`; applied server-side authoritatively on save |
| Batch save | `POST /api/v1/templates/batch` with hash checking, cascade confirmation modal, and deletions array |
| Registry calculation | Client-side via `resolveRegistry` for live preview; server-side before writing to PostgreSQL on apply |
| Registry UI | Diff view via `diffRegistry()` with per-cell highlighting, Update DB button with comment modal, 4-second success banner, History page |
| Registry persistence | `tag_registry` append-only table via `POST /api/v1/registry/apply` (SERIALIZABLE transaction) |
| Revision history | `registry_revisions` table + History page |
| Retired tags | Detected during apply; shown in diff as red rows |
| Stale conflict on save | Re-fetch full root, discard local changes (merge not supported) |
| Tag Defs export | `GET /api/v1/tag-defs?root=` → ZIP of one JSON per MQTT module template (`tags` tree nested by `tag_name` segment, leaves `{ data_type }` + banner + `tag_registry_rev`; refused with 409 `REGISTRY_NOT_APPLIED` unless the saved templates are applied); Registry page "Generate Tag Defs" button (§12.1) |

